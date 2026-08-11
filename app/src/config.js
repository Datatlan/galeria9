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
};

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
