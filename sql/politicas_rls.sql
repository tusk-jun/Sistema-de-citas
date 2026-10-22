-- Deny by default: RLS en TODAS las tablas; las citas solo se escriben por funciones (reservar_cita, cambiar_estado_cita).
alter table public.profiles enable row level security;
alter table public.specialties enable row level security;
alter table public.professionals enable row level security;
alter table public.schedules enable row level security;
alter table public.appointments enable row level security;
alter table public.status_history enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.specialties to authenticated;
grant select, update on public.professionals to authenticated;
grant select, delete, update on public.schedules to authenticated;
grant select on public.appointments, public.status_history to authenticated;
grant execute on function public.reservar_cita, public.cambiar_estado_cita, public.admin_crear_horarios,
  public.admin_asignar_profesional, public.listar_profesionales, public.buscar_disponibilidad,
  public.listar_citas, public.indicadores to authenticated;
grant execute on function public.app_rol, public.ahora_local to authenticated;

-- profiles: cada quien ve/edita el suyo (rol y activo protegidos por trigger); admin ve todos
create policy perfil_select on public.profiles for select to authenticated using (id = auth.uid() or public.app_rol() = 'admin');
create policy perfil_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.app_rol() = 'admin') with check (id = auth.uid() or public.app_rol() = 'admin');
-- catalogos
create policy esp_select on public.specialties for select to authenticated using (activo or public.app_rol() = 'admin');
create policy esp_insert on public.specialties for insert to authenticated with check (public.app_rol() = 'admin');
create policy esp_update on public.specialties for update to authenticated using (public.app_rol() = 'admin') with check (public.app_rol() = 'admin');
create policy prof_select on public.professionals for select to authenticated using (public.app_rol() = 'admin' or profile_id = auth.uid());
create policy prof_update on public.professionals for update to authenticated using (public.app_rol() = 'admin') with check (public.app_rol() = 'admin');
-- horarios: admin gestiona; profesional ve los propios; pacientes consultan via buscar_disponibilidad()
create policy hor_select on public.schedules for select to authenticated
  using (public.app_rol() = 'admin' or professional_id in (select id from public.professionals where profile_id = auth.uid()));
create policy hor_update on public.schedules for update to authenticated using (public.app_rol() = 'admin') with check (public.app_rol() = 'admin');
create policy hor_delete on public.schedules for delete to authenticated using (public.app_rol() = 'admin');
-- citas: solo lectura directa (propias / asignadas / admin). Sin INSERT/UPDATE/DELETE: se deniega por defecto.
create policy cita_select on public.appointments for select to authenticated using (
  patient_id = auth.uid() or public.app_rol() = 'admin'
  or professional_id in (select id from public.professionals where profile_id = auth.uid()));
create policy hist_select on public.status_history for select to authenticated using (
  public.app_rol() = 'admin' or exists (select 1 from public.appointments a where a.id = appointment_id
    and (a.patient_id = auth.uid() or a.professional_id in (select id from public.professionals where profile_id = auth.uid()))));

-- Matriz rol / recurso / operacion (S=select I=insert U=update D=delete):
-- profiles:      paciente S,U propio | profesional S,U propio | admin S,U todos
-- specialties:   todos S (activas)   | admin S,I,U
-- professionals: profesional S propio | admin S,U (alta por admin_asignar_profesional)
-- schedules:     profesional S propio | admin S,U,D (reservadas protegidas por trigger) | pacientes: buscar_disponibilidad()
-- appointments / status_history: S propias, asignadas o admin; escritura SOLO por reservar_cita / cambiar_estado_cita
