// ============================================================================
// Integración — el front escribe a Airtable a través del Cloudflare Worker
// (borde seguro que guarda el token). Nunca toca el token en el cliente.
// ============================================================================

export const WORKER = 'https://galeria9-airtable.datatlan.workers.dev';

// Base de PRODUCCIÓN "Galeria9 - Admin"
export const BASE = 'appSkdHwrlulZ2iJc';

// Tablas destino del flujo de cotización.
// El envío solo crea Orden + Line_Items; el Cliente lo asigna Fer manualmente.
export const T = {
  ordenes:   'tbl4RvFWf9fMzQUTz',
  lineItems: 'tblRZmcGK720YClo5',
  leads:     'tbl6G049MoOGABA50', // contacto general (no transaccional)
};

// Registros del Catalogo (para ligar el Line_Item de cada solicitud).
export const CAT = {
  tuTalento: 'recTiTAR9X3ckXszU',
  popUp:     'reckqvWsPWiKiwH9T',
  testerDay: 'rec5Pq8PD4djWQqlL',
};

// Lee una clave de la whitelist del Worker (?read=<clave>). Devuelve records[].
// El Worker cachea en el edge (~60s), así que es barato llamarla al cargar.
export async function leer(clave) {
  const res = await fetch(`${WORKER}?read=${clave}`);
  if (!res.ok) throw new Error(`Worker ${res.status}`);
  const json = await res.json();
  return json.records || [];
}

// ---- Onboarding (portal del cliente: /onboarding?o=<ordenId>) ----

// Checklist de una orden. Sin caché: refleja lo recién guardado.
export async function leerChecklist(ordenId) {
  const res = await fetch(`${WORKER}?read=onboarding&o=${ordenId}`);
  if (!res.ok) throw new Error(`Worker ${res.status}`);
  const json = await res.json();
  return json.records || [];
}

// Guarda la respuesta de un item (el Worker fuerza Estatus=Recibido).
export async function guardarItem(itemId, respuesta) {
  const res = await fetch(`${WORKER}?onb=${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Respuesta: respuesta }),
  });
  if (!res.ok) throw new Error(`Worker ${res.status}`);
  return res.json();
}

// Sube UN archivo al item (máx 5 MB, límite de Airtable) y lo marca Recibido.
export async function subirArchivo(itemId, file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('MAX_5MB');
  const b64 = await new Promise((ok, err) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]); // sin el prefijo data:
    r.onerror = err;
    r.readAsDataURL(file);
  });
  const res = await fetch(`${WORKER}?upload=${itemId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: file.type || 'application/octet-stream', file: b64, filename: file.name }),
  });
  if (!res.ok) throw new Error(`Worker ${res.status}`);
  return res.json();
}

// Crea UN registro y devuelve el registro creado (incluye .id).
export async function crear(tableId, fields) {
  const rec = await crearMuchos(tableId, [fields]);
  return rec[0];
}

// Crea VARIOS registros (hasta 50) en una sola llamada. Devuelve el array.
export async function crearMuchos(tableId, listaFields) {
  const res = await fetch(`${WORKER}?b=${BASE}&t=${tableId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: listaFields.map((fields) => ({ fields })), typecast: true }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Worker ${res.status}: ${txt}`);
  }
  const json = await res.json();
  return json.records || [];
}
