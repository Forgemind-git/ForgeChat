// G8 (2026-06-16): los deals de aliado/referido BNI deben caer en su pipeline
// propio "Partners / Aliados (BNI)" (id 6), NO en el Revenue genérico (id 2).
//
// Origen: auditoría 05-Agentes/auditorias/2026-06-15-pipeline-aliado-bni-vs-journey.md
// (gap P0-1). Antes, syncIa360Deal hardcodeaba el pipeline genérico, así que el
// pipeline 6 tenía 0 deals y el journey de partner no se medía.
//
// Este test NO requiere webhook.js (necesitaría express/pool y no hay node_modules):
// requiere el módulo PURO de ruteo (ia360DealRouting) para la lógica, y lee
// webhook.js como STRING para verificar que el cableado real pasa pipelineName.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  IA360_DEFAULT_PIPELINE_NAME,
  IA360_PARTNERS_PIPELINE_NAME,
  IA360_PARTNER_STAGE_MAP,
  ia360PipelineForRelationship,
  ia360ResolveStageName,
} = require('../src/routes/ia360DealRouting');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'webhook.js'), 'utf8');

// IDs y stages REALES, verificados por SELECT en coexistence (2026-06-16):
//   pipelines: 2 = 'IA360 WhatsApp Revenue Pipeline', 6 = 'Partners / Aliados (BNI)'.
//   pipeline 6 stages (position|name|type): 0 Fit identificado(open),
//   1 Introducción enviada(open), 2 Prospecto activo(open),
//   3 Diagnóstico compartido(open), 4 Seguimiento en marcha(open),
//   5 Ganado(won), 6 Perdido(lost).
const REAL_PIPELINE_IDS = {
  'IA360 WhatsApp Revenue Pipeline': 2,
  'Partners / Aliados (BNI)': 6,
};
const REAL_PARTNER_STAGES = new Set([
  'Fit identificado', 'Introducción enviada', 'Prospecto activo',
  'Diagnóstico compartido', 'Seguimiento en marcha', 'Ganado', 'Perdido',
]);

// Mimetiza exactamente lo que hace syncIa360Deal:
//   SELECT id FROM coexistence.pipelines WHERE name = $1
// El nombre lo decide el ruteo real (ia360PipelineForRelationship).
function resolvePipelineIdForRelationship(relationshipContext) {
  const name = ia360PipelineForRelationship(relationshipContext);
  return REAL_PIPELINE_IDS[name] ?? null;
}

test('deal de ALIADO (aliado_socio) → pipeline "Partners / Aliados (BNI)" id 6', () => {
  assert.equal(ia360PipelineForRelationship('aliado_socio'), IA360_PARTNERS_PIPELINE_NAME);
  assert.equal(resolvePipelineIdForRelationship('aliado_socio'), 6);
});

test('deal de REFERIDO BNI (referido_bni) → pipeline "Partners / Aliados (BNI)" id 6', () => {
  assert.equal(ia360PipelineForRelationship('referido_bni'), IA360_PARTNERS_PIPELINE_NAME);
  assert.equal(resolvePipelineIdForRelationship('referido_bni'), 6);
});

test('deal NORMAL (cliente/beta/sponsor/sin relación) → Revenue genérico id 2', () => {
  for (const rel of ['cliente_activo', 'beta_amigo', 'sponsor_ejecutivo', 'director_comercial', '', null, undefined, 'basura']) {
    assert.equal(ia360PipelineForRelationship(rel), IA360_DEFAULT_PIPELINE_NAME, `rel=${rel}`);
    assert.equal(resolvePipelineIdForRelationship(rel), 2, `rel=${rel}`);
  }
});

test('todos los stages mapeados de aliado EXISTEN en el pipeline 6 (sin gaps de stage inválido)', () => {
  for (const [revenueStage, partnerStage] of Object.entries(IA360_PARTNER_STAGE_MAP)) {
    assert.ok(
      REAL_PARTNER_STAGES.has(partnerStage),
      `El stage "${partnerStage}" (mapeado desde "${revenueStage}") NO existe en el pipeline 6`
    );
  }
});

test('ia360ResolveStageName traduce stages Revenue→Partners solo para el pipeline 6', () => {
  // Pipeline Partners: traduce a stage real.
  assert.equal(ia360ResolveStageName(IA360_PARTNERS_PIPELINE_NAME, 'Diagnóstico enviado'), 'Introducción enviada');
  assert.equal(ia360ResolveStageName(IA360_PARTNERS_PIPELINE_NAME, 'Intención detectada'), 'Prospecto activo');
  assert.equal(ia360ResolveStageName(IA360_PARTNERS_PIPELINE_NAME, 'Agenda en proceso'), 'Seguimiento en marcha');
  assert.equal(ia360ResolveStageName(IA360_PARTNERS_PIPELINE_NAME, 'Requiere Alek'), 'Seguimiento en marcha');
  // Pipeline genérico: NO traduce (deja el nombre tal cual del Revenue pipeline).
  assert.equal(ia360ResolveStageName(IA360_DEFAULT_PIPELINE_NAME, 'Diagnóstico enviado'), 'Diagnóstico enviado');
  assert.equal(ia360ResolveStageName(IA360_DEFAULT_PIPELINE_NAME, 'Requiere Alek'), 'Requiere Alek');
});

// ── Cableado real en webhook.js (anti-regresión por lectura de fuente) ──────────
test('syncIa360Deal acepta pipelineName con default genérico (no rompe lo existente)', () => {
  assert.match(
    src,
    /async function syncIa360Deal\(\{[^}]*pipelineName = IA360_DEFAULT_PIPELINE_NAME[^}]*\}\)/,
    'syncIa360Deal debe aceptar pipelineName con default IA360_DEFAULT_PIPELINE_NAME'
  );
  // Aísla el cuerpo de syncIa360Deal (hasta la siguiente declaración de función)
  // y verifica que su SELECT de pipeline está PARAMETRIZADO (WHERE name = $1) y ya
  // NO hardcodea el nombre. (Otras funciones fuera de scope, p. ej.
  // getActiveNonTerminalIa360Deal, sí pueden seguir consultando el genérico.)
  const start = src.indexOf('async function syncIa360Deal(');
  const after = src.indexOf('\nasync function ', start + 1);
  const body = src.slice(start, after === -1 ? undefined : after);
  assert.match(body, /SELECT id FROM coexistence\.pipelines WHERE name = \$1/);
  assert.doesNotMatch(
    body,
    /WHERE name = 'IA360 WhatsApp Revenue Pipeline'/,
    'syncIa360Deal ya no debe hardcodear el nombre del pipeline en su SELECT'
  );
});

test('los handlers de aliado/referido derivan el pipeline y lo pasan a syncIa360Deal', () => {
  // handleIa360SequenceReply deriva dealPipelineName del flow y lo pasa.
  assert.match(src, /const dealPipelineName = ia360PipelineForRelationship\(flow\?\.relationshipContext\)/);
  const seqPassCount = (src.match(/pipelineName: dealPipelineName,/g) || []).length;
  assert.equal(seqPassCount, 5, 'los 5 callsites de handleIa360SequenceReply deben pasar dealPipelineName');
  // handleIa360OwnerApproveSend (opener enviado) deriva del flow.
  assert.match(src, /pipelineName: ia360PipelineForRelationship\(flow\?\.relationshipContext\),/);
  // handleIa360OwnerApproveManual (takeover) deriva del relationship_context del contacto.
  assert.match(src, /pipelineName: ia360PipelineForRelationship\(contact\?\.custom_fields\?\.relationship_context\),/);
});

test('el handoff n8n "Requiere Alek" se evalúa sobre el nombre LÓGICO, no el stage resuelto', () => {
  // Si se evaluara sobre targetStage.name, el pipeline Partners (que mapea
  // "Requiere Alek" → "Seguimiento en marcha") nunca dispararía el handoff.
  assert.match(src, /if \(requestedStageName === 'Requiere Alek'\)/);
});
