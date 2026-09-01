// Solicitudes del Market (Tu Talento / Pop Up / Tester Day)
// Cada form crea una Orden(Borrador) + un Line_Item ligado a su producto del Catalogo.
// Mismo patrón que el cotizador de eventos: Fer asigna el Cliente y cotiza al revisar.
import { T, crear, crearMuchos } from '../config.js';

export function initSolicitud(opts) {
  // opts: { formId, titulo, catId, precioFrom?(g)->number|null, notasFrom(g)->string }
  const form = document.getElementById(opts.formId);
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    const fd = new FormData(form);
    const g = (k) => (fd.get(k) || '').trim();
    const btn = form.querySelector('[type=submit]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Enviando…';

    try {
      const orden = await crear(T.ordenes, {
        Nombre: `${opts.titulo} — ${g('marca') || g('nombre')}`,
        Estatus: 'Borrador',
        Marca: g('marca'),
        Solicitante: g('nombre'),
        WhatsApp: g('telefono'),
        Correo: g('correo') || undefined,
        Notas: opts.notasFrom(g),
      });

      const li = { Nombre: opts.titulo, Orden: [orden.id], Servicio: [opts.catId], Qty: 1 };
      const precio = opts.precioFrom ? opts.precioFrom(g) : null;
      if (precio != null) li.Precio_Unitario = precio;
      await crearMuchos(T.lineItems, [li]);

      form.hidden = true;
      const done = document.getElementById('done');
      done.hidden = false;
      done.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      btn.disabled = false;
      btn.textContent = label;
      alert('No pudimos enviar tu solicitud. Intenta de nuevo o escríbenos por WhatsApp.');
      console.error(err);
    }
  });
}
