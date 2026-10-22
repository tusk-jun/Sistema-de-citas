-- Esquema reproducible. Ejecutar en Supabase > SQL Editor: esquema.sql, politicas_rls.sql, datos_prueba.sql
create extension if not exists btree_gist;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombres text not null check (char_length(nombres) between 2 and 80),
  documento text unique check (documento ~ '^[0-9A-Za-z-]{5,20}$'),
  telefono text check (telefono ~ '^[0-9+ ]{7,15}$'),
  fecha_nacimiento date check (fecha_nacimiento <= current_date),
  rol text not null default 'paciente' check (rol in ('paciente','profesional','admin')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.specialties (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (char_length(nombre) between 3 and 60),
  descripcion text check (char_length(descripcion) <= 200),
  activo boolean not null default true,
  created_by uuid default auth.uid(), updated_by uuid
);
create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  specialty_id uuid not null references public.specialties(id) on delete restrict,
  registro_profesional text check (char_length(registro_profesional) <= 30),
  activo boolean not null default true,
  created_by uuid default auth.uid(), updated_by uuid
);
-- Franja = un cupo. Al cancelar una cita la franja vuelve a 'disponible' y la cita se conserva (historial).
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete restrict,
  fecha date not null, hora_inicio time not null, hora_fin time not null,
  estado text not null default 'disponible' check (estado in ('disponible','reservado','bloqueado')),
  created_by uuid default auth.uid(), updated_by uuid,
  check (hora_fin > hora_inicio),
  unique (professional_id, fecha, hora_inicio),
  exclude using gist (professional_id with =, tsrange(fecha + hora_inicio, fecha + hora_fin) with &&)
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  schedule_id uuid not null references public.schedules(id) on delete restrict,
  motivo text check (char_length(motivo) <= 200),
  estado text not null default 'programada'
    check (estado in ('programada','confirmada','atendida','cancelada','no_asistio')),
  observaciones text check (char_length(observaciones) <= 300),
  created_at timestamptz not null default now(), cancelled_at timestamptz
);
-- Doble reserva imposible: una sola cita activa por franja (respaldo del UPDATE atomico).
create unique index uq_cita_activa_por_franja on public.appointments(schedule_id) where estado <> 'cancelada';
create index ix_cita_paciente on public.appointments(patient_id);
create index ix_cita_prof on public.appointments(professional_id);
create index ix_sched_busqueda on public.schedules(fecha, estado);
create table public.status_history (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  estado_anterior text, estado_nuevo text not null,
  changed_by uuid default auth.uid(), changed_at timestamptz not null default now()
);

-- Utilidades (search_path vacio: evita secuestro de funciones)
create function public.ahora_local() returns timestamp language sql stable set search_path = ''
  as $$ select timezone('America/Bogota', now()) $$;
create function public.app_rol() returns text language sql stable security definer set search_path = ''
  as $$ select rol from public.profiles where id = auth.uid() and activo $$;

-- Perfil automatico: el rol SIEMPRE nace como 'paciente' (se ignora lo que envie el cliente)
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, nombres)
  values (new.id, coalesce(nullif(left(trim(new.raw_user_meta_data->>'nombres'),80),''), split_part(new.email,'@',1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Mass assignment: solo admin (o SQL Editor) cambia rol, activo e id
create function public.proteger_perfil() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and coalesce(public.app_rol(),'') <> 'admin' then
    new.id := old.id; new.rol := old.rol; new.activo := old.activo;
  end if;
  return new;
end $$;
create trigger trg_proteger_perfil before update on public.profiles for each row execute function public.proteger_perfil();

create function public.auditar() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_by := auth.uid(); return new; end $$;
create trigger aud_sp before update on public.specialties for each row execute function public.auditar();
create trigger aud_pr before update on public.professionals for each row execute function public.auditar();
create trigger aud_sc before update on public.schedules for each row execute function public.auditar();

-- Una franja reservada no se borra ni se mueve (caso: "medico cambia horario con reservas")
create function public.guardar_franja() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.estado = 'reservado' and (tg_op = 'DELETE' or new.fecha <> old.fecha or new.hora_inicio <> old.hora_inicio
     or new.hora_fin <> old.hora_fin or new.professional_id <> old.professional_id or new.estado = 'bloqueado') then
    raise exception 'franja_reservada';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;
create trigger trg_guardar_franja before update or delete on public.schedules for each row execute function public.guardar_franja();

-- Transiciones validas + historial, sin importar por que ruta se cambie el estado
create function public.validar_transicion() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.estado <> old.estado then
    if not ((old.estado, new.estado) in (('programada','confirmada'),('programada','cancelada'),
        ('confirmada','atendida'),('confirmada','no_asistio'),('confirmada','cancelada'))) then
      raise exception 'transicion_invalida';
    end if;
    insert into public.status_history(appointment_id, estado_anterior, estado_nuevo) values (old.id, old.estado, new.estado);
  end if;
  return new;
end $$;
create trigger trg_transicion before update on public.appointments for each row execute function public.validar_transicion();

-- ===== Operaciones de negocio (unica via de escritura para citas) =====
create function public.reservar_cita(p_schedule uuid, p_motivo text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_prof uuid; v_id uuid; v_p public.profiles;
begin
  select * into v_p from public.profiles where id = auth.uid() and activo and rol = 'paciente';
  if not found then raise exception 'no_autorizado'; end if;
  if v_p.documento is null or v_p.telefono is null then raise exception 'perfil_incompleto'; end if;
  update public.schedules s set estado = 'reservado'
   where s.id = p_schedule and s.estado = 'disponible' and (s.fecha + s.hora_inicio) > public.ahora_local()
     and exists (select 1 from public.professionals p join public.specialties e on e.id = p.specialty_id
                 where p.id = s.professional_id and p.activo and e.activo)
   returning s.professional_id into v_prof;
  if v_prof is null then raise exception 'franja_no_disponible'; end if;
  insert into public.appointments(patient_id, professional_id, schedule_id, motivo)
  values (auth.uid(), v_prof, p_schedule, left(trim(p_motivo),200)) returning id into v_id;
  insert into public.status_history(appointment_id, estado_anterior, estado_nuevo) values (v_id, null, 'programada');
  return v_id;
end $$;

-- Regla de cancelacion del paciente: minimo 12 horas de anticipacion
create function public.cambiar_estado_cita(p_id uuid, p_nuevo text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rol text := public.app_rol(); a public.appointments; s public.schedules;
begin
  select * into a from public.appointments where id = p_id for update;
  if not found or v_rol is null then raise exception 'no_encontrada'; end if;
  select * into s from public.schedules where id = a.schedule_id;
  if v_rol = 'paciente' then
    if a.patient_id <> auth.uid() then raise exception 'no_encontrada'; end if;
    if p_nuevo <> 'cancelada' then raise exception 'no_autorizado'; end if;
    if (s.fecha + s.hora_inicio) - public.ahora_local() < interval '12 hours' then raise exception 'cancelacion_tardia'; end if;
  elsif v_rol = 'profesional' then
    if not exists (select 1 from public.professionals where id = a.professional_id and profile_id = auth.uid()) then
      raise exception 'no_encontrada'; end if;
  end if;
  if p_nuevo in ('atendida','no_asistio') and (s.fecha + s.hora_inicio) > public.ahora_local() then
    raise exception 'cita_futura'; end if;
  update public.appointments set estado = p_nuevo,
     cancelled_at = case when p_nuevo = 'cancelada' then now() else cancelled_at end where id = p_id;
  if p_nuevo = 'cancelada' then update public.schedules set estado = 'disponible' where id = a.schedule_id; end if;
end $$;

create function public.admin_crear_horarios(p_prof uuid, p_fecha date, p_inicio time, p_fin time, p_min int)
returns int language plpgsql security definer set search_path = '' as $$
declare t time := p_inicio; n int := 0;
begin
  if public.app_rol() <> 'admin' then raise exception 'no_autorizado'; end if;
  if p_fecha < public.ahora_local()::date or p_min not between 10 and 120 or p_fin <= p_inicio
     or ((extract(epoch from (p_fin - p_inicio)) / 60) / p_min) > 24 then raise exception 'datos_invalidos'; end if;
  while t + make_interval(mins => p_min) <= p_fin loop
    insert into public.schedules(professional_id, fecha, hora_inicio, hora_fin)
    values (p_prof, p_fecha, t, t + make_interval(mins => p_min)) on conflict do nothing;
    n := n + 1; t := t + make_interval(mins => p_min);
  end loop;
  return n;
end $$;

create function public.admin_asignar_profesional(p_email text, p_specialty uuid, p_registro text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_id uuid;
begin
  if public.app_rol() <> 'admin' then raise exception 'no_autorizado'; end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then raise exception 'usuario_no_registrado'; end if;
  update public.profiles set rol = 'profesional' where id = v_uid;
  insert into public.professionals(profile_id, specialty_id, registro_profesional)
  values (v_uid, p_specialty, p_registro)
  on conflict (profile_id) do update set specialty_id = excluded.specialty_id, activo = true
  returning id into v_id;
  return v_id;
end $$;

-- ===== Consultas (solo exponen lo necesario) =====
create function public.listar_profesionales() returns table(id uuid, nombre text, especialidad_id uuid, especialidad text, activo boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, f.nombres, e.id, e.nombre, p.activo from public.professionals p
  join public.profiles f on f.id = p.profile_id join public.specialties e on e.id = p.specialty_id
  where public.app_rol() is not null and (p.activo and e.activo or public.app_rol() = 'admin')
  order by e.nombre, f.nombres $$;

create function public.buscar_disponibilidad(p_especialidad uuid default null, p_profesional uuid default null, p_fecha date default null)
returns table(schedule_id uuid, profesional_id uuid, profesional text, especialidad text, fecha date, hora_inicio time, hora_fin time)
language sql stable security definer set search_path = '' as $$
  select s.id, p.id, f.nombres, e.nombre, s.fecha, s.hora_inicio, s.hora_fin
  from public.schedules s join public.professionals p on p.id = s.professional_id
  join public.profiles f on f.id = p.profile_id join public.specialties e on e.id = p.specialty_id
  where public.app_rol() is not null and s.estado = 'disponible' and p.activo and e.activo
    and (s.fecha + s.hora_inicio) > public.ahora_local()
    and (p_especialidad is null or e.id = p_especialidad) and (p_profesional is null or p.id = p_profesional)
    and (p_fecha is null or s.fecha = p_fecha)
  order by s.fecha, s.hora_inicio limit 200 $$;

create function public.listar_citas(p_desde date default null, p_hasta date default null)
returns table(id uuid, fecha date, hora_inicio time, hora_fin time, profesional text, especialidad text,
              paciente text, documento text, estado text, motivo text)
language sql stable security definer set search_path = '' as $$
  select a.id, s.fecha, s.hora_inicio, s.hora_fin, pf.nombres, e.nombre, pa.nombres, pa.documento, a.estado, a.motivo
  from public.appointments a join public.schedules s on s.id = a.schedule_id
  join public.professionals p on p.id = a.professional_id join public.profiles pf on pf.id = p.profile_id
  join public.specialties e on e.id = p.specialty_id join public.profiles pa on pa.id = a.patient_id
  where (public.app_rol() = 'admin'
     or (public.app_rol() = 'paciente' and a.patient_id = auth.uid())
     or (public.app_rol() = 'profesional' and p.profile_id = auth.uid()))
    and (p_desde is null or s.fecha >= p_desde) and (p_hasta is null or s.fecha <= p_hasta)
  order by s.fecha, s.hora_inicio limit 500 $$;

create function public.indicadores(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.app_rol() <> 'admin' then raise exception 'no_autorizado'; end if;
  return jsonb_build_object(
   'por_estado', (select coalesce(jsonb_object_agg(estado, n), '{}') from (select a.estado, count(*) n from public.appointments a join public.schedules s on s.id = a.schedule_id where s.fecha between p_desde and p_hasta group by 1) x),
   'por_especialidad', (select coalesce(jsonb_object_agg(nombre, n), '{}') from (select e.nombre, count(*) n from public.appointments a join public.schedules s on s.id = a.schedule_id join public.professionals p on p.id = a.professional_id join public.specialties e on e.id = p.specialty_id where s.fecha between p_desde and p_hasta group by 1) x),
   'por_mes', (select coalesce(jsonb_object_agg(mes, n), '{}') from (select to_char(s.fecha,'YYYY-MM') mes, count(*) n from public.appointments a join public.schedules s on s.id = a.schedule_id where s.fecha between p_desde and p_hasta group by 1) x));
end $$;
