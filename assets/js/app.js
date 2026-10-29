import { Auth, Perfil, Citas, Admin, hoy } from './api.js';
import { h, limpiar, toast, msgError, fFecha, fHora, confirmar, cargando, vacio, campo, conBoton } from './ui.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const salir = document.getElementById('salir');
let perfil = null;

const RUTAS = {
  paciente: [['reservar', 'Reservar cita', vReservar], ['mis-citas', 'Mis citas', vMisCitas], ['perfil', 'Perfil', vPerfil]],
  profesional: [['agenda', 'Mi agenda', vAgenda], ['perfil', 'Perfil', vPerfil]],
  admin: [['resumen', 'Resumen', vResumen], ['especialidades', 'Especialidades', vEspecialidades],
    ['profesionales', 'Profesionales', vProfesionales], ['horarios', 'Horarios', vHorarios], ['citas', 'Citas', vCitasAdmin], ['perfil', 'Perfil', vPerfil]],
};

async function iniciar() {
  salir.onclick = async () => { await Auth.salir(); };
  // No devolver promesas ni llamar a Supabase dentro del callback (provoca bloqueo): se difiere.
  Auth.onCambio((ev) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') setTimeout(arrancar, 0); });
  window.addEventListener('hashchange', pintar);
  await arrancar();
}
async function arrancar() {
  try {
    perfil = (await Auth.sesion()) ? await Perfil.mio() : null;
    if (perfil && !perfil.activo) { await Auth.salir(); perfil = null; toast('Tu cuenta está desactivada. Contacta a recepción.', 'bad'); }
  } catch (e) { perfil = null; toast(msgError(e), 'bad'); }
  salir.hidden = !perfil; pintar();
}
function pintar() {
  limpiar(nav); limpiar(main);
  if (!perfil) return vAcceso();
  const rutas = RUTAS[perfil.rol] || [];               // rol desconocido = sin acceso (deny by default)
  const actual = location.hash.slice(1);
  const ruta = rutas.find((r) => r[0] === actual) || rutas[0];
  if (!ruta) return main.append(h('h1', { text: 'Acceso denegado' }), vacio('Tu cuenta no tiene un rol asignado.'));
  for (const [id, txt] of rutas) nav.append(h('a', { href: '#' + id, text: txt, 'aria-current': id === ruta[0] ? 'page' : null }));
  main.append(h('h1', { text: ruta[1] })); ruta[2](); main.focus();
}

/* ---------- Acceso ---------- */
function vAcceso(modo = 'entrar') {
  limpiar(main);
  const esReg = modo === 'registro', esRec = modo === 'recuperar';
  const err = h('p', { class: 'err', role: 'alert' });
  const email = h('input', { type: 'email', required: true, autocomplete: 'email' });
  const pass = h('input', { type: 'password', required: true, minlength: 8, autocomplete: esReg ? 'new-password' : 'current-password' });
  const nom = h('input', { type: 'text', required: true, minlength: 2, maxlength: 80, autocomplete: 'name' });
  const btn = h('button', { class: 'btn', type: 'submit', text: esReg ? 'Crear cuenta' : esRec ? 'Enviar instrucciones' : 'Entrar' });
  const f = h('form', { class: 'panel auth', novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault(); err.textContent = '';
    if (!email.value.includes('@') || (esReg && pass.value.length < 8) || (!esReg && !esRec && !pass.value) || (esReg && nom.value.trim().length < 2)) {
      err.textContent = 'Revisa el correo y la contraseña (al crear cuenta, mínimo 8 caracteres).'; return; }
    await conBoton(btn, async () => {
      if (esReg) { await Auth.registrar(email.value.trim(), pass.value, nom.value.trim()); toast('Cuenta creada. Si se pide, confirma tu correo y entra.', 'ok'); vAcceso('entrar'); }
      else if (esRec) { await Auth.recuperar(email.value.trim()); toast('Si el correo existe, recibirás instrucciones.', 'ok'); }
      else await Auth.entrar(email.value.trim(), pass.value);
    });
  } },
    h('h2', { text: esReg ? 'Crear cuenta de paciente' : esRec ? 'Recuperar contraseña' : 'Iniciar sesión' }),
    esReg ? campo('Nombre completo', nom, 'f-nom') : '', campo('Correo', email, 'f-mail'), esRec ? '' : campo('Contraseña', pass, 'f-pass'),
    err, btn,
    h('p', {}, h('button', { type: 'button', class: 'link', text: esReg ? 'Ya tengo cuenta' : 'Crear cuenta', onclick: () => vAcceso(esReg ? 'entrar' : 'registro') }), ' · ',
      h('button', { type: 'button', class: 'link', text: esRec ? 'Volver' : 'Olvidé mi contraseña', onclick: () => vAcceso(esRec ? 'entrar' : 'recuperar') })));
  main.append(h('h1', { text: 'Reserva tu cita médica en minutos' }), h('p', { text: 'Consultorios Ceiba.' }), f);
}

/* ---------- Paciente ---------- */
async function vReservar() {
  const esp = h('select'), prof = h('select'), fecha = h('input', { type: 'date', min: hoy() });
  const lista = h('div', { class: 'days' });
  let profs = [];
  try {
    const [es, pr] = await Promise.all([Citas.especialidades(), Citas.profesionales()]);
    profs = pr; esp.append(h('option', { value: '', text: 'Todas' }), ...es.filter((e) => e.activo).map((e) => h('option', { value: e.id, text: e.nombre })));
  } catch (e) { return main.append(vacio(msgError(e))); }
  const llenarProf = () => { limpiar(prof); prof.append(h('option', { value: '', text: 'Todos' }),
    ...profs.filter((p) => !esp.value || p.especialidad_id === esp.value).map((p) => h('option', { value: p.id, text: p.nombre }))); };
  llenarProf();
  const buscar = async () => {
    limpiar(lista); lista.append(cargando());
    try {
      const filas = await Citas.disponibilidad(esp.value, prof.value, fecha.value); limpiar(lista);
      if (!filas.length) return lista.append(vacio('No hay franjas libres con esos filtros. Prueba otra fecha o especialidad.'));
      const dias = Map.groupBy(filas, (f) => f.fecha);
      for (const [d, fs] of dias) lista.append(h('section', { class: 'day' }, h('h3', { text: fFecha(d) }),
        h('div', { class: 'slots' }, fs.map((f) => h('button', { class: 'slot', onclick: () => reservar(f, buscar) },
          h('b', { text: fHora(f.hora_inicio) }), h('small', { text: f.profesional + ' · ' + f.especialidad }))))));
    } catch (e) { limpiar(lista); lista.append(vacio(msgError(e))); }
  };
  esp.onchange = () => { llenarProf(); buscar(); }; prof.onchange = buscar; fecha.onchange = buscar;
  main.append(h('form', { class: 'panel grid', onsubmit: (e) => e.preventDefault() },
    campo('Especialidad', esp, 'r-esp'), campo('Profesional', prof, 'r-prof'), campo('Fecha', fecha, 'r-fecha')), lista);
  buscar();
}
async function reservar(f, recargar) {
  const motivo = h('textarea', { maxlength: 200, rows: 2, 'aria-label': 'Motivo breve (opcional, sin información clínica)' });
  if (!(await confirmar('Confirmar reserva', `${fFecha(f.fecha)}, ${fHora(f.hora_inicio)} con ${f.profesional} (${f.especialidad}).`, h('label', {}, 'Motivo breve (opcional, evita datos clínicos)', motivo)))) return;
  try { await Citas.reservar(f.schedule_id, motivo.value.trim()); toast('Cita reservada. Estado: programada.', 'ok'); location.hash = 'mis-citas'; }
  catch (e) { toast(msgError(e), 'bad'); recargar(); }
}
async function vMisCitas() {
  const cont = h('div', {}, cargando()); main.append(cont);
  const cargar = async () => {
    try {
      const filas = await Citas.listar(); limpiar(cont);
      if (!filas.length) return cont.append(vacio('Aún no tienes citas. Reserva la primera desde "Reservar cita".'));
      cont.append(tabla(['Fecha', 'Hora', 'Profesional', 'Especialidad', 'Estado', ''], filas.map((c) => [fFecha(c.fecha), fHora(c.hora_inicio), c.profesional, c.especialidad, tag(c.estado),
        ['programada', 'confirmada'].includes(c.estado) ? h('button', { class: 'btn bad sm', text: 'Cancelar', onclick: async (ev) => {
          if (await confirmar('Cancelar cita', 'La franja quedará libre para otras personas.')) await conBoton(ev.target, async () => { await Citas.cambiarEstado(c.id, 'cancelada'); toast('Cita cancelada.', 'ok'); await cargar(); }); } }) : ''])));
    } catch (e) { limpiar(cont); cont.append(vacio(msgError(e))); }
  };
  cargar();
}
function vPerfil() {
  const v = (k) => perfil[k] || '';
  const nom = h('input', { value: v('nombres'), required: true, minlength: 2, maxlength: 80 }), doc = h('input', { value: v('documento'), pattern: '[0-9A-Za-z\\-]{5,20}' });
  const tel = h('input', { value: v('telefono'), type: 'tel', pattern: '[0-9+ ]{7,15}' }), nac = h('input', { value: v('fecha_nacimiento'), type: 'date', max: hoy() });
  const btn = h('button', { class: 'btn', type: 'submit', text: 'Guardar perfil' });
  main.append(h('form', { class: 'panel grid', onsubmit: async (ev) => { ev.preventDefault(); if (!ev.target.reportValidity()) return;
    await conBoton(btn, async () => { await Perfil.guardar(perfil.id, { nombres: nom.value.trim(), documento: doc.value.trim() || null, telefono: tel.value.trim() || null, fecha_nacimiento: nac.value || null });
      perfil = await Perfil.mio(); toast('Perfil guardado.', 'ok'); }); } },
    campo('Nombre completo', nom, 'p-nom'), campo('Documento', doc, 'p-doc'), campo('Teléfono', tel, 'p-tel'), campo('Fecha de nacimiento', nac, 'p-nac'), btn),
    h('p', { class: 'empty', text: 'Solo pedimos datos de contacto. No registres información clínica.' }));
}

/* ---------- Profesional ---------- */
async function vAgenda() {
  const desde = h('input', { type: 'date', value: hoy() }), cont = h('div', {}, cargando());
  const cargar = async () => {
    try {
      const filas = await Citas.listar(desde.value || hoy()); limpiar(cont);
      if (!filas.length) return cont.append(vacio('No tienes citas desde esa fecha.'));
      const sig = { programada: ['confirmada', 'cancelada'], confirmada: ['atendida', 'no_asistio', 'cancelada'] };
      cont.append(tabla(['Fecha', 'Hora', 'Paciente', 'Motivo', 'Estado', 'Cambiar a'], filas.map((c) => [fFecha(c.fecha), fHora(c.hora_inicio), c.paciente, c.motivo || '—', tag(c.estado),
        h('div', { class: 'row' }, (sig[c.estado] || []).map((n) => h('button', { class: 'btn sm' + (n === 'cancelada' ? ' bad' : ''), text: n.replace('_', ' '),
          onclick: async (ev) => { if (await confirmar('Cambiar estado', `La cita pasará a "${n.replace('_', ' ')}".`)) await conBoton(ev.target, async () => { await Citas.cambiarEstado(c.id, n); await cargar(); }); } })))])));
    } catch (e) { limpiar(cont); cont.append(vacio(msgError(e))); }
  };
  desde.onchange = cargar; main.append(h('div', { class: 'panel' }, campo('Ver desde', desde, 'a-desde')), cont); cargar();
}

/* ---------- Administración ---------- */
async function vResumen() {
  const d = h('input', { type: 'date', value: hoy().slice(0, 8) + '01' }), hh = h('input', { type: 'date', value: hoy() }), cont = h('div', {}, cargando());
  const cargar = async () => {
    try {
      const r = await Admin.indicadores(d.value, hh.value); limpiar(cont);
      const grupo = (t, o) => { const max = Math.max(1, ...Object.values(o)); return h('section', { class: 'panel' }, h('h2', { text: t }),
        Object.keys(o).length ? Object.entries(o).map(([k, n]) => h('div', { class: 'stat' }, h('span', { text: `${k.replace('_', ' ')}: ${n}` }),
          h('div', { class: 'bar-fill', role: 'img', 'aria-label': `${n} de ${max}`, ref: null }))) : vacio('Sin citas en el periodo.')); };
      cont.append(grupo('Por estado', r.por_estado), grupo('Por especialidad', r.por_especialidad), grupo('Por mes', r.por_mes));
      cont.querySelectorAll('.bar-fill').forEach((b) => { const m = b.getAttribute('aria-label').split(' de '); b.style.width = Math.round((m[0] / m[1]) * 100) + '%'; });
    } catch (e) { limpiar(cont); cont.append(vacio(msgError(e))); }
  };
  d.onchange = cargar; hh.onchange = cargar; main.append(h('div', { class: 'panel grid' }, campo('Desde', d, 'i-d'), campo('Hasta', hh, 'i-h')), cont); cargar();
}
async function vEspecialidades() {
  const nombre = h('input', { required: true, minlength: 3, maxlength: 60 }), desc = h('input', { maxlength: 200 }), cont = h('div', {}, cargando());
  const cargar = async () => { try { const es = await Citas.especialidades(); limpiar(cont);
    cont.append(tabla(['Nombre', 'Descripción', 'Estado', ''], es.map((e) => [e.nombre, e.descripcion || '—', e.activo ? 'Activa' : 'Inactiva',
      h('button', { class: 'btn ghost sm', text: e.activo ? 'Desactivar' : 'Activar', onclick: async (ev) => conBoton(ev.target, async () => { await Admin.activarEspecialidad(e.id, !e.activo); await cargar(); }) })]))); }
    catch (e) { limpiar(cont); cont.append(vacio(msgError(e))); } };
  const btn = h('button', { class: 'btn', type: 'submit', text: 'Crear especialidad' });
  main.append(h('form', { class: 'panel grid', onsubmit: async (ev) => { ev.preventDefault(); if (!ev.target.reportValidity()) return;
    await conBoton(btn, async () => { await Admin.crearEspecialidad(nombre.value.trim(), desc.value.trim()); toast('Especialidad creada.', 'ok'); ev.target.reset(); await cargar(); }); } },
    campo('Nombre', nombre, 'e-nom'), campo('Descripción', desc, 'e-desc'), btn), cont); cargar();
}
async function vProfesionales() {
  const mail = h('input', { type: 'email', required: true }), reg = h('input', { maxlength: 30 }), esp = h('select', { required: true }), cont = h('div', {}, cargando());
  const cargar = async () => { try { const [es, pr] = await Promise.all([Citas.especialidades(), Citas.profesionales()]); limpiar(cont); limpiar(esp);
    esp.append(...es.filter((e) => e.activo).map((e) => h('option', { value: e.id, text: e.nombre })));
    cont.append(tabla(['Profesional', 'Especialidad', 'Estado', ''], pr.map((p) => [p.nombre, p.especialidad, p.activo ? 'Activo' : 'Inactivo',
      h('button', { class: 'btn ghost sm', text: p.activo ? 'Desactivar' : 'Activar', onclick: async (ev) => conBoton(ev.target, async () => { await Admin.activarProfesional(p.id, !p.activo); await cargar(); }) })]))); }
    catch (e) { limpiar(cont); cont.append(vacio(msgError(e))); } };
  const btn = h('button', { class: 'btn', type: 'submit', text: 'Asignar como profesional' });
  main.append(h('form', { class: 'panel grid', onsubmit: async (ev) => { ev.preventDefault(); if (!ev.target.reportValidity()) return;
    await conBoton(btn, async () => { await Admin.asignarProfesional(mail.value.trim(), esp.value, reg.value.trim()); toast('Profesional asignado.', 'ok'); ev.target.reset(); await cargar(); }); } },
    campo('Correo de usuario ya registrado', mail, 'pr-mail'), campo('Especialidad', esp, 'pr-esp'), campo('Registro profesional (opcional)', reg, 'pr-reg'), btn), cont); cargar();
}
async function vHorarios() {
  const prof = h('select', { required: true }), fecha = h('input', { type: 'date', min: hoy(), required: true }), ini = h('input', { type: 'time', value: '08:00', required: true }),
    fin = h('input', { type: 'time', value: '12:00', required: true }), min = h('input', { type: 'number', min: 10, max: 120, value: 30, required: true }), cont = h('div');
  try { prof.append(...(await Citas.profesionales()).filter((p) => p.activo).map((p) => h('option', { value: p.id, text: `${p.nombre} · ${p.especialidad}` }))); }
  catch (e) { return main.append(vacio(msgError(e))); }
  const cargar = async () => { if (!prof.value) return; limpiar(cont); cont.append(cargando());
    try { const hs = await Admin.horarios(prof.value); limpiar(cont);
      if (!hs.length) return cont.append(vacio('Este profesional no tiene franjas futuras.'));
      cont.append(tabla(['Fecha', 'Franja', 'Estado', ''], hs.map((s) => [fFecha(s.fecha), `${fHora(s.hora_inicio)}–${fHora(s.hora_fin)}`, s.estado,
        s.estado === 'reservado' ? '' : h('div', { class: 'row' },
          h('button', { class: 'btn ghost sm', text: s.estado === 'bloqueado' ? 'Habilitar' : 'Bloquear', onclick: (ev) => conBoton(ev.target, async () => { await Admin.cambiarHorario(s.id, s.estado === 'bloqueado' ? 'disponible' : 'bloqueado'); await cargar(); }) }),
          h('button', { class: 'btn bad sm', text: 'Eliminar', onclick: async (ev) => { if (await confirmar('Eliminar franja', 'Esta acción no se puede deshacer.')) await conBoton(ev.target, async () => { await Admin.borrarHorario(s.id); await cargar(); }); } }))])));
    } catch (e) { limpiar(cont); cont.append(vacio(msgError(e))); } };
  const btn = h('button', { class: 'btn', type: 'submit', text: 'Crear franjas' }); prof.onchange = cargar;
  main.append(h('form', { class: 'panel grid', onsubmit: async (ev) => { ev.preventDefault(); if (!ev.target.reportValidity()) return;
    await conBoton(btn, async () => { const n = await Admin.crearHorarios(prof.value, fecha.value, ini.value, fin.value, Number(min.value)); toast(`${n} franjas procesadas.`, 'ok'); await cargar(); }); } },
    campo('Profesional', prof, 'h-prof'), campo('Fecha', fecha, 'h-fecha'), campo('Desde', ini, 'h-ini'), campo('Hasta', fin, 'h-fin'), campo('Minutos por cita', min, 'h-min'), btn), cont); cargar();
}
async function vCitasAdmin() {
  const cont = h('div', {}, cargando()); main.append(cont);
  const cargar = async () => { try { const fs = await Citas.listar(hoy().slice(0, 8) + '01'); limpiar(cont);
    if (!fs.length) return cont.append(vacio('No hay citas desde el inicio del mes.'));
    const sig = { programada: ['confirmada', 'cancelada'], confirmada: ['atendida', 'no_asistio', 'cancelada'] };
    cont.append(tabla(['Fecha', 'Hora', 'Paciente', 'Profesional', 'Estado', 'Cambiar a'], fs.map((c) => [fFecha(c.fecha), fHora(c.hora_inicio), c.paciente, `${c.profesional} · ${c.especialidad}`, tag(c.estado),
      h('div', { class: 'row' }, (sig[c.estado] || []).map((n) => h('button', { class: 'btn sm' + (n === 'cancelada' ? ' bad' : ''), text: n.replace('_', ' '),
        onclick: (ev) => conBoton(ev.target, async () => { await Citas.cambiarEstado(c.id, n); await cargar(); }) })))])));
  } catch (e) { limpiar(cont); cont.append(vacio(msgError(e))); } };
  cargar();
}

/* ---------- Helpers de presentación ---------- */
const tag = (estado) => h('span', { class: 'tag ' + estado, text: estado.replace('_', ' ') });
function tabla(cols, filas) {
  return h('div', { class: 'table-wrap panel' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col', text: c })))),
    h('tbody', {}, filas.map((f) => h('tr', {}, f.map((c) => h('td', {}, c)))))));
}
iniciar();
