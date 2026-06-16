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
  'Diagnóstico enviado': 'Introducción enviada', // opener de intro aprobado/enviado
  'Intención detectada': 'Prospecto activo',     // respondió / paso 2 de la secuencia
  'Agenda en proceso': 'Seguimiento en marcha',  // pidió horarios para llamada con Alek
  'Requiere Alek': 'Seguimiento en marcha',      // handoff humano (el pipeline 6 no tiene stage propio)
  'Nutrición': 'Prospecto activo',               // "ahora no": sigue prospecto activo (suave)
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

module.exports = {
  IA360_DEFAULT_PIPELINE_NAME,
  IA360_PARTNERS_PIPELINE_NAME,
  IA360_PARTNER_RELATIONSHIPS,
  IA360_PARTNER_STAGE_MAP,
  ia360PipelineForRelationship,
  ia360ResolveStageName,
};
