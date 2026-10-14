// Cloudflare Pages Function: personaliza la vista previa (Open Graph) de /boleto?c=<rec>
// para que el link enviado por WhatsApp se vea como tarjeta con la foto, el nombre y la
// fecha del evento. La página en sí no cambia (el boleto se dibuja en el navegador).
// Nunca pone el nombre de la persona en la vista previa (el mensaje se puede reenviar).
const WORKER = 'https://galeria9-airtable.datatlan.workers.dev';
const IMG = 'https://galeria9-mkt.datatlan.workers.dev/img/'; // foto pública del evento
const TZ = 'America/Mexico_City';

const fmt = (iso, o) => new Intl.DateTimeFormat('es-MX', { timeZone: TZ, ...o }).format(new Date(iso));

export async function onRequestGet({ request, next }) {
  // Tarjeta genérica servida desde ESTE dominio (staging o prod), para cualquier /boleto
  const generica = new URL('/og-boleto.png', request.url).href;
  const base = new HTMLRewriter().on('meta[property="og:image"]', { element(el) { el.setAttribute('content', generica); } });
  const res = await next();
  const c = new URL(request.url).searchParams.get('c') || '';
  if (!/^rec[A-Za-z0-9]{14}$/.test(c)) return base.transform(res);

  let d;
  try {
    const r = await fetch(`${WORKER}?read=boleto&r=${c}`);
    d = r.ok ? await r.json() : null;
  } catch { return base.transform(res); }
  if (!d || !d.valido || !d.evento) return base.transform(res);

  const e = d.evento;
  const titulo = `Tu boleto · ${e.titulo}`;
  let desc = 'Galería 9 · Market de Talentos';
  if (e.inicio) {
    const dia = fmt(e.inicio, { weekday: 'long', day: 'numeric', month: 'long' });
    desc = `${dia.charAt(0).toUpperCase()}${dia.slice(1)}, ${fmt(e.inicio, { hour: 'numeric', minute: '2-digit' })} · Galería 9`;
  }

  const set = (v) => ({ element(el) { el.setAttribute('content', v); } });
  let rw = new HTMLRewriter()
    .on('meta[property="og:title"]', set(titulo))
    .on('meta[property="og:description"]', set(desc))
    .on('meta[name="description"]', set(desc))
    .on('title', { element(el) { el.setInnerContent(`${titulo} — Galería 9`); } });
  // foto del evento si es pública; si no, la tarjeta genérica de ESTE dominio (staging o prod)
  rw = rw.on('meta[property="og:image"]', set(e.imagen && e.id ? IMG + e.id : generica));
  const out = rw.transform(res);
  // la vista previa depende de datos vivos: que nadie la guarde en caché
  const h = new Headers(out.headers);
  h.set('Cache-Control', 'no-store');
  return new Response(out.body, { status: out.status, headers: h });
}
