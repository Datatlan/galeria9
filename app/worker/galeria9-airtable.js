/**
 * Cloudflare Worker — proxy seguro Galería 9 → Airtable  (v4: + onboarding)
 * URL: https://galeria9-airtable.datatlan.workers.dev
 *
 * ESCRITURA (POST, igual que v2):
 *   ?b=<baseId>&t=<tableId> — whitelist de bases; reenvía {fields}/{records}.
 *
 * LECTURA (GET):
 *   ?read=<clave> — whitelist READABLE: cada clave fija tabla + campos + filtro.
 *   Clave desconocida → 403. Caché en el edge (ttl por clave).
 *
 * ONBOARDING (v4) — el portal del cliente (/onboarding?o=<ordenId>):
 *   El ID de la orden funciona como llave de acceso (link que Fer manda).
 *   · GET  ?read=onboarding&o=<recOrden>  → items del checklist de ESA orden
 *     (sin caché: el cliente quiere ver su estado recién guardado).
 *   · PATCH ?onb=<recItem>  body {Respuesta} → guarda la respuesta y fuerza
 *     Estatus='Recibido'. SOLO la tabla Onboarding, SOLO ese campo; el
 *     cliente nunca puede aprobar ni tocar otra cosa.
 *   · POST ?upload=<recItem>  body {contentType, file(base64), filename} →
 *     sube el archivo al campo Archivos del item (límite Airtable: 5 MB)
 *     y marca Recibido.
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

const REC_RE = /^rec[A-Za-z0-9]{14}$/;

// Token del panel interno de ocupación (Fer). Cambiarlo = editar aquí + redeploy
// + actualizar los links/botones de la Interface.
const OCUPACION_KEY = 'g9-ocupacion-x7Kd2Qw9';

// Tabla Onboarding (checklist del cliente) — únicos escribibles desde fuera.
const ONB = {
  table: 'tblIOBv4kM0YOCb6S',
  archivosField: 'fld4OuCZqGfUIjp7Y', // Archivos (attachments)
};

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
  popout: {
    base: BASES.prod,
    table: 'tble36WbySAVkODVp', // Display_Rentals
    fields: ['Fecha_Inicio', 'Fecha_Fin'],
    filter: "FIND('PO_', ARRAYJOIN({Unidades_Display}))",
    ttl: 120,
  },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const auth = { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` };

    // ── LECTURA ────────────────────────────────────────────────────────────
    if (request.method === 'GET') {
      const clave = url.searchParams.get('read');

      // Checklist de onboarding de UNA orden (parametrizada, sin caché)
      if (clave === 'onboarding') {
        const o = url.searchParams.get('o') || '';
        if (!REC_RE.test(o)) return json({ error: 'Orden inválida' }, 400);

        const p = new URLSearchParams();
        ['Nombre', 'Estatus', 'Respuesta', 'Archivos', 'Tipo', 'Instrucciones', 'Opciones', 'Seccion', 'Orden_Num', 'Marca']
          .forEach((f) => p.append('fields[]', f));
        p.set('filterByFormula', `{Orden_RecID}='${o}'`);
        p.set('pageSize', '100');

        const air = await fetch(`https://api.airtable.com/v0/${BASES.prod}/${ONB.table}?${p}`, { headers: auth });
        return passthrough(air);
      }

      // Panel interno de ocupación (todas las unidades + rentas + espacios).
      // Datos internos (qué marca ocupa qué): protegido con token, sin caché.
      if (clave === 'ocupacion') {
        if (url.searchParams.get('k') !== OCUPACION_KEY) return json({ error: 'Acceso restringido' }, 403);

        const q = (fields) => {
          const p = new URLSearchParams();
          fields.forEach((f) => p.append('fields[]', f));
          p.set('pageSize', '100');
          return p;
        };
        // Nota: pageSize 100 sin paginación — suficiente hoy; si Ordenes pasa de
        // 100 filas vivas habrá que paginar o filtrar aquí.
        // EN SECUENCIA (no Promise.all): 5 fetches paralelos rozan el límite de
        // 5 req/s de Airtable y provocan 429 intermitentes.
        const lecturas = [
          ['unidades', 'tblxjuV4KYjhGOQBx', ['Nombre', 'Tipo', 'Espacio']],
          ['rentas', 'tble36WbySAVkODVp', ['Nombre', 'Fecha_Inicio', 'Fecha_Fin', 'Unidades_Display', 'Orden']],
          ['espacios', 'tbltH53ZXqnDQdj5n', ['Nombre']],
          ['ordenes', 'tbl4RvFWf9fMzQUTz', ['OrderID', 'Estatus', 'Cliente', 'Marca']],
          ['clientes', 'tblmPecJQZxArzWJV', ['Nombre']],
        ];
        const out = {};
        for (const [key, table, fields] of lecturas) {
          const res = await fetch(`https://api.airtable.com/v0/${BASES.prod}/${table}?${q(fields)}`, { headers: auth });
          if (!res.ok) return json({ error: `Airtable ${res.status} en ${key}` }, 502);
          out[key] = (await res.json()).records;
        }
        return json(out);
      }

      const cfg = READABLE[clave];
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

      const air = await fetch(`https://api.airtable.com/v0/${cfg.base}/${cfg.table}?${p}`, { headers: auth });
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

    // ── ONBOARDING: guardar respuesta ──────────────────────────────────────
    if (request.method === 'PATCH') {
      const item = url.searchParams.get('onb') || '';
      if (!REC_RE.test(item)) return json({ error: 'Item inválido' }, 400);

      let body;
      try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

      // Solo Respuesta (texto) + Estatus forzado a Recibido. Nada más.
      const fields = { Estatus: 'Recibido' };
      if (typeof body.Respuesta === 'string') fields.Respuesta = body.Respuesta.slice(0, 10000);

      const air = await fetch(`https://api.airtable.com/v0/${BASES.prod}/${ONB.table}/${item}`, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, typecast: true }),
      });
      return passthrough(air);
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    // ── ONBOARDING: subir archivo ──────────────────────────────────────────
    const up = url.searchParams.get('upload');
    if (up) {
      if (!REC_RE.test(up)) return json({ error: 'Item inválido' }, 400);

      let body;
      try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
      const { contentType, file, filename } = body || {};
      if (typeof file !== 'string' || typeof filename !== 'string' || typeof contentType !== 'string')
        return json({ error: 'Falta archivo' }, 400);
      if (file.length > 7_500_000) return json({ error: 'Archivo demasiado grande (máx 5 MB)' }, 413);

      const air = await fetch(
        `https://content.airtable.com/v0/${BASES.prod}/${up}/${ONB.archivosField}/uploadAttachment`,
        {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType, file, filename: filename.slice(0, 200) }),
        },
      );

      // Si subió bien, el item pasa a Recibido (sin bloquear la respuesta).
      if (air.ok) {
        ctx.waitUntil(fetch(`https://api.airtable.com/v0/${BASES.prod}/${ONB.table}/${up}`, {
          method: 'PATCH',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { Estatus: 'Recibido' }, typecast: true }),
        }));
      }
      return passthrough(air);
    }

    // ── ESCRITURA (crear registros, igual que v2) ──────────────────────────
    const base = url.searchParams.get('b') || DEFAULT_BASE;
    const table = url.searchParams.get('t');
    if (!ALLOWED.has(base)) return json({ error: 'Base no permitida' }, 400);
    if (!table) return json({ error: 'Falta el parámetro t (tableId)' }, 400);

    const body = await request.text();
    const air = await fetch(`https://api.airtable.com/v0/${base}/${table}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body,
    });
    return passthrough(air);
  },
};

async function passthrough(air) {
  const text = await air.text();
  return new Response(text, {
    status: air.status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
