# Formularios v2 — conclusiones

Flujo: resumen del cliente → afinamos aquí → se construye en **staging** (`staging.galeria9.pages.dev`).
Staging comparte la base de Airtable de producción: los envíos desde `staging.` se marcan `test_record` automáticamente.

---

## 01 · Eventos — CERRADO (pendiente de construir)

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

## 02 · Punto Presencia — CERRADO (pendiente de construir)

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
