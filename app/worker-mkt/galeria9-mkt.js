/**
 * Cloudflare Worker — galeria9-mkt  (email marketing Galería 9: Airtable ↔ Kit)
 * Separado de galeria9-airtable (el proxy del sitio): trabajo de fondo + secretos propios.
 *
 * FLUJOS
 *  1. Alta al newsletter   — form del sitio → POST /subscribe → Kit: etiqueta "Newsletter"
 *                            + secuencia "G9 · Bienvenida newsletter" (solo la primera vez).
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
 *   GET  /setup?k=[&prueba=a@x.com,b@y.com] crea campos, etiquetas y secuencias en Kit;
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
const WA = 'https://wa.me/523318030563';
const IG = 'https://instagram.com/galeria9providencia';

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
  return json({ ok: true, nuevo: !yaTenia }, 200, cors);
}

// ── 2. Sincronización de PP ─────────────────────────────────────────────────
async function sync(env, { live }) {
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
  const site = siteUrl(env);
  const html = layout(env, {
    preheader: `${e.fechaTexto}, ${e.horario}. Como marca de Punto Presencia tienes precio preferente.`,
    eyebrow: 'Tester Day',
    titulo: `Lleva tu marca al Tester Day del ${e.fechaCorta}`,
    cuerpo: `
      <p>{% if subscriber.first_name %}Hola {{ subscriber.first_name }}:{% else %}Hola:{% endif %}</p>
      <p>El <b>${esc(e.fechaTexto)}</b>, de ${esc(e.horario)}, tenemos Tester Day en Galería 9. ${esc(e.descripcion || '')}</p>
      <p>Como marca de <b>Punto Presencia</b> tienes precio preferente para participar.</p>`,
    imagen: e.imagen ? `${workerUrl(env)}/img/${e.id}` : null,
    portada: e.imagen ? null : 'hero-tester.jpg',
    iconos: [
      ['reloj', 'Dinámicas express', 'Máximo 15 min por cliente'],
      ['precio', 'Precio preferente', 'Por ser marca de Punto Presencia'],
      ['bolsa', 'Tu producto', 'Frente a clientes nuevos'],
    ],
    cta: { texto: 'Quiero participar', url: `${site}/tester-day` },
  });
  return { asunto: `Tester Day ${e.fechaCorta}: lleva tu marca`, preview: 'Precio preferente para marcas de Punto Presencia', html, nombre: `Tester Day ${e.fecha}` };
}

async function agenda(env, { aud }) {
  const c = await agendaContenido(env);
  return c.error ? c : enviar(env, { aud, publico: 'newsletter', ...c });
}
async function agendaContenido(env) {
  const hoy = hoyMX();
  const evs = (await eventosPublicos(env, hoy, 31)).slice(0, 8);
  if (!evs.length) return { error: 'No hay eventos públicos en los próximos 31 días' };
  const site = siteUrl(env);
  const mes = new Intl.DateTimeFormat('es-MX', { month: 'long', timeZone: TZ }).format(new Date());
  const items = evs.map((e) => `
    <tr><td style="padding:0 0 22px">
      ${e.imagen ? `<a href="${site}/eventos"><img src="${workerUrl(env)}/img/${e.id}" width="520" alt="" style="display:block;width:100%;max-width:520px;height:auto;border:0;margin:0 0 10px"></a>` : ''}
      <div style="font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#8a7a52;margin:0 0 4px"><img src="${site}/email/ic-calendario.png" width="14" height="14" alt="" style="vertical-align:-2px;margin-right:6px;border:0">${esc(e.fechaCorta)} · ${esc(e.horario)}</div>
      <div style="font-size:19px;font-weight:300;color:#2b2b2a;margin:0 0 4px">${esc(e.titulo)}</div>
      ${e.descripcion ? `<div style="font-size:14px;color:#6b6b69;line-height:1.5">${esc(e.descripcion)}</div>` : ''}
    </td></tr>`).join('');
  const html = layout(env, {
    preheader: `Lo que viene en Galería 9: ${evs.map((e) => e.titulo).slice(0, 3).join(', ')}.`,
    portada: 'hero-agenda.jpg',
    eyebrow: `Agenda · ${mes}`,
    titulo: 'Lo que viene en Galería 9',
    cuerpo: `<p>{% if subscriber.first_name %}Hola {{ subscriber.first_name }}:{% else %}Hola:{% endif %} esto es lo que tenemos en las próximas semanas.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px">${items}</table>`,
    cta: { texto: 'Ver la agenda completa', url: `${site}/eventos` },
  });
  return { asunto: `Agenda Galería 9 · ${mes}`, preview: 'Talleres, pláticas y eventos de las próximas semanas', html, nombre: `Agenda ${hoy.slice(0, 7)}` };
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
    newsletter: () => ({ asunto: correoBienvenidaNewsletter(env).subject, html: correoBienvenidaNewsletter(env).content }),
    pp: () => ({ asunto: correoBienvenidaPP(env).subject, html: correoBienvenidaPP(env).content }),
    tester: () => testerDayContenido(env),
    agenda: () => agendaContenido(env),
  };
  const keys = t && piezas[t] ? [t] : Object.keys(piezas);
  let out = '';
  for (const k of keys) {
    const c = await piezas[k]();
    const html = (c.html || `<p>${esc(c.error)}</p>`)
      .replace(/\{% if subscriber\.first_name %\}(.*?)\{% else %\}.*?\{% endif %\}/gs, '$1')
      .replace(/\{\{\s*subscriber\.(\w+)\s*\}\}/g, (_, f) => esc(ej[f] || ''));
    out += `<div style="max-width:620px;margin:30px auto 6px;font:13px system-ui;color:#555"><b>${esc(k)}</b> · Asunto: ${esc(c.asunto || '')}</div>${html}`;
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
    let s = await kit.findSequence(name);
    if (!s) {
      s = await kit.createSequence({ name, active: true, time_zone: TZ, send_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] });
      const mail = k === 'pp' ? correoBienvenidaPP(env) : correoBienvenidaNewsletter(env);
      await kit.createSequenceEmail(s.id, { ...mail, delay_value: 0, delay_unit: 'hours', published: true, position: 0 });
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

function correoBienvenidaNewsletter(env) {
  const site = siteUrl(env);
  return {
    subject: 'Bienvenida a Galería 9',
    preview_text: 'Talleres, pláticas y marcas en Providencia, Guadalajara',
    content: layout(env, {
      portada: 'hero-newsletter.jpg',
      eyebrow: 'Galería 9',
      titulo: 'Gracias por sumarte',
      cuerpo: `<p>{% if subscriber.first_name %}Hola {{ subscriber.first_name }}:{% else %}Hola:{% endif %}</p>
        <p>Desde ahora te contamos primero lo que pasa en Galería 9: talleres, pláticas, Tester Days y las marcas que nos visitan.</p>
        <p>Cada mes te llega la agenda. Mientras, puedes ver lo que viene esta semana.</p>`,
      iconos: [
        ['calendario', 'Talleres y pláticas', 'Bienestar, creatividad y comunidad'],
        ['bolsa', 'Marcas locales', 'Producto hecho aquí, en piso'],
        ['destello', 'Tester Days', 'Prueba antes que nadie'],
      ],
      cta: { texto: 'Ver la agenda', url: `${site}/eventos` },
    }),
  };
}

function correoBienvenidaPP(env) {
  return {
    subject: 'Tu lugar en Punto Presencia está confirmado',
    preview_text: 'Siguiente paso: completa tu onboarding',
    content: layout(env, {
      portada: 'hero-pp.jpg',
      eyebrow: 'Punto Presencia',
      titulo: 'Bienvenida a Galería 9',
      cuerpo: `<p>{% if subscriber.first_name %}Hola {{ subscriber.first_name }}:{% else %}Hola:{% endif %}</p>
        <p>Confirmamos a <b>{{ subscriber.marca }}</b> en Punto Presencia, plan <b>{{ subscriber.plan_pp }}</b>, del {{ subscriber.inicio_estancia_texto }} al {{ subscriber.fin_estancia_texto }}.</p>
        <p>El siguiente paso es tu <b>onboarding</b>: ahí nos compartes tu logo, inventario y lo que necesitamos para preparar tu espacio. Toma unos minutos.</p>`,
      iconos: [
        ['checklist', '1. Onboarding', 'Logo, inventario y datos de tu marca'],
        ['caja', '2. Montaje', 'Preparamos tu display'],
        ['tienda', '3. En piso', 'Tu marca, frente a la comunidad'],
      ],
      cta: { texto: 'Completar mi onboarding', url: '{{ subscriber.link_onboarding }}' },
      nota: `¿Dudas? Escríbenos por <a href="${WA}" style="color:#8a7a52">WhatsApp</a>.`,
    }),
  };
}

// ── Plantilla de correo (marca Galería 9) ───────────────────────────────────
function layout(env, { preheader = '', eyebrow, titulo, cuerpo, imagen, portada, iconos, cta, nota }) {
  const site = siteUrl(env);
  const fila = iconos ? iconRow(env, iconos) : '';
  return `<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2">
<tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#2b2b2a">
  <tr><td style="padding:26px 28px 18px"><img src="${site}/logo.png" height="44" alt="Galería 9" style="display:block;height:44px;width:auto;border:0"></td></tr>
  ${portada ? `<tr><td style="padding:0"><img src="${site}/email/${portada}" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0"></td></tr>` : ''}
  <tr><td style="padding:24px 28px 0">
    ${eyebrow ? `<div style="font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:#8a7a52;margin:0 0 8px">${esc(eyebrow)}</div>` : ''}
    <div style="font-size:28px;font-weight:200;line-height:1.15;margin:0 0 16px">${esc(titulo)}</div>
  </td></tr>
  ${imagen ? `<tr><td style="padding:0 28px 14px"><img src="${imagen}" width="504" alt="" style="display:block;width:100%;max-width:504px;height:auto;border:0"></td></tr>` : ''}
  <tr><td style="padding:0 28px;font-size:15px;line-height:1.6;font-weight:300">${cuerpo}</td></tr>
  ${fila}
  ${cta ? `<tr><td style="padding:10px 28px 26px"><a href="${cta.url}" style="display:inline-block;background:#2b2b2a;color:#f2f2f2;text-decoration:none;font-size:12px;letter-spacing:.14em;text-transform:uppercase;padding:14px 24px">${esc(cta.texto)} →</a></td></tr>` : ''}
  ${nota ? `<tr><td style="padding:0 28px 22px;font-size:13px;color:#6b6b69">${nota}</td></tr>` : ''}
  <tr><td style="padding:18px 28px 24px;border-top:1px solid #e4dfd8;font-size:12px;color:#8a8a88;line-height:1.6">
    Galería 9 · Providencia, Guadalajara<br>
    <a href="${IG}" style="color:#8a7a52">Instagram</a> · <a href="${WA}" style="color:#8a7a52">WhatsApp</a> · <a href="${site}" style="color:#8a7a52">galeria9</a>
  </td></tr>
</table></td></tr></table>`;
}

// Fila de 3 puntos con icono (PNG dorados en /email/ic-*.png del sitio)
function iconRow(env, items) {
  const site = siteUrl(env);
  const celdas = items.map(([ic, titulo, texto]) => `
    <td valign="top" width="33%" style="padding:0 8px;text-align:center">
      <img src="${site}/email/ic-${ic}.png" width="40" height="40" alt="" style="display:block;margin:0 auto 8px;border:0">
      <div style="font-size:13px;font-weight:500;color:#2b2b2a;margin:0 0 3px">${esc(titulo)}</div>
      <div style="font-size:12px;line-height:1.45;color:#6b6b69">${esc(texto)}</div>
    </td>`).join('');
  return `<tr><td style="padding:14px 20px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f1;border-top:1px solid #e4dfd8;border-bottom:1px solid #e4dfd8"><tr><td style="padding:18px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${celdas}</tr></table></td></tr></table></td></tr>`;
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
    findTag: async (name) => (await all('/tags', 'tags')).find((t) => t.name.toLowerCase() === name.toLowerCase()) || null,
    tagSubscribers: async (tagId) => (await all(`/tags/${tagId}/subscribers`, 'subscribers')).map((s) => s.email_address),
    subscriberTags: (id) => all(`/subscribers/${id}/tags`, 'tags'),
    addTag: (tagId, email) => call('POST', `/tags/${tagId}/subscribers`, { email_address: email }),
    removeTag: (tagId, email) => call('DELETE', `/tags/${tagId}/subscribers?email_address=${encodeURIComponent(email)}`),
    upsert: async (email, firstName, fields) =>
      (await call('POST', '/subscribers', { email_address: email, ...(firstName ? { first_name: firstName } : {}), fields })).subscriber,
    findSequence: async (name) => (await all('/sequences', 'sequences')).find((s) => s.name === name) || null,
    createSequence: async (body) => (await call('POST', '/sequences', body)).sequence,
    createSequenceEmail: async (id, body) => (await call('POST', `/sequences/${id}/emails`, body)).email,
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
