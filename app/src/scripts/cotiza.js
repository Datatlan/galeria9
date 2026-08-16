// Flujo "Cotiza tu evento" — estado, total en vivo y creación de Orden borrador.
import { BASE, T, crear, crearMuchos, leer } from '../config.js';
import { money } from '../data/catalogo.js';

const data = JSON.parse(document.getElementById('catData').textContent);
const espacioById = (id) => data.espacios.find((e) => e.id === id);
const extraById = (id) => data.extras.find((x) => x.id === id);

const form = document.getElementById('quoteForm');
const panels = [...form.querySelectorAll('.panel')];
const stepsEls = [...document.querySelectorAll('#steps .step')];
const btnBack = document.getElementById('btnBack');
const btnNext = document.getElementById('btnNext');
const btnSend = document.getElementById('btnSend');
const summaryList = document.getElementById('summaryList');
const totalOut = document.getElementById('totalOut');

let step = 0;
const last = panels.length - 1;

function showStep(n) {
  step = Math.max(0, Math.min(last, n));
  panels.forEach((p, i) => p.classList.toggle('is-active', i === step));
  stepsEls.forEach((s, i) => {
    s.classList.toggle('is-active', i === step);
    s.classList.toggle('is-done', i < step);
  });
  btnBack.hidden = step === 0;
  btnNext.hidden = step === last;
  btnSend.hidden = step !== last;
  document.querySelector('.cotiza__head')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Selección / total ----
function selection() {
  const fd = new FormData(form);
  const espacios = fd.getAll('espacio').map(espacioById).filter(Boolean);
  const horas = computeHoras(fd);
  const extrasSel = data.extras
    .map((x) => ({ ...x, qty: Math.max(0, parseInt(fd.get(`x_${x.id}`), 10) || 0) }))
    .filter((x) => x.qty > 0);
  return { espacios, horas, extrasSel, fd };
}

function computeTotal({ espacios, horas, extrasSel }) {
  let t = 0;
  if (horas) espacios.forEach((e) => (t += e.precioHora * horas));
  extrasSel.forEach((x) => (t += x.precio * x.qty));
  return t;
}

// Duración en horas (horas cerradas 7am–10pm, mismo día; fin debe ser > inicio).
function computeHoras(fd) {
  const a = fd.get('horaInicio'), b = fd.get('horaFin');
  if (!a || !b) return 0;
  const horas = parseInt(b, 10) - parseInt(a, 10);
  return horas > 0 ? horas : 0;
}

const row = (a, b) => `<div class="summary__row"><span>${a}</span><span>${b}</span></div>`;
const sub = (a, b) => `<div class="summary__row is-sub"><span>${a}</span><span>${b}</span></div>`;

function renderSummary() {
  const sel = selection();
  const { espacios, horas, extrasSel, fd } = sel;
  const rows = [];

  const dh = document.getElementById('durHint');
  if (dh) dh.textContent = horas
    ? `Duración: ${horas} h — el estimado del espacio se calcula por estas horas.`
    : 'Pon hora de inicio y fin; la duración se calcula sola.';

  const proyecto = fd.get('proyecto');
  if (proyecto) rows.push(sub('Proyecto', esc(proyecto)));

  espacios.forEach((e) => {
    if (horas) rows.push(row(`${e.nombre} · ${horas} h`, money(e.precioHora * horas)));
    else rows.push(row(e.nombre, `${money(e.precioHora)}/h`));
  });

  const fecha = fd.get('fecha');
  if (fecha) rows.push(sub('Fecha', new Date(fecha + 'T00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })));
  const personas = fd.get('personas');
  if (personas) rows.push(sub('Personas', esc(personas)));

  extrasSel.forEach((x) => rows.push(sub(`${x.nombre} ×${x.qty}`, `+${money(x.precio * x.qty)}`)));

  summaryList.innerHTML = rows.length
    ? rows.join('')
    : '<div class="summary__empty muted">Ve armando tu evento y aquí verás el estimado.</div>';
  totalOut.textContent = money(computeTotal(sel));
}

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// ---- Steppers (extras) ----
form.querySelectorAll('.xrow').forEach((rowEl) => {
  const input = rowEl.querySelector('.stepper__val');
  const sync = () => {
    let v = Math.max(0, parseInt(input.value, 10) || 0);
    input.value = v;
    rowEl.classList.toggle('is-on', v > 0);
    renderSummary();
  };
  rowEl.querySelector('[data-inc]').addEventListener('click', () => { input.value = (parseInt(input.value, 10) || 0) + 1; sync(); });
  rowEl.querySelector('[data-dec]').addEventListener('click', () => { input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1); sync(); });
  input.addEventListener('input', sync);
});

// ---- Validación por paso ----
function validateStep(n) {
  const panel = panels[n];
  const cards = panel.querySelectorAll('.cards input[type=checkbox]');
  if (cards.length && ![...cards].some((c) => c.checked)) { flashCards(panel); return false; }

  let ok = true;
  [...panel.querySelectorAll('input, select, textarea')]
    .filter((i) => i.required && i.type !== 'radio' && i.type !== 'checkbox')
    .forEach((i) => {
      const good = i.checkValidity() && i.value.trim() !== '';
      i.closest('.field')?.classList.toggle('invalid', !good);
      if (!good) ok = false;
    });
  return ok;
}
function flashCards(panel) {
  panel.querySelectorAll('.card').forEach((c) => {
    c.classList.add('invalid');
    setTimeout(() => c.classList.remove('invalid'), 1400);
  });
}

// ---- Navegación ----
form.addEventListener('input', renderSummary);
form.addEventListener('change', renderSummary);
btnNext.addEventListener('click', () => { if (validateStep(step)) showStep(step + 1); });
btnBack.addEventListener('click', () => showStep(step - 1));
stepsEls.forEach((s, i) => s.addEventListener('click', () => { if (i <= step) showStep(i); }));

// ---- Envío: Orden (Borrador, con datos del solicitante) → Line_Items ----
// No se crea Cliente ni Contacto: los datos quedan en la Orden y Fer asigna/crea
// el Cliente manualmente desde su panel (evita duplicados en el CRM).
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateStep(step)) return;

  const sel = selection();
  const { espacios, horas, extrasSel, fd } = sel;
  const g = (k) => (fd.get(k) || '').trim();

  const notas = [
    `Tipo: ${g('tipoEvento')}`,
    `Objetivo: ${g('objetivo')}`,
    g('mensaje') && `Actividades: ${g('mensaje')}`,
    (g('horaInicio') && g('horaFin')) && `Horario: ${g('horaInicio')}–${g('horaFin')} (${horas} h)`,
    g('fecha2') && `Fecha alterna: ${g('fecha2')}`,
    `Personas: ${g('personas')}`,
  ].filter(Boolean).join('\n');

  btnSend.disabled = true;
  btnSend.textContent = 'Enviando…';
  try {
    // 1) Orden borrador — con los datos del solicitante (Cliente queda vacío para Fer)
    const orden = await crear(T.ordenes, {
      Nombre: `Cotización — ${g('proyecto')} · ${g('fecha')}`,
      Estatus: 'Borrador',
      Marca: g('proyecto'),
      Solicitante: g('nombre'),
      WhatsApp: g('telefono'),
      Correo: g('correo') || undefined,
      Notas: notas,
    });

    // 2) Line_Items (base por horas + extras)
    const items = [];
    if (horas) espacios.forEach((e) => {
      items.push({
        Nombre: `${e.nombre} · ${horas} h`,
        Orden: [orden.id],
        Servicios_Extras: [e.rec],
        Qty: horas,
        Precio_Unitario: e.precioHora,
      });
    });
    extrasSel.forEach((x) => {
      items.push({
        Nombre: `${x.nombre}${x.qty > 1 ? ` ×${x.qty}` : ''}`,
        Orden: [orden.id],
        Servicios_Extras: [x.rec],
        Qty: x.qty,
        Precio_Unitario: x.precio,
      });
    });
    if (items.length) await crearMuchos(T.lineItems, items);

    // Éxito
    document.querySelector('.cotiza__grid').hidden = true;
    document.getElementById('steps').hidden = true;
    document.querySelector('.cotiza__head').hidden = true;
    const done = document.getElementById('done');
    done.hidden = false;
    done.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    btnSend.disabled = false;
    btnSend.textContent = 'Enviar solicitud';
    alert('No pudimos enviar tu solicitud. Intenta de nuevo o escríbenos por WhatsApp.');
    console.error(err);
  }
});

// ---- Reglas de fecha y horario ----
// Sin fechas pasadas
const hoy = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
if (form.elements['fecha']) form.elements['fecha'].min = hoy;
if (form.elements['fecha2']) form.elements['fecha2'].min = hoy;

// La hora de fin debe ser posterior a la de inicio
const selIni = form.elements['horaInicio'];
const selFin = form.elements['horaFin'];
selIni?.addEventListener('change', () => {
  const ini = parseInt(selIni.value, 10);
  [...selFin.options].forEach((o) => {
    if (!o.value) return;
    o.disabled = Number.isFinite(ini) && parseInt(o.value, 10) <= ini;
  });
  if (selFin.value && parseInt(selFin.value, 10) <= ini) selFin.value = '';
  renderSummary();
});

showStep(0);
renderSummary();

// ---- Precios en vivo ----
// El espejo local (catalogo.js) es el fallback; si el Worker responde,
// actualizamos precios por record ID y refrescamos las etiquetas visibles.
leer('precios')
  .then((recs) => {
    const by = new Map(recs.map((r) => [r.id, r.fields]));

    data.espacios.forEach((e) => {
      const f = by.get(e.rec);
      if (f && typeof f.Precio === 'number') e.precioHora = f.Precio;
    });
    data.extras.forEach((x) => {
      const f = by.get(x.rec);
      if (f && typeof f.Precio === 'number') x.precio = f.Precio;
    });

    // Cards de espacio: precio actualizado; si no vino en la lectura (no
    // disponible), la card se oculta y se des-selecciona.
    form.querySelectorAll('.cards input[name=espacio]').forEach((input) => {
      const e = espacioById(input.value);
      const card = input.closest('.card');
      const disponible = !!(e && by.has(e.rec));
      if (card) card.hidden = !disponible;
      if (!disponible) input.checked = false;
      const label = card?.querySelector('.card__price');
      if (disponible && label) label.textContent = `${money(e.precioHora)} / hora · ${e.cap}`;
    });

    // Extras: precio actualizado; los no disponibles desaparecen (y su qty a 0).
    form.querySelectorAll('.xrow').forEach((rowEl) => {
      const x = extraById(rowEl.dataset.id);
      const disponible = !!(x && by.has(x.rec));
      rowEl.hidden = !disponible;
      if (!disponible) {
        const input = rowEl.querySelector('.stepper__val');
        if (input) input.value = 0;
        rowEl.classList.remove('is-on');
        return;
      }
      const label = rowEl.querySelector('.xrow__price');
      if (label) label.textContent = money(x.precio);
    });

    // Categorías que quedaron vacías → ocultar el grupo completo
    form.querySelectorAll('.extra-group').forEach((g) => {
      const rows = [...g.querySelectorAll('.xrow')];
      g.hidden = rows.length > 0 && rows.every((r) => r.hidden);
    });

    renderSummary();
  })
  .catch(() => {}); // sin red o Worker viejo → se queda el espejo local
