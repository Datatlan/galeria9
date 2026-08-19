/**
 * Cloudflare Worker — proxy seguro Galería 9 → Airtable  (v3: escritura + lectura)
 * URL: https://galeria9-airtable.datatlan.workers.dev
 *
 * ESCRITURA (POST, igual que v2):
 *   ?b=<baseId>&t=<tableId> — whitelist de bases; reenvía {fields}/{records}.
 *
 * LECTURA (GET, nuevo):
 *   ?read=<clave> — el front NUNCA pide una tabla: pide una clave de la
 *   whitelist READABLE. Cada clave define tabla + campos + filtro exactos.
 *   Clave desconocida → 403. Así el token puede leer toda la base, pero el
 *   Worker solo deja salir lo que está en la lista (nada de Clientes/Pagos).
 *
 *   Caché: cada lectura se guarda en el edge de Cloudflare (ttl por clave).
 *   Mil visitas = ~1 request a Airtable por minuto. Protege el límite de 5 req/s.
 *
 * DEPLOY: Cloudflare dashboard → Workers → galeria9-airtable → Edit code →
 *         pegar esto → Deploy. (El secreto AIRTABLE_TOKEN no cambia.)
 */

const BASES = {
  demo: 'appNi4fINVF5N50fC', // "Galeria 9" (demo)
  prod: 'appSkdHwrlulZ2iJc', // "Galeria9 - Admin" (producción)
};
const ALLOWED = new Set(Object.values(BASES));
const DEFAULT_BASE = BASES.demo;

// ── Whitelist de lecturas ───────────────────────────────────────────────────
// Agregar aquí cada dato que el sitio pueda leer. Nada más existe hacia afuera.
const READABLE = {
  // Precios vigentes de Servicios_Extras (espacios por hora + extras del cotizador)
  precios: {
    base: BASES.prod,
    table: 'tblXTaleJPTMiJBDJ', // Servicios_Extras
    fields: ['Nombre', 'Precio', 'Categoria', 'Estatus'],
    filter: "{Estatus}='Disponible'",
    ttl: 60,
  },
  // Catálogo de productos (familias, periodos, precios base)
  catalogo: {
    base: BASES.prod,
    table: 'tblu379wzXculcvNY', // Catalogo
    fields: ['Nombre', 'Familia', 'Tipo_Unidad', 'Precio_Unitario', 'Periodo'],
    ttl: 300,
  },
  // Ocupación de Pop Out: rentas confirmadas de las unidades PO_ (una marca/mes).
  // Solo salen las fechas; el front calcula qué meses quedan libres. Si una renta
  // existe, ese mes está tomado (no hay holds tentativos: solo lo confirmado bloquea).
  popout: {
    base: BASES.prod,
    table: 'tble36WbySAVkODVp', // Display_Rentals
    fields: ['Fecha_Inicio', 'Fecha_Fin'],
    filter: "FIND('PO_', ARRAYJOIN({Unidades_Display}))",
    ttl: 120,
  },
  // Futuro (cuando exista el rework de Tester Day):
  // testerDays: { base: BASES.prod, table: 'tblsOvEhdkacWz5yZ', fields: [...], filter: ..., ttl: 60 },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);

    // ── LECTURA ────────────────────────────────────────────────────────────
    if (request.method === 'GET') {
      const cfg = READABLE[url.searchParams.get('read')];
      if (!cfg) return json({ error: 'Lectura no permitida' }, 403);

      // caché en el edge
      const cacheKey = new Request(url.toString());
      const cache = caches.default;
      const hit = await cache.match(cacheKey);
      if (hit) return hit;

      const p = new URLSearchParams();
      cfg.fields.forEach((f) => p.append('fields[]', f));
      if (cfg.filter) p.set('filterByFormula', cfg.filter);
      p.set('pageSize', '100');

      const air = await fetch(`https://api.airtable.com/v0/${cfg.base}/${cfg.table}?${p}`, {
        headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
      });
      const body = await air.text();
      const res = new Response(body, {
        status: air.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${cfg.ttl}`,
          ...CORS,
        },
      });
      if (air.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    }

    // ── ESCRITURA ──────────────────────────────────────────────────────────
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

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
