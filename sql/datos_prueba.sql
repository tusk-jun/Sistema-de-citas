-- Datos FICTICIOS. 1) Cree estos usuarios en Authentication > Users (Auto Confirm User):
--    admin.demo@example.com, medico1.demo@example.com, medico2.demo@example.com, paciente.demo@example.com
-- 2) Ejecute este script (es repetible).
insert into public.specialties(nombre, descripcion) values
 ('Medicina general','Consulta de primer nivel'),('Pediatria','Atencion de ninos y adolescentes'),('Odontologia','Salud oral')
on conflict (nombre) do nothing;

do $$
declare u uuid; e uuid; p uuid; d int; t time; r record;
begin
  select id into u from auth.users where email = 'admin.demo@example.com';
  if u is not null then update public.profiles set rol = 'admin', nombres = 'Admin Demo' where id = u; end if;

  for r in select * from (values ('medico1.demo@example.com','Medicina general','Dr. Perez Demo'),
                                 ('medico2.demo@example.com','Pediatria','Dra. Gomez Demo')) x(em, sp, nom) loop
    select id into u from auth.users where email = r.em;
    continue when u is null;
    select id into e from public.specialties where nombre = r.sp;
    update public.profiles set rol = 'profesional', nombres = r.nom where id = u;
    insert into public.professionals(profile_id, specialty_id) values (u, e)
      on conflict (profile_id) do update set specialty_id = excluded.specialty_id returning id into p;
    for d in 1..14 loop
      continue when extract(isodow from (current_date + d)) > 5;
      for t in select generate_series(timestamp '2000-01-01 08:00', timestamp '2000-01-01 11:30', interval '30 minutes')::time loop
        insert into public.schedules(professional_id, fecha, hora_inicio, hora_fin)
        values (p, current_date + d, t, t + interval '30 minutes') on conflict do nothing;
      end loop;
    end loop;
  end loop;
end $$;
-- El paciente demo solo se registra; completa documento y telefono desde "Perfil" en la app.
