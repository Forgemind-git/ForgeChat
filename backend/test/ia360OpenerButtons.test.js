// G6 (2026-06-15): los botones de los openers de WhatsApp (quick-reply de
// template) llegan con id = el TÍTULO visible ("Sí, cuéntame" / "Ahora no") y
// SIN payload estable. Antes morían en [ia360-fallback]
// (log real: "unhandled interactive reply id=si, cuentame"). Este test demuestra
// que getInteractiveReplyId (vía el parse puro extractInteractiveReplyId) + el
// clasificador de openers YA NO los dejan caer al fallback, sino al handler de
// recuperación nuevo que rutea afirmativo→demo/onboarding y negativo→cierre.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  classifyOpenerReply,
  normalizeOpenerReplyId,
  extractInteractiveReplyId,
} = require('../src/routes/ia360OpenerReply');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'webhook.js'), 'utf8');

// Construye un raw_payload de Meta como el que reenvía n8n, con un button_reply
// cuyo id es el título del botón (lo que hace Meta con los quick-reply sin payload).
function metaButtonReplyRecord(buttonId, buttonTitle) {
  return {
    raw_payload: JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: buttonId, title: buttonTitle || buttonId } },
      }] } }] }],
    }),
  };
}

test('normalizeOpenerReplyId: minúsculas, sin acentos, sin puntuación, trim', () => {
  assert.equal(normalizeOpenerReplyId('  Sí, Cuéntame! '), 'si, cuentame');
  assert.equal(normalizeOpenerReplyId('AHORA NO'), 'ahora no');
  assert.equal(normalizeOpenerReplyId('¿Sí, cuéntame más?'), 'si, cuentame mas');
  assert.equal(normalizeOpenerReplyId(''), '');
});

test('getInteractiveReplyId (parse) extrae el id del button_reply tal cual llega de Meta', () => {
  // El caso EXACTO del log: el botón "Sí, cuéntame" llega con id="si, cuentame".
  const rec = metaButtonReplyRecord('si, cuentame', 'Sí, cuéntame');
  const replyId = extractInteractiveReplyId(rec);
  assert.equal(replyId, 'si, cuentame', 'el id debe llegar en minúsculas+trim como en producción');

  // Y un payload basura no tumba el parse (devuelve '').
  assert.equal(extractInteractiveReplyId({ raw_payload: 'no-json' }), '');
});

test('los openers afirmativos/negativos clasifican (ya NO caen al fallback)', () => {
  const affirmatives = [
    'si, cuentame',        // <- el id EXACTO del log
    'Sí, cuéntame',
    'SÍ, CUÉNTAME',
    'sí, cuéntame más',
    '  Sí, Cuéntame!  ',
    'me interesa',
  ];
  for (const raw of affirmatives) {
    assert.equal(classifyOpenerReply(raw), 'affirmative', `"${raw}" debe rutear como afirmativo`);
  }

  const negatives = ['ahora no', 'Ahora no', 'AHORA NO', 'por ahora no', 'no por ahora'];
  for (const raw of negatives) {
    assert.equal(classifyOpenerReply(raw), 'negative', `"${raw}" debe rutear como negativo (cierre cortés)`);
  }

  // Texto que NO es un botón de opener sigue su curso (null => fallback genérico).
  for (const raw of ['hola', 'cuanto cuesta', 'wa_schedule', '']) {
    assert.equal(classifyOpenerReply(raw), null, `"${raw}" no es un opener reconocible`);
  }
});

test('end-to-end del parse: payload del log → afirmativo, no fallback', () => {
  const rec = metaButtonReplyRecord('si, cuentame', 'Sí, cuéntame');
  const replyId = extractInteractiveReplyId(rec);
  assert.equal(classifyOpenerReply(replyId), 'affirmative');

  const recNo = metaButtonReplyRecord('Ahora no', 'Ahora no');
  assert.equal(classifyOpenerReply(extractInteractiveReplyId(recNo)), 'negative');
});

test('webhook.js cablea el handler de recuperación ANTES del fallback global', () => {
  // El require del módulo puro existe.
  assert.match(src, /require\('\.\/ia360OpenerReply'\)/, 'falta el require del módulo de openers');
  // getInteractiveReplyId delega en el parse puro.
  assert.match(src, /function getInteractiveReplyId\(record\)\s*\{\s*return extractInteractiveReplyId\(record\);/);

  const recoveryIdx = src.indexOf('const openerKind = classifyOpenerReply(replyId || answer);');
  const fallbackIdx = src.indexOf('[ia360-fallback] unhandled interactive reply');
  assert.notEqual(recoveryIdx, -1, 'falta el handler de recuperación de openers');
  assert.notEqual(fallbackIdx, -1, 'falta el fallback global');
  assert.ok(recoveryIdx < fallbackIdx, 'el handler de recuperación debe ir ANTES del fallback');

  // Entre el handler de recuperación y el fallback hay un `return;` que corta el
  // flujo, así que un opener clasificado NUNCA alcanza el fallback.
  const between = src.slice(recoveryIdx, fallbackIdx);
  assert.match(between, /if \(openerKind\) \{/);
  assert.match(between, /REVENUE_OS_COPY\.paso2/, 'afirmativo reusa el copy de demo/onboarding');
  assert.match(between, /REVENUE_OS_COPY\.ahoraNo/, 'negativo reusa el cierre cortés');
  assert.match(between, /ia360_opener_si_recovery/);
  assert.match(between, /ia360_opener_ahora_no_recovery/);
  assert.match(between, /\n\s*return;\s*\n/, 'el handler debe cortar con return antes del fallback');
});
