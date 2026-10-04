/**
 * Cloudflare Worker — galeria9-mkt  (email marketing Galería 9: Airtable ↔ Kit)
 * Separado de galeria9-airtable (el proxy del sitio): este hace trabajo de fondo
 * y tiene sus propios secretos.
 *
 * v1 — DEMO 1 "Lista viva": las marcas con Punto Presencia vigente quedan en Kit
 *   con la etiqueta "PP vigente" (+ "PP Visibilidad" / "PP Expansión" / "PP Básico")
 *   y los campos marca, plan_pp, inicio_estancia, fin_estancia, orden.
 *   Cuando la estancia termina, la sincronización les quita "PP vigente".
 *   Correo de cada marca: respuesta "Email" de su onboarding; si no hay, el correo
 *   de su contacto en Contactos (el principal primero).
 *
 * DISPAROS
 *   · Cron (Settings → Triggers → Cron Triggers, p. ej. cada 15 min):
 *     corre la sincronización. Solo escribe en Kit si la variable MODE = "live".
 *   · GET  /status?k=<ADMIN_KEY>  → simulación: qué haría, sin escribir nada.
 *   · POST /sync?k=<ADMIN_KEY>    → sincroniza ya (escribe en Kit).
 *   El reporte no incluye correos, solo nombres de marca y conteos.
 *
 * SECRETOS (Settings → Variables and Secrets)
 *   KIT_API_KEY     llave V4 de Kit
 *   AIRTABLE_TOKEN  token de Airtable solo con la base "Galeria9 - Admin"
 *   ADMIN_KEY       texto largo al azar para /status y /sync
 * VARIABLES (texto plano, opcionales)
 *   MODE = "live"       para que el cron escriba en Kit (sin ella, el cron solo simula)
 *   INCLUDE_TEST = "1"  para incluir órdenes test_record (demos)
 *
 * DEPLOY: Cloudflare → Workers & Pages → galeria9-mkt → Edit code → pegar → Deploy.
 */

const BASE = 'appSkdHwrlulZ2iJc'; // Galeria9 - Admin
const T = {
  ordenes: 'tbl4RvFWf9fMzQUTz',
  contactos: 'tblju1OLYmhR5441S',
  onboarding: 'tblIOBv4kM0YOCb6S',
};
// Productos de Punto Presencia en el Catalogo → etiqueta del plan
const PP = {
  recD3eUbIWZoEYYsH: 'PP Básico',
  recdqFTfNetKW8vta: 'PP Visibilidad',
  recW9OwaFUUzSc4vE: 'PP Expansión',
};
const TAG_VIGENTE = 'PP vigente';
// Campos personalizados en Kit: etiqueta visible → key que genera Kit
const KIT_FIELDS = {
  Marca: 'marca',
  'Plan PP': 'plan_pp',
  'Inicio estancia': 'inicio_estancia',
  'Fin estancia': 'fin_estancia',
  Orden: 'orden',
};
const TZ = 'America/Mexico_City';
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env, { live: env.MODE === 'live' }).then((r) => console.log(JSON.stringify(r))));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.ADMIN_KEY || url.searchParams.get('k') !== env.ADMIN_KEY) return json({ error: 'No autorizado' }, 401);
    try {
      if (url.pathname === '/status' && request.method === 'GET') return json(await run(env, { live: false }));
      if (url.pathname === '/sync' && request.method === 'POST') return json(await run(env, { live: true }));
      return json({ error: 'Ruta no encontrada' }, 404);
    } catch (err) {
      return json({ error: String(err.message || err) }, 500);
    }
  },
};

// ── Sincronización PP → Kit ─────────────────────────────────────────────────
async function run(env, { live }) {
  const hoy = hoyMX();
  const marcas = await ppVigentes(env, hoy);
  const conCorreo = marcas.filter((m) => m.email);

  const rep = {
    modo: live ? 'live' : 'simulación',
    hoy,
    vigentes: marcas.length,
    con_correo: conCorreo.length,
    sin_correo: marcas.filter((m) => !m.email).map((m) => `${m.marca} (#${m.orden})`),
    sincronizadas: conCorreo.map((m) => `${m.marca} (#${m.orden}) · ${m.plan} · hasta ${m.fin}`),
    quitar_etiqueta: 0,
  };

  const kit = kitClient(env);
  const tagVig = live ? await kit.tag(TAG_VIGENTE) : await kit.findTag(TAG_VIGENTE);

  // Quién tiene hoy "PP vigente" en Kit y ya no debería (su estancia terminó)
  const actuales = new Set(conCorreo.map((m) => m.email.toLowerCase()));
  const sobran = tagVig ? (await kit.tagSubscribers(tagVig.id)).filter((e) => !actuales.has(e.toLowerCase())) : [];
  rep.quitar_etiqueta = sobran.length;
  if (!live) return rep;

  await kit.ensureFields(Object.keys(KIT_FIELDS));
  const planTags = {};
  for (const m of conCorreo) {
    await kit.upsert(m.email, m.nombre, {
      marca: m.marca,
      plan_pp: m.plan,
      inicio_estancia: m.inicio,
      fin_estancia: m.fin,
      orden: String(m.orden),
    });
    await kit.addTag(tagVig.id, m.email);
    planTags[m.plan] = planTags[m.plan] || (await kit.tag(m.plan));
    await kit.addTag(planTags[m.plan].id, m.email);
  }
  for (const email of sobran) await kit.removeTag(tagVig.id, email);
  return rep;
}

// Órdenes aprobadas de PP cuya estancia no ha terminado (incluye las que aún no empiezan)
async function ppVigentes(env, hoy) {
  const test = env.INCLUDE_TEST === '1' ? '' : ', NOT({test_record})';
  const ordenes = await airList(env, T.ordenes, {
    filterByFormula: `AND({Estatus}='Aprobada', {Fecha_Inicio}${test})`,
    fields: ['ID_Num', 'Cliente', 'Fecha_Inicio', 'Servicio_Contratado', 'Duracion_Meses'],
  });

  const pp = [];
  for (const o of ordenes) {
    const f = o.fields;
    const servicio = (f.Servicio_Contratado || []).find((id) => PP[id]);
    if (!servicio) continue;
    const meses = Math.max(...(f.Duracion_Meses || [6]));
    const fin = finEstancia(f.Fecha_Inicio, meses);
    if (fin < hoy) continue;
    pp.push({ id: o.id, orden: f.ID_Num, cliente: (f.Cliente || [])[0], inicio: f.Fecha_Inicio, fin, plan: PP[servicio] });
  }
  if (!pp.length) return [];

  // Correos: respuesta "Email" del onboarding de cada orden…
  const onb = await airList(env, T.onboarding, {
    filterByFormula: "AND({Nombre}='Email', {Respuesta}!='')",
    fields: ['Orden', 'Respuesta'],
  });
  const emailPorOrden = {};
  for (const r of onb) {
    const m = String(r.fields.Respuesta || '').match(EMAIL_RE);
    if (m) for (const oid of r.fields.Orden || []) emailPorOrden[oid] = m[0];
  }
  // …y si no hay, el contacto del cliente (principal primero)
  const contactos = await airList(env, T.contactos, {
    filterByFormula: "{Correo electrónico}!=''",
    fields: ['Nombre', 'Correo electrónico', 'Contacto_Principal', 'Cliente'],
  });
  contactos.sort((a, b) => (b.fields.Contacto_Principal ? 1 : 0) - (a.fields.Contacto_Principal ? 1 : 0));
  const contactoPorCliente = {};
  for (const c of contactos) for (const cid of c.fields.Cliente || []) contactoPorCliente[cid] ||= c.fields;

  // Nombre de la marca: el del cliente (lookup barato con el nombre que trae la orden)
  const nombres = await clienteNombres(env, pp.map((p) => p.cliente).filter(Boolean));

  return pp.map((p) => {
    const c = contactoPorCliente[p.cliente];
    return {
      ...p,
      marca: nombres[p.cliente] || 'Marca',
      email: emailPorOrden[p.id] || (c && c['Correo electrónico']) || null,
      nombre: (c && c.Nombre && !c.Nombre.startsWith('[')) ? c.Nombre.split(' ')[0] : null,
    };
  });
}

async function clienteNombres(env, ids) {
  if (!ids.length) return {};
  const recs = await airList(env, 'tblmPecJQZxArzWJV', {
    filterByFormula: `OR(${ids.map((id) => `RECORD_ID()='${id}'`).join(',')})`,
    fields: ['Nombre'],
  });
  return Object.fromEntries(recs.map((r) => [r.id, r.fields.Nombre]));
}

// ── Kit API v4 ──────────────────────────────────────────────────────────────
function kitClient(env) {
  const H = { 'X-Kit-Api-Key': env.KIT_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' };
  async function call(method, path, body) {
    const res = await fetch(`https://api.kit.com/v4${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`Kit ${method} ${path.split('?')[0]} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.status === 204 ? null : res.json();
  }
  async function all(path, key) {
    const out = [];
    let after = '';
    do {
      const sep = path.includes('?') ? '&' : '?';
      const r = await call('GET', `${path}${sep}per_page=500${after ? `&after=${after}` : ''}`);
      out.push(...(r[key] || []));
      after = r.pagination && r.pagination.has_next_page ? r.pagination.end_cursor : '';
    } while (after);
    return out;
  }
  return {
    // crea la etiqueta si no existe (Kit la regresa si ya existe)
    tag: async (name) => (await call('POST', '/tags', { name })).tag,
    findTag: async (name) => (await all('/tags', 'tags')).find((t) => t.name.toLowerCase() === name.toLowerCase()) || null,
    tagSubscribers: async (tagId) => (await all(`/tags/${tagId}/subscribers`, 'subscribers')).map((s) => s.email_address),
    addTag: (tagId, email) => call('POST', `/tags/${tagId}/subscribers`, { email_address: email }),
    removeTag: (tagId, email) => call('DELETE', `/tags/${tagId}/subscribers?email_address=${encodeURIComponent(email)}`),
    upsert: (email, firstName, fields) => call('POST', '/subscribers', { email_address: email, first_name: firstName, fields }),
    async ensureFields(labels) {
      const have = new Set((await all('/custom_fields', 'custom_fields')).map((f) => f.label));
      for (const label of labels) if (!have.has(label)) await call('POST', '/custom_fields', { label });
    },
  };
}

// ── Airtable ────────────────────────────────────────────────────────────────
async function airList(env, table, { filterByFormula, fields }) {
  const out = [];
  let offset = '';
  do {
    const p = new URLSearchParams();
    if (filterByFormula) p.set('filterByFormula', filterByFormula);
    (fields || []).forEach((f) => p.append('fields[]', f));
    p.set('pageSize', '100');
    if (offset) p.set('offset', offset);
    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${table}?${p}`, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });
    if (!res.ok) throw new Error(`Airtable ${table} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    out.push(...j.records);
    offset = j.offset || '';
  } while (offset);
  return out;
}

// ── utilidades ──────────────────────────────────────────────────────────────
function hoyMX() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
// último día de la estancia: inicio + N meses − 1 día (igual que Display_Rentals.Fecha_Fin)
function finEstancia(inicio, meses) {
  const [y, m, d] = inicio.split('-').map(Number);
  const f = new Date(Date.UTC(y, m - 1 + meses, d));
  f.setUTCDate(f.getUTCDate() - 1);
  return f.toISOString().slice(0, 10);
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
