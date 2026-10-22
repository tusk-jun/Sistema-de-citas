// Utilidades de interfaz. Nunca se usa innerHTML: todo texto entra por textContent.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
export const limpiar = (el) => el.replaceChildren();
export function toast(msg, tipo = '') {
  const t = h('div', { class: 'toast ' + tipo, text: msg });
  document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 5000);
}
const ERRORES = {
  franja_no_disponible: 'Alguien ya tomó esa franja. Elige otra: actualizamos la lista.',
  perfil_incompleto: 'Completa tu documento y teléfono en Perfil antes de reservar.',
  cancelacion_tardia: 'Solo puedes cancelar con al menos 12 horas de anticipación.',
  transicion_invalida: 'Ese cambio de estado no está permitido.',
  cita_futura: 'Solo puedes marcar atendida o no asistió una cita que ya inició.',
  franja_reservada: 'La franja tiene una cita. Cancela la cita primero.',
  usuario_no_registrado: 'Ese correo aún no se ha registrado en el sistema.',
  no_autorizado: 'No tienes permiso para esta acción.', no_encontrada: 'No encontramos esa cita.',
  datos_invalidos: 'Revisa los datos: fecha futura, horas válidas y duración de 10 a 120 min.',
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
};
export function msgError(e) {
  const m = String(e?.message || '');
  for (const k of Object.keys(ERRORES)) if (m.includes(k)) return ERRORES[k];
  if (e?.code === '23505') return 'Ya existe un registro con esos datos.';
  if (e?.code === '23514') return 'Algún dato no cumple el formato permitido.';
  if (m.includes('JWT') || e?.status === 401) return 'Tu sesión expiró. Inicia sesión de nuevo.';
  if (m.includes('fetch')) return 'Sin conexión con el servidor. Intenta de nuevo.';
  console.error(e); return 'No se pudo completar la acción. Intenta de nuevo.';
}
export const fFecha = (f) => new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
export const fHora = (t) => t.slice(0, 5);
export function confirmar(titulo, texto, extra) {
  const d = document.getElementById('dlg'); limpiar(d);
  return new Promise((res) => {
    const cierra = (v) => { d.close(); res(v); };
    d.append(h('h2', { text: titulo }), h('p', { text: texto }), extra || '',
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => cierra(true), text: 'Confirmar' }),
        h('button', { class: 'btn ghost', onclick: () => cierra(false), text: 'Volver' })));
    d.onclose = () => res(false); d.showModal();
  });
}
export const cargando = () => h('p', { class: 'empty', text: 'Cargando…' });
export const vacio = (t) => h('p', { class: 'empty', text: t });
export const campo = (label, input, id) => { input.id = id; return h('label', { for: id }, label, input); };
export async function conBoton(btn, fn) {
  btn.disabled = true; try { return await fn(); } catch (e) { toast(msgError(e), 'bad'); } finally { btn.disabled = false; }
}
