// Formularios v2: todos terminan en Leads. El equipo da seguimiento y crea la
// Orden a mano; ningún formulario público crea órdenes ni reserva espacios.
import { T, crear } from '../config.js';

// Arma el texto de `Detalle`: una línea "Etiqueta: valor" por dato con valor.
export const lineas = (pares) => pares.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');

export const fechaLarga = (v) => (v
  ? new Date(v + 'T00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  : '');

// Fecha solo de lunes a sábado (el input date nativo no puede deshabilitar días).
export function bloquearDomingos(input) {
  const field = input.closest('.mfield');
  const hoy = new Date();
  input.min = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const check = () => {
    const bad = !!input.value && new Date(input.value + 'T00:00').getDay() === 0;
    input.setCustomValidity(bad ? 'Los eventos son de lunes a sábado.' : '');
    field?.classList.toggle('invalid', bad);
    let msg = field?.querySelector('.mfield-err');
    if (bad && field && !msg) { msg = document.createElement('span'); msg.className = 'mfield-err'; field.appendChild(msg); }
    if (msg) msg.textContent = bad ? 'Los eventos son de lunes a sábado — elige otro día.' : '';
  };
  input.addEventListener('input', check);
  input.addEventListener('change', check);
}

// Grupo de tarjetas seleccionables obligatorio (radio o checkbox): marca en rojo
// si no hay ninguna elegida y se limpia al elegir.
export function grupoObligatorio(form, name) {
  const grp = form.querySelector(`input[name="${name}"]`)?.closest('.opt-group');
  const ok = () => form.querySelectorAll(`input[name="${name}"]:checked`).length > 0;
  form.querySelectorAll(`input[name="${name}"]`).forEach((i) => i.addEventListener('change', () => grp?.classList.remove('invalid')));
  return () => { const v = ok(); grp?.classList.toggle('invalid', !v); if (!v) grp?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return v; };
}

// Conecta un <form> a Leads.
//   build(g, fd) → { interes, mensaje?, detalle }   (g = valor de texto por nombre)
//   validate(form) → boolean                         (validaciones extra)
export function initLeadForm({ formId = 'f', doneId = 'done', build, validate }) {
  const form = document.getElementById(formId);
  const done = document.getElementById(doneId);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    if (validate && !validate(form)) return;
    const fd = new FormData(form);
    const g = (k) => (fd.get(k) || '').toString().trim();
    const btn = form.querySelector('[type=submit]');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Enviando…';
    const { interes, mensaje, detalle } = build(g, fd);
    try {
      await crear(T.leads, {
        Nombre: g('nombre'),
        WhatsApp: g('telefono'),
        Correo: g('correo') || undefined,
        Interes: interes,
        Mensaje: mensaje || undefined,
        Detalle: detalle || undefined,
        Estatus: 'Nuevo',
      });
      form.hidden = true;
      done.hidden = false;
      done.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      btn.disabled = false; btn.textContent = label;
      alert('No pudimos enviar tu solicitud. Intenta de nuevo o escríbenos por WhatsApp.');
      console.error(err);
    }
  });
}
