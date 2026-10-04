# Plantillas de correo — Galería 9

Las usa el Worker `galeria9-mkt` (código en `app/worker-mkt/`). Las lee del sitio publicado (`SITE_URL/email/plantillas/…`), así que **para cambiar un correo basta con editar el archivo y hacer push**: no hay que volver a pegar el Worker. Cambios en `staging` se ven con `SITE_URL` apuntando a staging.

| Archivo | Correo | Se manda |
|---|---|---|
| `marco.html` | Marco común: encabezado, portada, título, iconos, botón y pie | En todos |
| `bienvenida-newsletter.html` | Alta al newsletter | Al suscribirse en el sitio (secuencia de Kit) |
| `bienvenida-pp.html` | Orden de Punto Presencia aprobada + link de onboarding | Al sincronizar una orden nueva (secuencia de Kit) |
| `tester-day.html` | Recordatorio de Tester Day a marcas de PP | 3 días antes de cada Tester Day público |
| `agenda.html` | Agenda del mes | El día 1 de cada mes |

## Cómo se edita

**Encabezado** (el comentario `<!-- … -->` de arriba), una línea por dato:

```
asunto: …            asunto del correo
preview: …           texto que se ve junto al asunto en la bandeja
eyebrow: …           etiqueta dorada arriba a la derecha
titulo: …            título grande
portada: hero-x.jpg  foto de /email/ (opcional)
icono: nombre | Título | Texto     hasta 3; iconos en /email/ic-<nombre>.png
boton: Texto | url
```

**Cuerpo**: el HTML debajo del encabezado.

**Datos**
- `[[nombre]]` los pone el Worker: `[[site]]` en todos; en Tester Day `[[fecha_corta]]`, `[[fecha_texto]]`, `[[horario]]`, `[[descripcion]]`, `[[imagen]]`; en la agenda `[[mes]]` y la lista `[[#eventos]] … [[/eventos]]` (cada uno con `[[titulo]]`, `[[fecha_corta]]`, `[[horario]]`, `[[descripcion]]`, `[[imagen]]`).
- `[[#x]] … [[/x]]` se muestra solo si `x` existe (o se repite si es lista); `[[^x]] … [[/x]]` solo si no existe. `[[&x]]` inserta sin escapar (URLs, HTML).
- `{{ subscriber.… }}` y `{% if … %}` son de **Kit** (datos de cada contacto: `first_name`, `marca`, `plan_pp`, `inicio_estancia_texto`, `fin_estancia_texto`, `link_onboarding`).

## Después de editar

- **Tester Day y agenda**: listo con el push (el Worker guarda las plantillas en caché 1 minuto).
- **Las dos bienvenidas**: Kit guarda su copia porque son secuencias → correr `/setup?k=<ADMIN_KEY>` para actualizarlas.
- Para revisar: `https://galeria9-mkt.datatlan.workers.dev/preview?k=<ADMIN_KEY>` muestra los 4 con datos reales.
