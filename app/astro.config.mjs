import { defineConfig } from 'astro/config';

// Producción: se despliega en Cloudflare Pages (output estático).
// El envío del formulario escribe a Airtable vía el Cloudflare Worker.
export default defineConfig({
  site: 'https://galeria9.pages.dev',
  output: 'static',
});
