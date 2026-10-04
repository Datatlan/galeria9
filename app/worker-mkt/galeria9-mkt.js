/**
 * Cloudflare Worker — galeria9-mkt  (email marketing Galería 9: Airtable ↔ Kit)
 * Separado de galeria9-airtable (el proxy del sitio): trabajo de fondo + secretos propios.
 *
 * FLUJOS
 *  1. Newsletter           — la lista vive en Airtable (Newsletter_Suscriptores). La sincronización
 *                            sube los Activos a Kit con "Newsletter" (+ bienvenida si son nuevos y no
 *                            tienen Sin_bienvenida) y les quita la etiqueta a las Bajas.
 *                            El form del sitio (POST /subscribe) da de alta al momento en Kit y en la tabla.
 *  2. Orden de PP aprobada — sincronización Airtable → Kit (cron cada 15 min o /sync):
 *                            etiqueta "PP vigente" + plan, campos de la estancia y link de
 *                            onboarding; si la orden es nueva (≤ 21 días) entra a la secuencia
 *                            "G9 · Bienvenida PP" (confirmación + link de onboarding).
 *                            Al terminar la estancia se le quita "PP vigente".
 *  3. Recordatorio Tester Day — cron diario: 3 días antes de cada Tester Day público,
 *                            campaña a "PP vigente".
 *  4. Agenda del mes       — cron diario: el día 1, campaña a "Newsletter" con los eventos
 *                            públicos de los próximos 31 días.
 *  Las campañas automáticas (3 y 4) y la sincronización solo escriben en Kit con MODE = "live".
 *
 * RUTAS (las de ?k= necesitan ADMIN_KEY; GET para poder usarlas como botón o link)
 *   POST /subscribe                        público (solo desde el sitio de Galería 9)
 *   GET  /img/<recEvento>                  público: imagen estable de un evento público
 *   GET  /status?k=                        simulación de la sincronización (no escribe)
 *   GET  /sync?k=                          sincroniza ya
 *   GET  /setup?k=[&prueba=a@x.com,b@y.com] crea campos, etiquetas y secuencias en Kit
 *                                          (si ya existen, actualiza sus correos a la plantilla actual);
 *                                          etiqueta "Prueba interna" a esos correos
 *   GET  /demo/tester-day?k=&aud=prueba|pp[&evento=rec…]   campaña de Tester Day ya
 *   GET  /demo/agenda?k=&aud=prueba|newsletter            campaña de agenda ya
 *   GET  /preview?k=[&t=newsletter|pp|tester|agenda]       vista previa de las plantillas
 *   (aud=prueba manda solo a la etiqueta "Prueba interna")
 *
 * SECRETOS: KIT_API_KEY · AIRTABLE_TOKEN · ADMIN_KEY
 * VARIABLES: MODE = "live" · INCLUDE_TEST = "1" (demos) · SITE_URL (default galeria9.pages.dev)
 * CRON TRIGGERS: "*\/15 * * * *" (sincronización) y "0 16 * * *" (10:00 CDMX: Tester Day y agenda)
 *
 * DEPLOY: Cloudflare → Workers & Pages → galeria9-mkt → Edit code → pegar → Deploy.
 */

const BASE = 'appSkdHwrlulZ2iJc'; // Galeria9 - Admin
const T = {
  ordenes: 'tbl4RvFWf9fMzQUTz',
  clientes: 'tblmPecJQZxArzWJV',
  contactos: 'tblju1OLYmhR5441S',
  onboarding: 'tblIOBv4kM0YOCb6S',
  eventos: 'tblsOvEhdkacWz5yZ',
  newsletter: 'tbl0Xgg81Hg5qN7JG', // Newsletter_Suscriptores
};
const PP = { recD3eUbIWZoEYYsH: 'PP Básico', recdqFTfNetKW8vta: 'PP Visibilidad', recW9OwaFUUzSc4vE: 'PP Expansión' };
const TAGS = { vigente: 'PP vigente', newsletter: 'Newsletter', prueba: 'Prueba interna' };
const SEQ = { newsletter: 'G9 · Bienvenida newsletter', pp: 'G9 · Bienvenida PP' };
// Campos en Kit: etiqueta visible → key que genera Kit (minúsculas y guion bajo)
const FIELDS = {
  Marca: 'marca',
  'Plan PP': 'plan_pp',
  'Inicio estancia': 'inicio_estancia',
  'Fin estancia': 'fin_estancia',
  'Fin estancia texto': 'fin_estancia_texto',
  'Inicio estancia texto': 'inicio_estancia_texto',
  'Link onboarding': 'link_onboarding',
  Orden: 'orden',
  Origen: 'origen',
};
const NUEVA_DIAS = 21; // una orden aprobada "es nueva" (recibe bienvenida) si se creó hace ≤ 21 días
const ORIGINS = ['https://galeria9.pages.dev', 'https://staging.galeria9.pages.dev', 'http://localhost:4321', 'http://localhost:8797'];
const TZ = 'America/Mexico_City';
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export default {
  async scheduled(event, env, ctx) {
    const live = env.MODE === 'live';
    if (event.cron === '0 16 * * *') {
      if (!live) return;
      ctx.waitUntil(diario(env).then((r) => console.log(JSON.stringify(r))));
    } else {
      ctx.waitUntil(sync(env, { live }).then((r) => console.log(JSON.stringify(r))));
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/subscribe') return await subscribe(request, env);
      if (path.startsWith('/img/')) return await imagen(path.slice(5), env);

      if (!env.ADMIN_KEY || url.searchParams.get('k') !== env.ADMIN_KEY) return json({ error: 'No autorizado' }, 401);
      const aud = url.searchParams.get('aud') || 'prueba';
      if (path === '/status') return json(await sync(env, { live: false }));
      if (path === '/sync') return json(await sync(env, { live: true }));
      if (path === '/setup') return json(await setup(env, url.searchParams.get('prueba')));
      if (path === '/demo/tester-day') return json(await testerDay(env, { aud, eventoId: url.searchParams.get('evento') }));
      if (path === '/demo/agenda') return json(await agenda(env, { aud }));
      if (path === '/preview') return await preview(env, url.searchParams.get('t'));
      return json({ error: 'Ruta no encontrada' }, 404);
    } catch (err) {
      return json({ error: String(err.message || err) }, 500);
    }
  },
};

// ── 1. Alta al newsletter ───────────────────────────────────────────────────
async function subscribe(request, env) {
  const origin = request.headers.get('Origin') || '';
  const cors = ORIGINS.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {};
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST' || !cors['Access-Control-Allow-Origin']) return json({ error: 'No permitido' }, 403, cors);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400, cors); }
  if (b.website) return json({ ok: true }, 200, cors); // honeypot: los bots llenan el campo oculto
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) return json({ error: 'Correo inválido' }, 400, cors);
  const nombre = String(b.nombre || '').trim().slice(0, 60) || null;
  const origen = String(b.origen || 'sitio').slice(0, 60);

  const kit = kitClient(env);
  const sub = await kit.upsert(email, nombre, { origen });
  const yaTenia = (await kit.subscriberTags(sub.id)).some((t) => t.name === TAGS.newsletter);
  if (!yaTenia) {
    const tag = await kit.tag(TAGS.newsletter);
    await kit.addTag(tag.id, email);
    const seq = await kit.findSequence(SEQ.newsletter);
    if (seq) await kit.addToSequence(seq.id, email);
  }
  // La lista vive en Airtable: registra el alta si ese correo no estaba
  const existe = await airList(env, T.newsletter, { filterByFormula: `LOWER({Correo})='${email.replace(/'/g, "\\'")}'`, fields: ['Correo'] });
  if (!existe.length) {
    const prueba = !origin.startsWith('https://galeria9.pages.dev');
    await airCreate(env, T.newsletter, { Correo: email, Nombre: nombre || undefined, Estatus: 'Activo', Origen: 'Sitio', En_Kit: true, Notas: `Alta desde ${origen}`, ...(prueba ? { test_record: true } : {}) });
  }
  return json({ ok: true, nuevo: !yaTenia }, 200, cors);
}

// ── Sincronización (cron y /sync): Punto Presencia + newsletter ─────────────
async function sync(env, { live }) {
  return { pp: await syncPP(env, { live }), newsletter: await syncNewsletter(env, { live }) };
}

// Newsletter: la tabla Newsletter_Suscriptores manda.
//   Activo (o sin estatus) → Kit con "Newsletter"; si es nuevo y no tiene Sin_bienvenida, recibe la bienvenida.
//   Baja → se le quita "Newsletter". El Worker marca En_Kit.
//   Quien está en Kit pero no en la tabla no se toca.
async function syncNewsletter(env, { live }) {
  const test = env.INCLUDE_TEST === '1' ? '' : 'NOT({test_record})';
  const filas = await airList(env, T.newsletter, { filterByFormula: test, fields: ['Correo', 'Nombre', 'Estatus', 'Origen', 'Sin_bienvenida', 'En_Kit'] });
  const kit = kitClient(env);
  const tag = await kit.findTag(TAGS.newsletter);
  const enKit = new Set((await kit.tagSubscribers(tag.id)).map((e) => e.toLowerCase()));

  const validas = filas.filter((f) => EMAIL_RE.test(f.fields.Correo || ''));
  const activos = validas.filter((f) => f.fields.Estatus !== 'Baja');
  const nuevos = activos.filter((f) => !enKit.has(f.fields.Correo.toLowerCase()));
  const bajas = validas.filter((f) => f.fields.Estatus === 'Baja' && enKit.has(f.fields.Correo.toLowerCase()));
  const bienvenida = nuevos.filter((f) => !f.fields.Sin_bienvenida);
  const rep = {
    modo: live ? 'live' : 'simulación',
    en_tabla: filas.length,
    activos: activos.length,
    nuevos_en_kit: nuevos.map((f) => f.fields.Nombre || f.fields.Correo.split('@')[0]),
    reciben_bienvenida: bienvenida.length,
    bajas: bajas.length,
    correos_invalidos: filas.length - validas.length,
  };
  if (!live) return rep;

  const seq = await kit.findSequence(SEQ.newsletter);
  for (const f of nuevos) {
    const nombre = (f.fields.Nombre || '').trim().split(' ')[0] || null;
    await kit.upsert(f.fields.Correo, nombre, { origen: (f.fields.Origen || 'Manual').toLowerCase() });
    await kit.addTag(tag.id, f.fields.Correo);
    if (seq && !f.fields.Sin_bienvenida) await kit.addToSequence(seq.id, f.fields.Correo);
  }
  for (const f of bajas) await kit.removeTag(tag.id, f.fields.Correo);

  // Refleja en Airtable quién está en Kit
  const enKitAhora = (f) => f.fields.Estatus !== 'Baja';
  const cambios = validas.filter((f) => !!f.fields.En_Kit !== enKitAhora(f)).map((f) => ({ id: f.id, fields: { En_Kit: enKitAhora(f) } }));
  await airUpdate(env, T.newsletter, cambios);
  return rep;
}

// ── 2. Sincronización de PP ─────────────────────────────────────────────────
async function syncPP(env, { live }) {
  const hoy = hoyMX();
  const marcas = await ppVigentes(env, hoy);
  const conCorreo = marcas.filter((m) => m.email);
  const kit = kitClient(env);

  const tagVig = live ? await kit.tag(TAGS.vigente) : await kit.findTag(TAGS.vigente);
  const enKit = new Set(tagVig ? (await kit.tagSubscribers(tagVig.id)).map((e) => e.toLowerCase()) : []);
  const actuales = new Set(conCorreo.map((m) => m.email.toLowerCase()));
  const sobran = [...enKit].filter((e) => !actuales.has(e));
  const nuevas = conCorreo.filter((m) => !enKit.has(m.email.toLowerCase()));
  const bienvenida = nuevas.filter((m) => m.diasDesdeAlta <= NUEVA_DIAS);

  const rep = {
    modo: live ? 'live' : 'simulación',
    hoy,
    vigentes: marcas.length,
    con_correo: conCorreo.length,
    sin_correo: marcas.filter((m) => !m.email).map((m) => `${m.marca} (#${m.orden})`),
    nuevas_en_kit: nuevas.map((m) => `${m.marca} (#${m.orden})`),
    reciben_bienvenida: bienvenida.map((m) => `${m.marca} (#${m.orden})`),
    quitar_etiqueta: sobran.length,
  };
  if (!live) return rep;

  await kit.ensureFields();
  const seq = await kit.findSequence(SEQ.pp);
  const planTags = {};
  for (const m of conCorreo) {
    await kit.upsert(m.email, m.nombre, {
      marca: m.marca,
      plan_pp: m.plan.replace('PP ', ''),
      inicio_estancia: m.inicio,
      fin_estancia: m.fin,
      inicio_estancia_texto: fechaLarga(m.inicio),
      fin_estancia_texto: fechaLarga(m.fin),
      link_onboarding: m.link || '',
      orden: String(m.orden),
    });
    await kit.addTag(tagVig.id, m.email);
    planTags[m.plan] ||= await kit.tag(m.plan);
    await kit.addTag(planTags[m.plan].id, m.email);
  }
  if (seq) for (const m of bienvenida) await kit.addToSequence(seq.id, m.email);
  for (const email of sobran) await kit.removeTag(tagVig.id, email);
  rep.secuencia_bienvenida = seq ? 'ok' : 'falta crearla con /setup';
  return rep;
}

// Órdenes aprobadas de PP cuya estancia no ha terminado (incluye las que aún no empiezan)
async function ppVigentes(env, hoy) {
  const test = env.INCLUDE_TEST === '1' ? '' : ', NOT({test_record})';
  const ordenes = await airList(env, T.ordenes, {
    filterByFormula: `AND({Estatus}='Aprobada', {Fecha_Inicio}${test})`,
    fields: ['ID_Num', 'Cliente', 'Fecha_Inicio', 'Servicio_Contratado', 'Duracion_Meses', 'Correo', 'Onboarding_Link', 'Fecha_Creacion'],
  });
  const pp = [];
  for (const o of ordenes) {
    const f = o.fields;
    const servicio = (f.Servicio_Contratado || []).find((id) => PP[id]);
    if (!servicio) continue;
    const fin = finEstancia(f.Fecha_Inicio, Math.max(...(f.Duracion_Meses || [6])));
    if (fin < hoy) continue;
    pp.push({
      id: o.id,
      orden: f.ID_Num,
      cliente: (f.Cliente || [])[0],
      inicio: f.Fecha_Inicio,
      fin,
      plan: PP[servicio],
      correoOrden: f.Correo || null,
      link: f.Onboarding_Link || null,
      diasDesdeAlta: Math.floor((Date.now() - Date.parse(f.Fecha_Creacion || o.createdTime)) / 86400000),
    });
  }
  if (!pp.length) return [];

  // Correo, en este orden: el de la orden → respuesta "Email" del onboarding → contacto del cliente
  const onb = await airList(env, T.onboarding, { filterByFormula: "AND({Nombre}='Email', {Respuesta}!='')", fields: ['Orden', 'Respuesta'] });
  const emailOnb = {};
  for (const r of onb) {
    const m = String(r.fields.Respuesta || '').match(EMAIL_RE);
    if (m) for (const oid of r.fields.Orden || []) emailOnb[oid] = m[0];
  }
  const contactos = await airList(env, T.contactos, {
    filterByFormula: "{Correo electrónico}!=''",
    fields: ['Nombre', 'Correo electrónico', 'Contacto_Principal', 'Cliente'],
  });
  contactos.sort((a, b) => (b.fields.Contacto_Principal ? 1 : 0) - (a.fields.Contacto_Principal ? 1 : 0));
  const contacto = {};
  for (const c of contactos) for (const cid of c.fields.Cliente || []) contacto[cid] ||= c.fields;
  const nombres = await porIds(env, T.clientes, pp.map((p) => p.cliente).filter(Boolean), ['Nombre']);

  return pp.map((p) => {
    const c = contacto[p.cliente];
    const email = (p.correoOrden && (p.correoOrden.match(EMAIL_RE) || [])[0]) || emailOnb[p.id] || (c && c['Correo electrónico']) || null;
    return {
      ...p,
      marca: (nombres[p.cliente] && nombres[p.cliente].Nombre) || 'Marca',
      email,
      nombre: c && c.Nombre && !c.Nombre.startsWith('[') ? c.Nombre.split(' ')[0] : null,
    };
  });
}

// ── 3 y 4. Campañas ─────────────────────────────────────────────────────────
async function diario(env) {
  const hoy = hoyMX();
  const out = { hoy };
  const en3 = sumarDias(hoy, 3);
  const td = (await eventosPublicos(env, hoy, 40)).filter((e) => e.tipo === 'Tester Day' && e.fecha === en3);
  out.tester_day = [];
  for (const e of td) out.tester_day.push(await testerDay(env, { aud: 'pp', eventoId: e.id }));
  if (hoy.endsWith('-01')) out.agenda = await agenda(env, { aud: 'newsletter' });
  return out;
}

async function testerDay(env, { aud, eventoId }) {
  const c = await testerDayContenido(env, eventoId);
  return c.error ? c : enviar(env, { aud, publico: 'pp', ...c });
}
async function testerDayContenido(env, eventoId) {
  const hoy = hoyMX();
  const evs = (await eventosPublicos(env, hoy, 120)).filter((e) => e.tipo === 'Tester Day');
  const e = eventoId ? evs.find((x) => x.id === eventoId) : evs[0];
  if (!e) return { error: 'No hay Tester Day público próximo' };
  const c = await plantilla(env, 'tester-day', {
    fecha_corta: e.fechaCorta,
    fecha_texto: e.fechaTexto,
    horario: e.horario,
    descripcion: e.descripcion,
    imagen: e.imagen ? `${workerUrl(env)}/img/${e.id}` : '',
    portada: e.imagen ? '' : 'hero-tester.jpg',
  });
  return { ...c, nombre: `Tester Day ${e.fecha}` };
}

async function agenda(env, { aud }) {
  const c = await agendaContenido(env);
  return c.error ? c : enviar(env, { aud, publico: 'newsletter', ...c });
}
async function agendaContenido(env) {
  const hoy = hoyMX();
  const evs = (await eventosPublicos(env, hoy, 31)).slice(0, 8);
  if (!evs.length) return { error: 'No hay eventos públicos en los próximos 31 días' };
  const mes = new Intl.DateTimeFormat('es-MX', { month: 'long', timeZone: TZ }).format(new Date());
  const c = await plantilla(env, 'agenda', {
    mes,
    eventos: evs.map((e) => ({
      titulo: e.titulo,
      fecha_corta: e.fechaCorta,
      horario: e.horario,
      descripcion: e.descripcion,
      imagen: e.imagen ? `${workerUrl(env)}/img/${e.id}` : '',
    })),
  });
  return { ...c, nombre: `Agenda ${hoy.slice(0, 7)}` };
}

// Crea la campaña en Kit y la manda ya. aud=prueba → solo "Prueba interna".
async function enviar(env, { aud, publico, asunto, preview, html, nombre }) {
  const kit = kitClient(env);
  const tagName = aud === 'prueba' ? TAGS.prueba : publico === 'pp' ? TAGS.vigente : TAGS.newsletter;
  const tag = await kit.findTag(tagName);
  if (!tag) return { error: `No existe la etiqueta "${tagName}" en Kit (corre /setup)` };
  const b = await kit.broadcast({
    subject: (aud === 'prueba' ? '[Prueba] ' : '') + asunto,
    preview_text: preview,
    description: `${nombre} → ${tagName}`,
    content: html,
    public: false,
    send_at: new Date(Date.now() + 60_000).toISOString(),
    subscriber_filter: [{ all: [{ type: 'tag', ids: [tag.id] }] }],
  });
  return { ok: true, campaña: b.id, para: tagName, asunto: b.subject };
}

// Vista previa de las 4 plantillas con datos de ejemplo en las variables de Kit
async function preview(env, t) {
  const ej = { first_name: 'Mariana', marca: 'Barro & Sal', plan_pp: 'Visibilidad', inicio_estancia_texto: '1 de octubre de 2026',
    fin_estancia_texto: '31 de marzo de 2027', link_onboarding: `${siteUrl(env)}/onboarding` };
  const piezas = {
    newsletter: () => plantilla(env, 'bienvenida-newsletter', {}),
    pp: () => plantilla(env, 'bienvenida-pp', {}),
    tester: () => testerDayContenido(env),
    agenda: () => agendaContenido(env),
  };
  const keys = t && piezas[t] ? [t] : Object.keys(piezas);
  const kitEjemplo = (h) => String(h || '')
    .replace(/\{% if subscriber\.first_name %\}(.*?)\{% else %\}.*?\{% endif %\}/gs, '$1')
    .replace(/\{\{\s*subscriber\.(\w+)\s*\}\}/g, (_, f) => esc(ej[f] || ''));
  let out = '';
  for (const k of keys) {
    let c;
    try { c = await piezas[k](); } catch (err) { c = { error: String(err.message || err) }; }
    const html = c.html ? kitEjemplo(c.html) : `<p style="text-align:center;font:14px system-ui">${esc(c.error)}</p>`;
    out += `<div style="max-width:620px;margin:30px auto 6px;font:13px system-ui;color:#555"><b>${esc(k)}</b> · Asunto: ${esc(kitEjemplo(c.asunto))}</div>${html}`;
  }
  return new Response(`<!doctype html><meta charset="utf-8"><title>Plantillas G9</title><body style="margin:0;background:#ddd">${out}</body>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ── Setup en Kit ────────────────────────────────────────────────────────────
async function setup(env, prueba) {
  const kit = kitClient(env);
  await kit.ensureFields();
  const tags = {};
  for (const n of Object.values(TAGS)) tags[n] = (await kit.tag(n)).id;
  const seqs = {};
  for (const [k, name] of Object.entries(SEQ)) {
    const c = await plantilla(env, k === 'pp' ? 'bienvenida-pp' : 'bienvenida-newsletter', {});
    const mail = { subject: c.asunto, preview_text: c.preview, content: c.html };
    let s = await kit.findSequence(name);
    if (!s) {
      s = await kit.createSequence({ name, active: true, time_zone: TZ, send_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] });
      await kit.createSequenceEmail(s.id, { ...mail, delay_value: 0, delay_unit: 'hours', published: true, position: 0 });
    } else {
      // ya existe: deja su primer correo igual a la plantilla publicada
      const [primero] = await kit.sequenceEmails(s.id);
      if (primero) await kit.updateSequenceEmail(s.id, primero.id, mail);
    }
    seqs[name] = s.id;
  }
  const etiquetados = [];
  for (const e of String(prueba || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    await kit.upsert(e, null, {});
    await kit.addTag(tags[TAGS.prueba], e);
    etiquetados.push(e);
  }
  return { ok: true, etiquetas: tags, secuencias: seqs, prueba_interna: etiquetados };
}

// ── Plantillas (viven en el sitio: app/public/email/plantillas/ del repo) ──
// Cada archivo: un comentario de encabezado (asunto, preview, eyebrow, titulo, portada,
// icono ×3, boton) + el cuerpo HTML; se inserta en marco.html. Ver LEEME.md en esa carpeta.
async function plantilla(env, nombre, datos) {
  const base = `${siteUrl(env)}/email/plantillas`;
  const [marco, pieza] = await Promise.all([leerPlantilla(`${base}/marco.html`), leerPlantilla(`${base}/${nombre}.html`)]);
  const ctx = { site: siteUrl(env), ...datos };
  const { meta, cuerpo } = separarEncabezado(pieza);
  const r = (v) => render(v || '', [ctx]);
  const uno = (k) => r(meta[k] && meta[k][0]);
  const iconos = (meta.icono || []).map((l) => {
    const [icono, titulo, texto] = l.split('|').map((x) => r(x.trim()));
    return { icono, titulo, texto };
  });
  const [btnTexto, btnUrl] = String((meta.boton && meta.boton[0]) || '').split('|').map((x) => r(x.trim()));
  const preview = uno('preview');
  const html = render(sinComentarioInicial(marco), [{
    site: ctx.site,
    preview,
    eyebrow: uno('eyebrow'),
    titulo: uno('titulo'),
    portada: uno('portada'),
    contenido: render(cuerpo, [ctx]),
    hay_iconos: iconos.length > 0,
    iconos,
    boton: btnTexto ? { texto: btnTexto, url: btnUrl } : null,
  }]);
  return { asunto: uno('asunto'), preview, html };
}

async function leerPlantilla(url) {
  const res = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } });
  const txt = await res.text();
  // Pages responde 200 con la página del sitio cuando el archivo no existe
  if (!res.ok || /<!doctype html/i.test(txt)) throw new Error(`No encontré la plantilla ${url}`);
  return txt;
}
function sinComentarioInicial(t) {
  return t.replace(/^\s*<!--[\s\S]*?-->\s*/, '');
}
function separarEncabezado(t) {
  const m = t.match(/^\s*<!--([\s\S]*?)-->\s*/);
  const meta = {};
  if (m) for (const linea of m[1].split('\n')) {
    const i = linea.indexOf(':');
    if (i < 1) continue;
    const k = linea.slice(0, i).trim().toLowerCase();
    if (!/^[a-z_]+$/.test(k)) continue;
    (meta[k] ||= []).push(linea.slice(i + 1).trim());
  }
  return { meta, cuerpo: m ? t.slice(m[0].length) : t };
}
// Mini motor tipo Mustache con [[ ]] (no choca con {{ }} / {% %} de Kit):
//   [[x]] escapado · [[&x]] sin escapar · [[#x]]…[[/x]] si existe (repite si es lista) · [[^x]]…[[/x]] si no existe
function render(tpl, pila) {
  const buscar = (k) => { for (let i = pila.length - 1; i >= 0; i--) if (pila[i] && typeof pila[i] === 'object' && k in pila[i]) return pila[i][k]; return undefined; };
  const vacio = (v) => v == null || v === false || v === '' || (Array.isArray(v) && !v.length);
  let out = String(tpl).replace(/\[\[([#^])(\w+)\]\]([\s\S]*?)\[\[\/\2\]\]/g, (_, tipo, k, dentro) => {
    const v = buscar(k);
    if (tipo === '^') return vacio(v) ? render(dentro, pila) : '';
    if (vacio(v)) return '';
    if (Array.isArray(v)) return v.map((item) => render(dentro, [...pila, item])).join('');
    return render(dentro, typeof v === 'object' ? [...pila, v] : pila);
  });
  out = out.replace(/\[\[(&?)(\w+)\]\]/g, (_, raw, k) => {
    const v = buscar(k);
    return v == null ? '' : raw ? String(v) : esc(v);
  });
  return out;
}

// ── Eventos públicos (Airtable) ─────────────────────────────────────────────
async function eventosPublicos(env, hoy, dias) {
  const hasta = sumarDias(hoy, dias);
  const recs = await airList(env, T.eventos, {
    filterByFormula: `AND({Visibilidad}='Público', IS_AFTER({Fecha_Inicio}, NOW()), IS_BEFORE({Fecha_Inicio}, DATETIME_PARSE('${hasta}')))`,
    fields: ['Nombre', 'Titulo_Publico', 'Descripcion_Publica', 'Fecha_Inicio', 'Fecha_Fin', 'Tipo', 'Imagen'],
  });
  return recs
    .map((r) => {
      const f = r.fields;
      const ini = new Date(f.Fecha_Inicio);
      const fin = f.Fecha_Fin ? new Date(f.Fecha_Fin) : null;
      return {
        id: r.id,
        titulo: f.Titulo_Publico || f.Nombre,
        descripcion: f.Descripcion_Publica || '',
        tipo: f.Tipo || '',
        inicio: ini,
        fecha: ymdMX(ini),
        fechaTexto: new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(ini),
        fechaCorta: new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: TZ }).format(ini).replace('.', ''),
        horario: hora(ini) + (fin ? ` a ${hora(fin)}` : ''),
        imagen: (f.Imagen || []).length > 0,
      };
    })
    .sort((a, b) => a.inicio - b.inicio);
}

// Imagen estable para correos: las URLs de Airtable caducan en horas
async function imagen(id, env) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return new Response('no', { status: 400 });
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${T.eventos}/${id}`, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
  if (!res.ok) return new Response('no', { status: 404 });
  const f = (await res.json()).fields || {};
  const img = (f.Imagen || [])[0];
  if (f.Visibilidad !== 'Público' || !img) return new Response('no', { status: 404 });
  const src = (img.thumbnails && img.thumbnails.large && img.thumbnails.large.url) || img.url;
  const r = await fetch(src);
  return new Response(r.body, { headers: { 'Content-Type': r.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } });
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
      const r = await call('GET', `${path}${sep}per_page=500${after ? `&after=${encodeURIComponent(after)}` : ''}`);
      out.push(...(r[key] || []));
      after = r.pagination && r.pagination.has_next_page ? r.pagination.end_cursor : '';
    } while (after);
    return out;
  }
  return {
    tag: async (name) => (await call('POST', '/tags', { name })).tag, // idempotente por nombre
    // POST /tags es idempotente por nombre: regresa la etiqueta existente (más confiable que paginar la lista)
    findTag: async (name) => (await call('POST', '/tags', { name })).tag,
    tagSubscribers: async (tagId) => (await all(`/tags/${tagId}/subscribers`, 'subscribers')).map((s) => s.email_address),
    subscriberTags: (id) => all(`/subscribers/${id}/tags`, 'tags'),
    addTag: (tagId, email) => call('POST', `/tags/${tagId}/subscribers`, { email_address: email }),
    removeTag: (tagId, email) => call('DELETE', `/tags/${tagId}/subscribers?email_address=${encodeURIComponent(email)}`),
    upsert: async (email, firstName, fields) =>
      (await call('POST', '/subscribers', { email_address: email, ...(firstName ? { first_name: firstName } : {}), fields })).subscriber,
    findSequence: async (name) => (await all('/sequences', 'sequences')).find((s) => s.name === name) || null,
    createSequence: async (body) => (await call('POST', '/sequences', body)).sequence,
    createSequenceEmail: async (id, body) => (await call('POST', `/sequences/${id}/emails`, body)).email,
    sequenceEmails: (id) => all(`/sequences/${id}/emails`, 'emails'),
    updateSequenceEmail: (id, emailId, body) => call('PUT', `/sequences/${id}/emails/${emailId}`, body),
    addToSequence: (id, email) => call('POST', `/sequences/${id}/subscribers`, { email_address: email }),
    broadcast: async (body) => (await call('POST', '/broadcasts', body)).broadcast,
    async ensureFields() {
      const have = new Set((await all('/custom_fields', 'custom_fields')).map((f) => f.label));
      for (const label of Object.keys(FIELDS)) if (!have.has(label)) await call('POST', '/custom_fields', { label });
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
    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${table}?${p}`, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
    if (!res.ok) throw new Error(`Airtable ${table} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    out.push(...j.records);
    offset = j.offset || '';
  } while (offset);
  return out;
}
async function airCreate(env, table, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${table}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });
  if (!res.ok) throw new Error(`Airtable crear ${table} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
async function airUpdate(env, table, records) {
  for (let i = 0; i < records.length; i += 10) {
    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${table}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: records.slice(i, i + 10) }),
    });
    if (!res.ok) throw new Error(`Airtable actualizar ${table} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
async function porIds(env, table, ids, fields) {
  if (!ids.length) return {};
  const recs = await airList(env, table, { filterByFormula: `OR(${ids.map((id) => `RECORD_ID()='${id}'`).join(',')})`, fields });
  return Object.fromEntries(recs.map((r) => [r.id, r.fields]));
}

// ── utilidades ──────────────────────────────────────────────────────────────
const siteUrl = (env) => (env.SITE_URL || 'https://galeria9.pages.dev').replace(/\/$/, '');
const workerUrl = (env) => (env.WORKER_URL || 'https://galeria9-mkt.datatlan.workers.dev').replace(/\/$/, '');
const ymdMX = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hoyMX = () => ymdMX(new Date());
const hora = (d) => new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(d).replace(/\s?([ap])\.?\s?m\.?/i, ' $1m');
function sumarDias(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function fechaLarga(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}
// último día de la estancia: inicio + N meses − 1 día (igual que Display_Rentals.Fecha_Fin)
function finEstancia(inicio, meses) {
  const [y, m, d] = inicio.split('-').map(Number);
  const f = new Date(Date.UTC(y, m - 1 + meses, d));
  f.setUTCDate(f.getUTCDate() - 1);
  return f.toISOString().slice(0, 10);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra } });
}
