# Formularios v2 — conclusiones

Flujo: resumen del cliente → afinamos aquí → se construye en **staging** (`staging.galeria9.pages.dev`).
Staging comparte la base de Airtable de producción: los envíos desde `staging.` se marcan `test_record` automáticamente.

---

## 01 · Eventos — CONSTRUIDO en staging

**Objetivo:** recopilar los datos del evento sin pedir presupuesto ni mostrar cotizaciones o tarifas internas. No dispara reserva: el equipo confirma disponibilidad y aparta el espacio manualmente.

**Campos visibles**
1. Nombre de la persona de contacto
2. Celular / WhatsApp
3. Correo electrónico
4. Tipo o nombre del evento
5. Espacio: Terraza / Roof (sin precio) — *ver desviaciones*
6. Día y fecha solicitados — lunes a sábado (domingo bloqueado)
7. Hora de inicio y término, o duración estimada — **texto libre**
8. Número estimado de personas
9. Comentarios o necesidades adicionales — texto libre

**Bloque informativo público** (texto fijo en la página, no es un campo ni cotización):
> **Promoción especial para tus eventos** — Renta el espacio por 3 horas a $250 MXN por persona, con un mínimo de 10 personas. Incluye mesas, sillas y mantel, además de proyector.

**Se elimina del cotizador actual:** precios por hora, extras, total estimado, marca/proyecto, objetivo, fecha alterna, wizard de 5 pasos (pasa a una sola página).

**Destino:** Leads (`Interes = Evento`); los datos del evento van en `Detalle`.
**Worker:** sin cambios (usa el endpoint de escritura existente; ya no lee `?read=precios`).
**Airtable:** sin cambios de esquema.
**Copy del sitio:** "Cotiza tu evento" → **"Solicita tu evento"** (hero, /espacios, contacto, tarjeta Eventos). La URL `/cotiza` se conserva.

**Desviaciones respecto al resumen del cliente**
- **Se agregó el campo Espacio (Terraza / Roof).** El resumen no lo incluía; decisión nuestra (24 sep) para que el equipo sepa qué espacio buscan. Sin precios.
- Hora: el resumen decía "hora de inicio y término (o duración estimada)"; quedó como un solo campo de texto libre.

---

## 02 · Punto Presencia — CONSTRUIDO en staging

**Página nueva `/punto-presencia`**; la tarjeta Punto Presencia de /estrategias apunta ahí (hoy manda al contacto genérico).

**Campos visibles**
1. Nombre
2. Celular / WhatsApp
3. Correo electrónico
4. Instagram de la marca — obligatorio
5. ¿Qué plan te interesa? — **dos tarjetas seleccionables con check**, una sola opción (radio: marcar una desmarca la otra; no hay planes contradictorios)

**Texto de las opciones**
> **VISIBILIDAD — Expande tu visibilidad.** Dale a tu marca un punto físico y un punto de entrega. Crea tus eventos, participa en un open house, obtén visibilidad en las redes de Galería 9, valida tu producto y empieza a crear comunidad.

> **EXPANSIÓN — Tu marca, con apoyo creativo.** Incluye los beneficios de Visibilidad y suma tu propia agencia de creación de contenido: contenido digital para tus redes e Instagram personalizado especialmente para tu marca.

**Confirmación al enviar**
> Recibimos tu solicitud. El equipo se pondrá en contacto contigo para agendar una visita — o si gustas, agenda una visita de una vez: **[Agendar visita]** (modal de Cal.com, evento `visita-galeria-9`).

**Destino:** Leads (`Interes = Punto Presencia`); plan e Instagram en `Detalle`.
**Worker:** sin cambios. **Airtable:** sin cambios de esquema.

**Desviaciones respecto al resumen del cliente**
- **Se agregó el botón "Agendar visita" en la confirmación** (Cal.com), después de su texto original. Decisión nuestra (24 sep) para ahorrar el ida y vuelta por WhatsApp.

**Pendiente de preguntar al cliente**
- **Plan Básico:** el catálogo tiene 3 planes (Básico, Visibilidad, Expansión) y el form solo ofrece Visibilidad y Expansión. ¿Se retira Básico? Si sí, sacarlo del catálogo de Airtable.

---

## 03 · Tu Talento es un Arte / Invitado Especial — CONSTRUIDO en staging

Un solo componente (`components/SolicitudTalento.astro`) usado en **/tu-talento** y **/invitado-especial** (página nueva). El origen se manda como `Interes` del Lead ("Tu Talento es un Arte" / "Invitado Especial") y también va en `Detalle`.

**Campos:** nombre · WhatsApp · correo · página web (opcional) · Instagram (opcional) · giro o talento (largo) · concepto y piezas a exhibir (largo, va en `Mensaje`).

**Cambio de comportamiento:** Tu Talento **dejaba de ser consistente** — creaba una Orden en Borrador + Line_Item (script `marketForm.js`). Ahora crea un Lead, como el resto del sitio. La nota de requisitos (logo, QR, pago) se quitó: eso se pide en el onboarding.

---

## 04 · Tester Day — PENDIENTE (Luis confirma con el cliente)

Idea: mostrar las fechas de Tester Day y que la marca llene "Quiero participar" para una fecha concreta.
- **A) Fechas automáticas:** el sitio calcula los próximos ~6 miércoles (la página actual dice "todos los miércoles, 10:00 am a 2:00 pm"). Sin Worker ni Airtable.
- **B) Fechas en Airtable:** Fer da de alta cada fecha y puede cancelar o poner cupo. Requiere una lectura nueva en el Worker.

**Campos (del brief):** nombre · WhatsApp · correo · Instagram · ¿qué vendes o de qué trata tu marca? (largo) · ¿qué vas a regalar? (largo).
**Info visible:** "Las dinámicas son express: máximo 15 minutos de interacción con cada cliente."
`/tester-day` sigue en su versión vieja (crea Orden en Borrador) hasta cerrar esta decisión; la tarjeta de /estrategias manda al contacto.

---

## 05 · Agencia (Expresa tu talento + agencia) — CONSTRUIDO en staging

Servicio nuevo. Página **/agencia** con diagnóstico breve → Lead con `Interes = Agencia` (la opción se creó sola en Airtable al primer envío).

**Campos:** nombre · WhatsApp · correo · giro de negocio o talento · link de Instagram.

**Pendiente de confirmar:** el brief se cortaba en "Datos de contacto". Si hay preguntas de diagnóstico adicionales, se agregan aquí.

---

## Reacomodo de las 3 puertas del home

- Transformación → **/habitos**
- Conexión → **/estrategias** (las 6 tarjetas: Eventos, Punto Presencia, Pop Up, Tu Talento, Tester Day, Invitado)
- Expansión → **/agencia**

A dónde lleva cada tarjeta de /estrategias: Eventos → /cotiza · Punto Presencia → /punto-presencia · Pop Up → /pop-up · Tu Talento → /tu-talento · Invitado → /invitado-especial · Tester Day → contacto (hasta cerrar el 04).

## Reglas comunes

- Correo **obligatorio** en todos (el brief no lo marca opcional).
- Todo lo que se crea desde `staging.` o local lleva `test_record = true`.
- "Cotiza tu evento" → "Solicita tu evento" en todo el sitio. Se borró el cotizador viejo (`cotiza.js`, `data/catalogo.js`).
