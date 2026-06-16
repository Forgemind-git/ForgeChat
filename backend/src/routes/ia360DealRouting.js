// G8 (2026-06-16): ruteo de pipeline por relación para el journey de aliado BNI.
//
// Problema (auditoría 05-Agentes/auditorias/2026-06-15-pipeline-aliado-bni-vs-journey.md,
// gap P0-1): `syncIa360Deal` hardcodeaba el pipeline genérico
// 'IA360 WhatsApp Revenue Pipeline' (id 2), así que TODO deal —incluidos los de
// aliado/referido BNI— caía ahí, y el pipeline propio "Partners / Aliados (BNI)"
// (id 6) quedaba en 0 deals. El journey de partner no se medía ni avanzaba con
// lógica.
//
// Este módulo es PURO (sin dependencias: ni express, ni pool) para que el test
// pueda requerirlo aunque no haya node_modules instalado. `webhook.js` lo consume.
//
// IDs reales (verificados por SELECT en coexistence.pipelines, 2026-06-16):
//   2 = IA360 WhatsApp Revenue Pipeline (genérico)   6 = Partners / Aliados (BNI)

const IA360_DEFAULT_PIPELINE_NAME = 'IA360 WhatsApp Revenue Pipeline';
const IA360_PARTNERS_PIPELINE_NAME = 'Partners / Aliados (BNI)';

// Relaciones que pertenecen al journey BNI (catálogo persona-first de webhook.js:
// persona_aliado.relationshipContext = 'aliado_socio',
// persona_referido.relationshipContext = 'referido_bni').
const IA360_PARTNER_RELATIONSHIPS = new Set(['aliado_socio', 'referido_bni']);

// Traducción de stage del Revenue pipeline (semántica COMPARTIDA por los handlers
// persona-first, p. ej. handleIa360SequenceReply) → stage REAL del pipeline
// Partners/Aliados (BNI). Stages reales del pipeline 6 (position|name|type,
// verificados por SELECT 2026-06-16):
//   0 Fit identificado (open) · 1 Introducción enviada (open) · 2 Prospecto activo (open)
//   3 Diagnóstico compartido (open) · 4 Seguimiento en marcha (open)
//   5 Ganado (won) · 6 Perdido (lost)
//
// Gaps documentados (auditoría §1, P1, fuera de este P0):
//   - "Fit identificado" (0) no lo setea ningún callsite: el deal de partner nace
//     al enviarse el opener → "Introducción enviada".
//   - "Diagnóstico compartido" (3) no lo alcanza ningún callsite hoy (faltan las
//     secuencias Blueprint/Propuesta del journey).
const IA360_PARTNER_STAGE_MAP = {
  'Fit identificado': 'Fit identificado',        // G10: pre-envío, partner identificado como fit (pos 0)
  'Diagnóstico enviado': 'Introducción enviada', // opener de intro aprobado/enviado
  'Intención detectada': 'Prospecto activo',     // respondió / paso 2 de la secuencia
  'Agenda en proceso': 'Seguimiento en marcha',  // pidió horarios para llamada con Alek
  'Requiere Alek': 'Seguimiento en marcha',      // handoff humano (el pipeline 6 no tiene stage propio)
  'Nutrición': 'Prospecto activo',               // "ahora no": sigue prospecto activo (suave)
  // G10 (P2): el journey aliado alcanza "Diagnóstico compartido" (pos 3) por tres
  // vías semánticas; las tres caen en el MISMO stage real del pipeline 6.
  'Diagnóstico compartido': 'Diagnóstico compartido', // stage real directo
  'Blueprint compartido': 'Diagnóstico compartido',   // secuencia Blueprint entregada
  'Propuesta enviada': 'Diagnóstico compartido',      // secuencia Propuesta entregada
  'Ganado': 'Ganado',
  'Perdido / no fit': 'Perdido',
};

// Devuelve el NOMBRE de pipeline destino para un relationshipContext dado.
// Partner (aliado_socio / referido_bni) → "Partners / Aliados (BNI)"; el resto
// (cliente_activo, beta_amigo, sponsor_ejecutivo, etc. y los flujos sin relación
// como el 100M/Revenue) → el genérico. Nunca lanza: entrada inválida → genérico.
function ia360PipelineForRelationship(relationshipContext) {
  return IA360_PARTNER_RELATIONSHIPS.has(String(relationshipContext || ''))
    ? IA360_PARTNERS_PIPELINE_NAME
    : IA360_DEFAULT_PIPELINE_NAME;
}

// Traduce el stage solicitado (semántica Revenue) al stage real de un pipeline.
// Solo se traduce para el pipeline Partners; para cualquier otro se devuelve el
// nombre tal cual (el callsite ya pasa el stage real del pipeline genérico).
function ia360ResolveStageName(pipelineName, requestedStageName) {
  if (pipelineName !== IA360_PARTNERS_PIPELINE_NAME) return requestedStageName;
  return IA360_PARTNER_STAGE_MAP[requestedStageName] || requestedStageName;
}

// ============================================================================
// G10 (P2): secuencias Blueprint / Propuesta del journey aliado — STUB INERTE
// detrás de un flag que FALLA CERRADO.
//
// Hoy NO existen los templates de Meta para estas dos etapas (es el gap P2: hay
// que crearlos y aprobarlos). Hasta que existan, NO debe poder salir nada: ni
// ofrecerse en menús/readouts (flag OFF) ni enviarse sin template aprobado
// (predicado fail-closed). Este módulo solo declara el catálogo y los predicados
// PUROS; la lógica de envío real (cuando exista) vive en webhook.js y DEBE pasar
// por los gates de cold-send existentes (outside_window_template_not_approved /
// cold_template_status_check_failed). Sin template aprobado → no enviable.
//
// DEFAULT OFF: solo se activa con IA360_PARTNER_BLUEPRINT=on en el entorno.
const IA360_PARTNER_BLUEPRINT_ENABLED = process.env.IA360_PARTNER_BLUEPRINT === 'on';

// Catálogo INERTE: describe las dos secuencias nuevas y a qué stage real del
// pipeline 6 llevan ("Diagnóstico compartido", pos 3). metaTemplateName apunta al
// template de Meta que TODAVÍA no existe — por eso el predicado falla cerrado.
const IA360_PARTNER_BLUEPRINT_SEQUENCES = [
  {
    id: 'partner_blueprint',
    label: 'Blueprint compartido',
    metaTemplateName: 'ia360_partner_blueprint',
    stage: 'Diagnóstico compartido',
  },
  {
    id: 'partner_propuesta',
    label: 'Propuesta enviada',
    metaTemplateName: 'ia360_partner_propuesta',
    stage: 'Diagnóstico compartido',
  },
];

// Devuelve las secuencias OFRECIBLES. Con el flag OFF → [] (no se ofrecen en
// ningún menú/readout). El estado del flag es inyectable para poder testear
// ambos lados sin recargar el proceso (el const se evalúa en load-time).
function ia360PartnerBlueprintSequences(enabled = IA360_PARTNER_BLUEPRINT_ENABLED) {
  return enabled ? IA360_PARTNER_BLUEPRINT_SEQUENCES.slice() : [];
}

// Predicado fail-closed: una secuencia Blueprint/Propuesta SOLO es enviable si
//   (a) el flag está ON, y
//   (b) su template de Meta está aprobado/presente (approvedTemplateName coincide
//       con el metaTemplateName de la secuencia).
// Falta el template (''/null/no coincide) → FALSE. Flag OFF → FALSE. Este es el
// corazón del fail-closed: sin template aprobado NO se envía.
function ia360PartnerBlueprintSendable(seq, approvedTemplateName, enabled = IA360_PARTNER_BLUEPRINT_ENABLED) {
  if (!enabled) return false;
  if (!seq || !seq.metaTemplateName) return false;
  const approved = String(approvedTemplateName || '').trim();
  if (!approved) return false;
  return approved === seq.metaTemplateName;
}

module.exports = {
  IA360_DEFAULT_PIPELINE_NAME,
  IA360_PARTNERS_PIPELINE_NAME,
  IA360_PARTNER_RELATIONSHIPS,
  IA360_PARTNER_STAGE_MAP,
  ia360PipelineForRelationship,
  ia360ResolveStageName,
  IA360_PARTNER_BLUEPRINT_ENABLED,
  IA360_PARTNER_BLUEPRINT_SEQUENCES,
  ia360PartnerBlueprintSequences,
  ia360PartnerBlueprintSendable,
};
