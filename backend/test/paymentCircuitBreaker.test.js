const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyPaymentBlockError,
  isAccountBlockRetryCode,
  evaluatePaymentStatus,
  isPaymentBlocked,
  clearPaymentBlock,
  _resetForTest,
} = require('../src/services/paymentCircuitBreaker');

// Status record tal como lo produce parseMetaPayload para el webhook de status
// del incidente real (chat_history id 2100): "Business eligibility payment issue"
// código 131042. errors[] viene del raw_payload de Meta sin parafrasear.
function failedStatus131042() {
  return {
    message_id: 'wamid.HBgNNTIxMzMyMjYzODAzMxUCABEYFENFMkU5MEIyODNEQ0Y3NjU2MkQyAA==',
    phone_number_id: '873315362541590',
    wa_number: '5213321594582',
    contact_number: '5213322638033',
    direction: 'outgoing',
    message_type: 'status',
    status: 'failed',
    pricing: null,
    errors: [{
      code: 131042,
      href: 'https://business.facebook.com/billing_hub/accounts/details/?business_id=382618582575064&asset_id=1190241942503057&wizard_name=PAY_NOW&account_type=whatsapp-business-account',
      title: 'Business eligibility payment issue',
      message: 'Business eligibility payment issue',
      error_data: { details: 'Message failed to send because your WhatsApp Business account has unsettled payments.' },
    }],
  };
}

// Entrega exitosa de un template (conversación FACTURABLE) → señal de recuperación.
function deliveredBillableStatus() {
  return {
    message_id: 'wamid.RECOVERED',
    phone_number_id: '873315362541590',
    wa_number: '5213321594582',
    contact_number: '5213322638033',
    direction: 'outgoing',
    message_type: 'status',
    status: 'delivered',
    pricing: { billable: true, pricing_model: 'CBP', category: 'business_initiated' },
    errors: null,
  };
}

test('clasificación: 131042 (y familia) es payment_block; 131026 (per-destinatario) NO', () => {
  assert.equal(classifyPaymentBlockError(131042), 'payment_block');
  assert.equal(classifyPaymentBlockError(131045), 'payment_block');
  assert.equal(classifyPaymentBlockError(131031), 'payment_block');
  // 131026 = "Message Undeliverable" (destinatario), NO bloqueo de cuenta:
  // excluido a propósito para no enmudecer una cuenta sana por un solo número malo.
  assert.equal(classifyPaymentBlockError(131026), null);
  assert.equal(classifyPaymentBlockError(0), null);
  assert.equal(classifyPaymentBlockError(undefined), null);
});

test('webhook status 131042: marca el flag + alerta al owner UNA vez + NO spamea al 2do fallo', () => {
  _resetForTest();
  const accountKey = '873315362541590';
  assert.equal(isPaymentBlocked(accountKey), false);

  // 1er fallo 131042 → bloquea, marca flag y DEBE alertar.
  const first = evaluatePaymentStatus(failedStatus131042(), new Date('2026-06-15T15:51:36Z'));
  assert.equal(first.action, 'block');
  assert.equal(first.shouldAlert, true, 'el primer 131042 debe alertar');
  assert.equal(first.code, 131042);
  assert.match(first.href, /billing_hub/);
  assert.equal(first.alertCount, 1);
  assert.equal(isPaymentBlocked(accountKey), true, 'el flag de bloqueo quedó marcado');

  // 2do fallo del MISMO bloqueo, mismo día → NO debe re-alertar (anti-spam).
  const second = evaluatePaymentStatus(failedStatus131042(), new Date('2026-06-15T15:52:10Z'));
  assert.equal(second.action, 'block');
  assert.equal(second.shouldAlert, false, 'el 2do fallo del mismo bloqueo NO debe alertar');
  assert.equal(second.alertCount, 1, 'el contador de alertas no se incrementa');
  assert.equal(isPaymentBlocked(accountKey), true);

  // 3er fallo, MISMO bloqueo pero al DÍA SIGUIENTE → re-aviso diario permitido.
  const nextDay = evaluatePaymentStatus(failedStatus131042(), new Date('2026-06-16T09:00:00Z'));
  assert.equal(nextDay.shouldAlert, true, 'un bloqueo que persiste re-alerta al día siguiente');
  assert.equal(nextDay.alertCount, 2);
});

test('auto-recuperación: entrega facturable exitosa limpia el flag y avisa UNA vez', () => {
  _resetForTest();
  const accountKey = '873315362541590';
  evaluatePaymentStatus(failedStatus131042(), new Date('2026-06-15T15:51:36Z'));
  assert.equal(isPaymentBlocked(accountKey), true);

  const recovered = evaluatePaymentStatus(deliveredBillableStatus(), new Date('2026-06-15T18:00:00Z'));
  assert.equal(recovered.action, 'recover');
  assert.equal(recovered.shouldAlert, true);
  assert.equal(isPaymentBlocked(accountKey), false, 'el flag se limpió tras la entrega facturable');

  // Una 2da entrega facturable, ya sin bloqueo, NO genera otro aviso.
  const again = evaluatePaymentStatus(deliveredBillableStatus(), new Date('2026-06-15T18:05:00Z'));
  assert.equal(again.action, 'none');
  assert.equal(again.shouldAlert, false);
});

test('un mensaje de SESIÓN entregado NO limpia el flag (sólo conversación facturable)', () => {
  _resetForTest();
  const accountKey = '873315362541590';
  evaluatePaymentStatus(failedStatus131042(), new Date('2026-06-15T15:51:36Z'));
  assert.equal(isPaymentBlocked(accountKey), true);

  // delivered de un mensaje de servicio/sesión (sin pricing facturable):
  // durante el bloqueo los de sesión SIGUEN entregando; no deben limpiar el flag.
  const sessionDelivered = { ...deliveredBillableStatus(), pricing: { billable: false, category: 'service' } };
  const r = evaluatePaymentStatus(sessionDelivered, new Date('2026-06-15T16:00:00Z'));
  assert.equal(r.action, 'none');
  assert.equal(isPaymentBlocked(accountKey), true, 'el flag sigue activo: una sesión no es señal de recuperación');
});

test('un status failed SIN código de pago no dispara el breaker', () => {
  _resetForTest();
  const noPay = failedStatus131042();
  noPay.errors = [{ code: 131026, title: 'Message Undeliverable' }];
  const r = evaluatePaymentStatus(noPay, new Date('2026-06-15T15:51:36Z'));
  assert.equal(r.action, 'none');
  assert.equal(r.shouldAlert, false);
  assert.equal(isPaymentBlocked('873315362541590'), false);
});

test('gate #2 sendQueue: códigos de bloqueo de cuenta marcan skipRetry', () => {
  // Fuente única compartida con accountHealth.classifyMetaError: si el código
  // está aquí, classifyMetaError devuelve 'payment_blocked' y sendQueue pone
  // skipRetry (no quema los 4 reintentos). El 131042 síncrono o familia + 368.
  assert.equal(isAccountBlockRetryCode(131042), true);
  assert.equal(isAccountBlockRetryCode(131045), true);
  assert.equal(isAccountBlockRetryCode(131031), true);
  assert.equal(isAccountBlockRetryCode(368), true);
  // 131026 (per-destinatario) y nulos NO deben saltar reintentos.
  assert.equal(isAccountBlockRetryCode(131026), false);
  assert.equal(isAccountBlockRetryCode(190), false);
  assert.equal(isAccountBlockRetryCode(undefined), false);
});

// Limpieza manual idempotente.
test('clearPaymentBlock es idempotente', () => {
  _resetForTest();
  evaluatePaymentStatus(failedStatus131042(), new Date('2026-06-15T15:51:36Z'));
  assert.equal(clearPaymentBlock('873315362541590'), true);
  assert.equal(clearPaymentBlock('873315362541590'), false);
});
