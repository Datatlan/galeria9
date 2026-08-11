/**
 * Cloudflare Worker — proxy seguro Galería 9 → Airtable
 * URL: https://galeria9-airtable.datatlan.workers.dev
 *
 * Guarda el token (secreto AIRTABLE_TOKEN) y reenvía los POST a Airtable.
 * Cambios vs versión demo:
 *   · Acepta ?b=<baseId> (whitelist). Sin ?b usa la base demo (compat).
 *   · Reenvía el body tal cual → soporta {fields} (1) y {records:[...]} (varios).
 *   · Devuelve la respuesta de Airtable (incluye los .id creados) con CORS.
 *
 * DEPLOY:
 *   1) Cloudflare dashboard → Workers → galeria9-airtable → Edit code → pega esto → Deploy.
 *   2) Secreto: Settings → Variables → AIRTABLE_TOKEN debe ser un PAT con scope
 *      data.records:read + data.records:write sobre AMBAS bases:
 *        - appNi4fINVF5N50fC  (demo "Galeria 9")
 *        - appSkdHwrlulZ2iJc  (producción "Galeria9 - Operación")   ← AGREGAR ESTA
 *      Si el token no incluye la base de producción, los envíos darán 403.
 *      (El token `galeria9-demo-worker` ya tiene acceso a ambas — ago 2026.)
 */

const BASES = {
  demo: 'appNi4fINVF5N50fC', // "Galeria 9" (demo)
  prod: 'appSkdHwrlulZ2iJc', // "Galeria9 - Admin" (producción)
};
const ALLOWED = new Set(Object.values(BASES));
const DEFAULT_BASE = BASES.demo;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const url = new URL(request.url);
    const base = url.searchParams.get('b') || DEFAULT_BASE;
    const table = url.searchParams.get('t');

    if (!ALLOWED.has(base)) return json({ error: 'Base no permitida' }, 400);
    if (!table) return json({ error: 'Falta el parámetro t (tableId)' }, 400);

    const body = await request.text();

    const air = await fetch(`https://api.airtable.com/v0/${base}/${table}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    const text = await air.text();
    return new Response(text, {
      status: air.status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
