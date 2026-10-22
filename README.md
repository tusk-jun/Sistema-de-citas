# Ceiba · Sistema web de reserva de citas médicas (MVP)
Proyecto integrador de Análisis y Diseño de Software. Clínica **ficticia**; no usar datos reales.
Integrantes: Joicer Prieto - Anthony Larios · Publicación: _(URL de GitHub Pages)_

## Qué hace
- **Paciente:** registro/login, perfil, búsqueda de franjas por especialidad/profesional/fecha, reserva, "Mis citas", cancelación (mín. 12 h de anticipación).
- **Profesional:** agenda propia y cambio de estado (programada → confirmada → atendida / no asistió / cancelada).
- **Administrador:** especialidades, asignación de profesionales, generación y bloqueo de horarios, citas e indicadores.

## Decisiones técnicas
- **Doble reserva:** `reservar_cita()` cambia la franja con un `UPDATE ... WHERE estado='disponible'` atómico + índice único parcial `uq_cita_activa_por_franja`.
- **Cancelación:** la cita se conserva (`cancelada`) y la franja vuelve a `disponible`.
- **Superposición:** restricción `EXCLUDE USING gist` en `schedules`. Una franja reservada no se mueve ni se borra (trigger `guardar_franja`).
- **Roles:** el rol nace siempre `paciente` (trigger); solo admin lo cambia (trigger `proteger_perfil`). El frontend lee el rol de la base, no del token.
- **Citas:** sin políticas INSERT/UPDATE/DELETE; solo funciones `security definer` con `search_path` vacío validan dueño, rol y transición.
- **Interfaz:** sin `innerHTML`; CSP por `<meta>` (GitHub Pages no permite cabeceras: `frame-ancestors` y HSTS quedan fuera de alcance).
- Hora local fija `America/Bogota`.

## Limitaciones declaradas (honestidad del MVP)
- No hay UI de "Usuarios" para activar/desactivar pacientes ni editar profesionales (se hace por SQL).
- Un profesional debe registrarse primero; el admin lo asigna por correo (no se crean cuentas Auth desde el navegador).
- No incluidos aún: documento de análisis, diagramas, matriz de trazabilidad, plan de pruebas ejecutado, bitácora de IA.
