// ============================================================================
// Catálogo del flujo "Cotiza tu evento" — ESPEJO de la base de producción
// ----------------------------------------------------------------------------
// Fuente de verdad: base "Galeria9 - Operación" (appSkdHwrlulZ2iJc).
//   · Espacios por hora  → Servicios_Extras, categoría "Horas"
//   · Extras             → Servicios_Extras (resto de categorías)
// Cada item lleva su `rec` (record ID real) para enlazar el Line_Item.
// Si el catálogo cambia en Airtable, re-sincronizar aquí (o migrar a fetch vivo).
// Precios en MXN, tal cual la base (ago 2026).
// ============================================================================

// Espacios rentables — precio POR HORA (Servicios_Extras · categoría Horas)
export const espacios = [
  {
    id: 'terraza', rec: 'recjr5OwrR5u14N2s', nombre: 'Terraza', precioHora: 800,
    desc: 'Patio en planta baja, íntimo y verde.', cap: 'Hasta 40 personas',
  },
  {
    id: 'roof', rec: 'recoklqZQCJ83ARtA', nombre: 'Roof', precioHora: 1200,
    desc: 'Azotea con zona techada y cielo abierto.', cap: 'Hasta 60 personas',
  },
];

// Extras (Servicios_Extras) agrupados por categoría real.
// `qty:true` → el item se cotiza por cantidad (silla, copas…).
export const extras = [
  // --- Difusión ---
  { id: 'inv-digital',   rec: 'recBXpdHDMtW4QWpE', nombre: 'Invitación digital',  cat: 'Difusión', precio: 250,  desc: '2 diseños en formato historia.' },
  { id: 'cob-basica',    rec: 'recklJGSNSocwDyUl', nombre: 'Cobertura básica',    cat: 'Difusión', precio: 1500, desc: '20 imágenes.' },
  { id: 'cob-premium',   rec: 'recJZ0tyBz9tWzO4j', nombre: 'Cobertura premium',   cat: 'Difusión', precio: 2900, desc: '20 imágenes · 3 testimonios · 3 reels.' },
  { id: 'pauta',         rec: 'recvnugSoxq8VjbVA', nombre: 'Servicio de pauta',   cat: 'Difusión', precio: 150,  desc: 'Gestión de campaña (presupuesto de pauta aparte).' },

  // --- Servicio ---
  { id: 'barra',         rec: 'rec73dyod9eT76Nsc', nombre: 'Barra de madera',     cat: 'Servicio', precio: 400 },
  { id: 'mesero',        rec: 'rec8mkLBF7fCoEB3W', nombre: 'Mesero',              cat: 'Servicio', precio: 900,  qty: true },
  { id: 'hostess',       rec: 'recdGRtkZbusRP1cx', nombre: 'Hostess',             cat: 'Servicio', precio: 500 },
  { id: 'copas',         rec: 'recHIHUi1SF0TF7vi', nombre: 'Copas de vino',       cat: 'Servicio', precio: 7,    qty: true, unidad: 'c/u' },
  { id: 'mimosas',       rec: 'recNFBFzEjlZeLBG4', nombre: 'Cristalería mimosas', cat: 'Servicio', precio: 120,  desc: 'Set de 12.' },

  // --- Básico ---
  { id: 'coffee',        rec: 'recAw12sobScwF0sv', nombre: 'Coffee break',        cat: 'Básico', precio: 900 },
  { id: 'proyector',     rec: 'recyWknfMKnruK9oW', nombre: 'Proyector',           cat: 'Básico', precio: 350 },
  { id: 'hielera',       rec: 'recKHpt0WwlKyKe69', nombre: 'Hielera',             cat: 'Básico', precio: 200 },
  { id: 'tablon',        rec: 'recNaCgRFPFZ6k4yW', nombre: 'Tablón 1.20 × 60',    cat: 'Básico', precio: 100,  qty: true },
  { id: 'silla',         rec: 'recdE5ZXPOnQi5wpP', nombre: 'Silla',               cat: 'Básico', precio: 25,   qty: true },

  // --- Wellness ---
  { id: 'tina',          rec: 'rec97zHTnc3dOrAqB', nombre: 'Tina con hielo + servicio', cat: 'Wellness', precio: 1500 },
  { id: 'puffs',         rec: 'recTBbioYlzyAyrOU', nombre: 'Puffs',               cat: 'Wellness', precio: 50,   qty: true },
  { id: 'mats',          rec: 'recXwZjoHHIAhzQac', nombre: 'Mats',                cat: 'Wellness', precio: 50,   qty: true },
  { id: 'cobijas',       rec: 'rechsGrFxO8gZpqcz', nombre: 'Cobijas',             cat: 'Wellness', precio: 100,  qty: true },
];

export const categorias = ['Difusión', 'Servicio', 'Básico', 'Wellness'];

export const money = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0);
