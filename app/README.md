# Galería 9 — App (front de producción)

Front-end custom (headless) de Galería 9. Astro + componentes, deploy previsto en **Cloudflare Pages**. Escribe a Airtable a través del **Cloudflare Worker** (borde seguro que guarda el token).

## Correr en local

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # genera dist/ (estático)
```

## Estructura

```
src/
├── layouts/Base.astro        Layout + <head> + nav/footer + reveal-on-scroll
├── components/                Nav, Footer
├── pages/
│   ├── index.astro           Landing luxury (hero, pilares, espacios, CTA)
│   └── cotiza.astro          Flujo "Activa tu marca / Cotiza tu evento" (5 pasos)
├── scripts/cotiza.js         Estado del flujo, total en vivo, envío a Airtable
├── data/catalogo.js          Espejo del catálogo real (espacios por hora + extras)
├── config.js                 Worker + base de producción + helpers de escritura
└── styles/global.css         Tokens de marca (BrandingKit_V1) + base
worker/galeria9-airtable.js   Código del Worker (multi-base) — pegar en Cloudflare
```

## Flujo "Cotiza tu evento"

5 pasos: **Proyecto → Espacio → Detalles → Extras → Contacto**. Reemplaza el Google Form
"Activa Tu Marca" (mismos campos cualitativos) y además calcula un **estimado en vivo**.

Al enviar crea en la base de producción `appSkdHwrlulZ2iJc`:
1. **Cliente** (la marca/proyecto)
2. **Contacto** (persona responsable + WhatsApp/correo)
3. **Orden** con `Estatus = Borrador` y el brief en `Notas`
4. **Line_Items** (espacio × horas + cada extra), enlazados a `Servicios_Extras`.
   `Monto` de la Orden se calcula solo por rollup de los subtotales.

Modelo de precio real: el espacio se cobra **por hora** (Terraza $800/h, Roof $1200/h,
registros de `Servicios_Extras` categoría *Horas*). Los extras son el resto del catálogo.

## Pendientes para que el envío escriba en vivo

1. **Deploy del Worker** — pegar `worker/galeria9-airtable.js` en Cloudflare y Deploy.
2. **Scope del token** — el PAT `AIRTABLE_TOKEN` del Worker debe incluir la base de
   producción `appSkdHwrlulZ2iJc` (hoy solo tiene la demo). Sin esto → 403.

La *forma* de escritura ya se validó end-to-end contra producción (Monto rollup = OK).
```
