// G10 (P2): stages muertos del pipeline 6 (Partners / Aliados BNI) cableados al
// stage map, + secuencias Blueprint/Propuesta como STUB INERTE detrás de un flag
// que FALLA CERRADO. Este test requiere SOLO el módulo puro ia360DealRouting (no
// webhook.js, que necesitaría express/pool y no hay node_modules).
//
// Lo que se garantiza:
//   - Flag default OFF: las secuencias no se ofrecen y nada es enviable, aunque el
//     template "exista" (fail-closed por flag).
//   - Flag ON pero sin template aprobado → no enviable (fail-closed por template).
//   - El stage map alcanza "Fit identificado" (pos 0) y "Diagnóstico compartido"
//     (pos 3) por sus tres vías (directo / Blueprint / Propuesta).
//   - No-regresión: mapeos viejos y ruteo por relación intactos.
//
// El flag IA360_PARTNER_BLUEPRINT se evalúa en load-time (const), así que los
// helpers aceptan el estado del flag como parámetro inyectable para poder probar
// AMBOS lados sin recargar el proceso.
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  IA360_DEFAULT_PIPELINE_NAME,
  IA360_PARTNERS_PIPELINE_NAME,
  IA360_PARTNER_STAGE_MAP,
  ia360PipelineForRelationship,
  ia360ResolveStageName,
  IA360_PARTNER_BLUEPRINT_ENABLED,
  IA360_PARTNER_BLUEPRINT_SEQUENCES,
  ia360PartnerBlueprintSequences,
  ia360PartnerBlueprintSendable,
} = require('../src/routes/ia360DealRouting');

// ── Flag fail-closed ────────────────────────────────────────────────────────
test('flag DEFAULT OFF: las secuencias Blueprint/Propuesta NO se ofrecen', () => {
  // El test corre sin IA360_PARTNER_BLUEPRINT en el entorno → const = false.
  assert.equal(IA360_PARTNER_BLUEPRINT_ENABLED, false);
  assert.deepEqual(ia360PartnerBlueprintSequences(), []);
});

test('flag OFF: NADA es enviable aunque el template "exista" (fail-closed por flag)', () => {
  const seq = IA360_PARTNER_BLUEPRINT_SEQUENCES[0];
  // Con el flag por default (OFF), incluso pasando el template correcto → false.
  assert.equal(ia360PartnerBlueprintSendable(seq, seq.metaTemplateName), false);
  assert.equal(ia360PartnerBlueprintSendable(seq, 'lo-que-sea'), false);
  // Inyectando el flag OFF explícitamente: idéntico.
  assert.equal(ia360PartnerBlueprintSendable(seq, seq.metaTemplateName, false), false);
});

test('flag ON: enviable SOLO con el template aprobado; sin template → no enviable', () => {
  for (const seq of IA360_PARTNER_BLUEPRINT_SEQUENCES) {
    // Con flag ON las secuencias sí se ofrecen.
    assert.equal(ia360PartnerBlueprintSequences(true).length, IA360_PARTNER_BLUEPRINT_SEQUENCES.length);
    // Template aprobado (coincide) → enviable.
    assert.equal(ia360PartnerBlueprintSendable(seq, seq.metaTemplateName, true), true);
    // Sin template → fail-closed (el corazón del stub: no hay template en Meta aún).
    assert.equal(ia360PartnerBlueprintSendable(seq, '', true), false);
    assert.equal(ia360PartnerBlueprintSendable(seq, null, true), false);
    assert.equal(ia360PartnerBlueprintSendable(seq, undefined, true), false);
    // Template distinto al de la secuencia → no enviable (no se cuela otro).
    assert.equal(ia360PartnerBlueprintSendable(seq, 'ia360_otro_template', true), false);
  }
});

test('catálogo Blueprint/Propuesta: ambas apuntan a "Diagnóstico compartido"', () => {
  assert.equal(IA360_PARTNER_BLUEPRINT_SEQUENCES.length, 2);
  for (const seq of IA360_PARTNER_BLUEPRINT_SEQUENCES) {
    assert.equal(seq.stage, 'Diagnóstico compartido');
    assert.ok(seq.id && seq.label && seq.metaTemplateName, `secuencia incompleta: ${JSON.stringify(seq)}`);
  }
});

// ── Stage map: los dos stages muertos ahora son alcanzables ─────────────────
test('"Fit identificado" (pos 0) alcanzable en el pipeline Partners', () => {
  assert.equal(ia360ResolveStageName(IA360_PARTNERS_PIPELINE_NAME, 'Fit identificado'), 'Fit identificado');
});

test('"Diagnóstico compartido" (pos 3) alcanzable por sus tres vías', () => {
  assert.equal(ia360ResolveStageName(IA360_PARTNERS_PIPELINE_NAME, 'Diagnóstico compartido'), 'Diagnóstico compartido');
  assert.equal(ia360ResolveStageName(IA360_PARTNERS_PIPELINE_NAME, 'Blueprint compartido'), 'Diagnóstico compartido');
  assert.equal(ia360ResolveStageName(IA360_PARTNERS_PIPELINE_NAME, 'Propuesta enviada'), 'Diagnóstico compartido');
});

// ── No-regresión: mapeos viejos intactos ────────────────────────────────────
test('no-regresión: mapeos viejos del stage map intactos', () => {
  assert.equal(IA360_PARTNER_STAGE_MAP['Diagnóstico enviado'], 'Introducción enviada');
  assert.equal(IA360_PARTNER_STAGE_MAP['Intención detectada'], 'Prospecto activo');
  assert.equal(IA360_PARTNER_STAGE_MAP['Agenda en proceso'], 'Seguimiento en marcha');
  assert.equal(IA360_PARTNER_STAGE_MAP['Requiere Alek'], 'Seguimiento en marcha');
  assert.equal(IA360_PARTNER_STAGE_MAP['Nutrición'], 'Prospecto activo');
  assert.equal(IA360_PARTNER_STAGE_MAP['Ganado'], 'Ganado');
  assert.equal(IA360_PARTNER_STAGE_MAP['Perdido / no fit'], 'Perdido');
  // Resolución vía función (espejo de los mapeos).
  assert.equal(ia360ResolveStageName(IA360_PARTNERS_PIPELINE_NAME, 'Diagnóstico enviado'), 'Introducción enviada');
  assert.equal(ia360ResolveStageName(IA360_PARTNERS_PIPELINE_NAME, 'Requiere Alek'), 'Seguimiento en marcha');
});

test('no-regresión: ruteo de pipeline por relación intacto', () => {
  assert.equal(ia360PipelineForRelationship('aliado_socio'), IA360_PARTNERS_PIPELINE_NAME);
  assert.equal(ia360PipelineForRelationship('referido_bni'), IA360_PARTNERS_PIPELINE_NAME);
  assert.notEqual(ia360PipelineForRelationship('cliente_activo'), IA360_PARTNERS_PIPELINE_NAME);
  assert.equal(ia360PipelineForRelationship('cliente_activo'), IA360_DEFAULT_PIPELINE_NAME);
});

test('no-regresión: pipeline genérico NO traduce stages', () => {
  assert.equal(ia360ResolveStageName(IA360_DEFAULT_PIPELINE_NAME, 'Fit identificado'), 'Fit identificado');
  assert.equal(ia360ResolveStageName(IA360_DEFAULT_PIPELINE_NAME, 'Diagnóstico enviado'), 'Diagnóstico enviado');
});
