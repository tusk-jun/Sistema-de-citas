// Capa de acceso a datos. Toda autorizacion real vive en PostgreSQL (RLS + funciones).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Sesion por pestana (sessionStorage): cada pestana puede tener un usuario distinto y cerrar sesion en una no afecta a la otra.
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storage: window.sessionStorage } });
const ok = async (p) => { const { data, error } = await p; if (error) throw error; return data; };

export const Auth = {
  entrar: (email, password) => ok(sb.auth.signInWithPassword({ email, password })),
  registrar: (email, password, nombres) => ok(sb.auth.signUp({ email, password, options: { data: { nombres } } })),
  recuperar: (email) => ok(sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })),
  salir: () => sb.auth.signOut({ scope: 'local' }),
  sesion: async () => (await sb.auth.getSession()).data.session,
  onCambio: (fn) => sb.auth.onAuthStateChange((ev) => fn(ev)),
};
export const Perfil = {
  // El rol se lee SIEMPRE de la base (no de metadatos del token).
  mio: async () => { const u = (await sb.auth.getUser()).data.user; if (!u) return null;
    return ok(sb.from('profiles').select('id,nombres,documento,telefono,fecha_nacimiento,rol,activo').eq('id', u.id).single()); },
  guardar: (id, v) => ok(sb.from('profiles').update({ nombres: v.nombres, documento: v.documento, telefono: v.telefono, fecha_nacimiento: v.fecha_nacimiento }).eq('id', id)),
};
export const Citas = {
  especialidades: () => ok(sb.from('specialties').select('id,nombre,descripcion,activo').order('nombre')),
  profesionales: () => ok(sb.rpc('listar_profesionales')),
  disponibilidad: (esp, prof, fecha) => ok(sb.rpc('buscar_disponibilidad', { p_especialidad: esp || null, p_profesional: prof || null, p_fecha: fecha || null })),
  reservar: (schedule, motivo) => ok(sb.rpc('reservar_cita', { p_schedule: schedule, p_motivo: motivo || null })),
  listar: (desde, hasta) => ok(sb.rpc('listar_citas', { p_desde: desde || null, p_hasta: hasta || null })),
  cambiarEstado: (id, nuevo) => ok(sb.rpc('cambiar_estado_cita', { p_id: id, p_nuevo: nuevo })),
};
export const Admin = {
  crearEspecialidad: (nombre, descripcion) => ok(sb.from('specialties').insert({ nombre, descripcion: descripcion || null })),
  activarEspecialidad: (id, activo) => ok(sb.from('specialties').update({ activo }).eq('id', id)),
  asignarProfesional: (email, esp, registro) => ok(sb.rpc('admin_asignar_profesional', { p_email: email, p_specialty: esp, p_registro: registro || null })),
  activarProfesional: (id, activo) => ok(sb.from('professionals').update({ activo }).eq('id', id)),
  crearHorarios: (prof, fecha, ini, fin, min) => ok(sb.rpc('admin_crear_horarios', { p_prof: prof, p_fecha: fecha, p_inicio: ini, p_fin: fin, p_min: min })),
  horarios: (prof) => ok(sb.from('schedules').select('id,fecha,hora_inicio,hora_fin,estado').eq('professional_id', prof).gte('fecha', hoy()).order('fecha').order('hora_inicio').limit(120)),
  cambiarHorario: (id, estado) => ok(sb.from('schedules').update({ estado }).eq('id', id)),
  borrarHorario: (id) => ok(sb.from('schedules').delete().eq('id', id)),
  indicadores: (d, h) => ok(sb.rpc('indicadores', { p_desde: d, p_hasta: h })),
};
export const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
