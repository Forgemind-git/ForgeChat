// G5 — Circuit breaker de PAGO / elegibilidad de Meta.
//
// PROBLEMA (incidente 2026-06-13): la WABA cayó en "Business eligibility
// payment issue" (código Meta 131042 — pagos sin liquidar). Meta sigue
// ACEPTANDO el envío del template de forma síncrona (HTTP 2xx + wamid), así que
// NO hay excepción en el envío. El bloqueo llega DESPUÉS, como webhook de status
// "failed" con errors[].code=131042. Resultado: los templates murieron 2 días en
// silencio (los mensajes de sesión seguían llegando, lo que enmascaró el fallo).
//
// Este módulo es lógica PURA y testeable: clasifica el código de error, mantiene
// el flag de bloqueo por cuenta (en memoria) y decide cuándo alertar al owner
// con anti-spam (dedup por cuenta+código+día). El envío real del aviso vive en
// webhook.js (sendIa360DirectText); aquí sólo se decide QUÉ hacer.
//
// El estado vive en memoria a propósito: si el container se reinicia, el flag se
// pierde y, ante el próximo status 131042, se vuelve a alertar UNA vez — lo cual
// es deseable (informa de nuevo) y mantiene el módulo hermético/testeable sin DB.

// ── Clasificación de códigos ────────────────────────────────────────────────
// Códigos Meta que indican un bloqueo a NIVEL CUENTA por pago/elegibilidad.
//   131042 — "Business eligibility payment issue" (pagos sin liquidar). CONFIRMADO
//            en el incidente; es el principal y el que se prioriza.
//   131045 — error de elegibilidad/registro a nivel cuenta (misma familia).
//   131031 — la cuenta ha sido bloqueada (account locked) — bloqueo de cuenta.
//
// EXCLUIDO a propósito: 131026 ("Message Undeliverable"). Ese código es
// específico del DESTINATARIO (no está en WhatsApp, no puede recibir, etc.), NO
// un bloqueo de cuenta. Disparar el breaker con 131026 produciría falsos
// positivos que enmudecerían una cuenta sana ante un solo número malo. Por eso
// el circuit breaker NO lo trata como bloqueo de pago/elegibilidad.
const PAYMENT_BLOCK_CODES = new Set([131042, 131045, 131031]);

// Set usado por sendQueue (vía accountHealth.classifyMetaError) para SALTAR los
// reintentos: además de los de pago/elegibilidad incluye 368 (bloqueo temporal
// por violación de políticas). Si Meta YA dijo bloqueo de cuenta de forma
// síncrona, reintentar quema los 4 intentos en vano. Fuente única para que el
// breaker (webhook) y el skipRetry (envío) no se desincronicen.
const ACCOUNT_BLOCK_RETRY_CODES = new Set([131042, 131045, 131031, 368]);

// Categorías de pricing que indican una conversación FACTURABLE / iniciada por
// el negocio (template). La auto-recuperación sólo confía en la entrega exitosa
// de una de ÉSTAS — nunca en un mensaje de sesión/servicio, porque los de sesión
// siguen entregando DURANTE el bloqueo (eso fue justo lo que enmascaró el
// incidente) y limpiarían el flag de inmediato, anulando el breaker.
const BILLABLE_CATEGORIES = new Set([
  'business_initiated', 'marketing', 'utility', 'authentication',
]);

/**
 * @param {number|string} code código de error de Meta
 * @returns {'payment_block'|null}
 */
function classifyPaymentBlockError(code) {
  if (code == null) return null;
  const n = parseInt(code, 10);
  if (Number.isNaN(n)) return null;
  return PAYMENT_BLOCK_CODES.has(n) ? 'payment_block' : null;
}

/** ¿El código justifica skipRetry en sendQueue (bloqueo de cuenta)? */
function isAccountBlockRetryCode(code) {
  if (code == null) return false;
  const n = parseInt(code, 10);
  return !Number.isNaN(n) && ACCOUNT_BLOCK_RETRY_CODES.has(n);
}

// ── Estado en memoria ───────────────────────────────────────────────────────
// Map<accountKey, { code, href, title, message, since, lastAlertDay, alertCount }>
const _blocked = new Map();

function _dayKey(now) {
  // YYYY-MM-DD en UTC (estable para el dedup diario, independiente de la zona).
  return now.toISOString().slice(0, 10);
}

function _isBillableStatus(record) {
  const p = record && record.pricing;
  if (!p) return false;
  if (p.billable === true) return true;
  return BILLABLE_CATEGORIES.has(p.category);
}

/**
 * Evalúa un record de status del webhook y decide la acción del breaker.
 * PURA respecto al envío (no envía nada): sólo muta el estado interno y devuelve
 * la decisión para que el caller (webhook.js) alerte al owner si corresponde.
 *
 * @param {object} record  record de status (message_type==='status') con
 *                         { status, errors[], pricing, phone_number_id, wa_number }
 * @param {Date}  [now]    inyectable para test; default new Date()
 * @returns {{
 *   action: 'block'|'recover'|'none',
 *   accountKey: string,
 *   shouldAlert: boolean,
 *   code?: number, href?: string, title?: string, message?: string,
 *   alertCount?: number,
 * }}
 */
function evaluatePaymentStatus(record, now = new Date()) {
  const accountKey = String(
    (record && (record.phone_number_id || record.wa_number)) || 'default'
  );

  // Auto-recuperación: una entrega FACTURABLE exitosa (template entregado/leído)
  // significa que Meta volvió a aceptar conversaciones de pago → limpiar flag.
  if ((record.status === 'delivered' || record.status === 'read') && _isBillableStatus(record)) {
    const wasBlocked = _blocked.delete(accountKey);
    return { action: wasBlocked ? 'recover' : 'none', accountKey, shouldAlert: wasBlocked };
  }

  if (record.status !== 'failed') return { action: 'none', accountKey, shouldAlert: false };

  const errs = Array.isArray(record.errors) ? record.errors : [];
  const payErr = errs.find(e => classifyPaymentBlockError(e && e.code));
  if (!payErr) return { action: 'none', accountKey, shouldAlert: false };

  const code = parseInt(payErr.code, 10);
  const href = payErr.href || (payErr.error_data && payErr.error_data.href) || null;
  const title = payErr.title || payErr.message || 'Business eligibility payment issue';
  const message = (payErr.error_data && payErr.error_data.details) || payErr.message || title;
  const today = _dayKey(now);

  const prev = _blocked.get(accountKey);
  // Anti-spam: alertar SOLO si es un bloqueo nuevo, o si cambió el código, o si
  // ya pasó a otro día (re-aviso diario de un bloqueo que persiste). Cada fallo
  // adicional del MISMO bloqueo en el MISMO día NO re-alerta.
  const shouldAlert = !prev || prev.code !== code || prev.lastAlertDay !== today;
  const alertCount = (prev && prev.alertCount ? prev.alertCount : 0) + (shouldAlert ? 1 : 0);

  _blocked.set(accountKey, {
    code, href, title, message,
    since: prev && prev.since ? prev.since : now.toISOString(),
    lastAlertDay: shouldAlert ? today : (prev ? prev.lastAlertDay : today),
    alertCount,
  });

  return { action: 'block', accountKey, shouldAlert, code, href, title, message, alertCount };
}

/** ¿La cuenta está marcada como bloqueada por pago/elegibilidad? */
function isPaymentBlocked(accountKey) {
  return _blocked.has(String(accountKey));
}

// ── GATE #4 (NO ACTIVADO a propósito): pausar el envío de TEMPLATES ─────────
// isPaymentBlocked() existe para que, en el futuro, sendQueue pueda RECHAZAR
// templates mientras el flag esté activo (los mensajes de sesión deben seguir).
// NO se cablea hoy por DOS riesgos concretos:
//
//  1) DEADLOCK de auto-recuperación: el flag SÓLO se limpia cuando llega un
//     status 'delivered/read' de una conversación FACTURABLE (un template). Si
//     pausamos TODOS los templates, ninguno se envía, ninguno se entrega, y el
//     flag jamás se limpia solo → la cuenta queda muda para templates incluso
//     después de que el owner pague. La recuperación depende de dejar pasar al
//     menos un template para "sondear".
//  2) FALSO POSITIVO: el flag es en memoria y por phone_number_id; un único
//     131042 espurio dejaría sin templates a una cuenta sana hasta el reinicio.
//
// El valor del breaker (alerta instantánea + skipRetry para no quemar reintentos)
// ya se entrega sin este gate. Si se activa más adelante, hace falta: (a) excluir
// del gate un "template sonda" periódico, o (b) un TTL/limpieza manual del flag,
// para no caer en el deadlock anterior.

/** ¿Debe pausarse el envío de templates? (Gate #4 — hoy SIEMPRE false: ver arriba.) */
function shouldPauseTemplates(/* accountKey */) {
  return false; // TODO(gate#4): activar sólo con template-sonda o TTL (evita deadlock).
}

/** Estado del bloqueo (o null) — útil para diagnóstico/UI. */
function getPaymentBlock(accountKey) {
  return _blocked.get(String(accountKey)) || null;
}

/** Limpia el flag manualmente (recuperación forzada). @returns {boolean} estaba bloqueado */
function clearPaymentBlock(accountKey) {
  return _blocked.delete(String(accountKey));
}

/** Sólo para tests: reinicia todo el estado en memoria. */
function _resetForTest() {
  _blocked.clear();
}

module.exports = {
  classifyPaymentBlockError,
  isAccountBlockRetryCode,
  evaluatePaymentStatus,
  isPaymentBlocked,
  shouldPauseTemplates,
  getPaymentBlock,
  clearPaymentBlock,
  PAYMENT_BLOCK_CODES,
  ACCOUNT_BLOCK_RETRY_CODES,
  _resetForTest,
};
