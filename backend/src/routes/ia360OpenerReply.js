// ── G6: ruteo de los botones de los openers (quick-reply de template) ────────
// Los quick-reply de los templates fríos del opener llegan SIN payload estable:
// Meta manda el id = el TÍTULO visible del botón ("Sí, cuéntame" / "Ahora no").
// getInteractiveReplyId ya baja a minúsculas y hace trim, pero conserva acentos
// y puntuación, así que "si, cuentame" (lo que viste en el log) no empata con
// ninguna ruta gateada por estado y el botón muere en [ia360-fallback].
//
// Este módulo es PURO (sin DB, sin red): normaliza el id y lo clasifica como
// afirmativo / negativo / null. Lo usa webhook.js como ÚLTIMO recurso, después
// de que todos los handlers gateados por estado declinaron, para que un opener
// huérfano siempre reciba un siguiente paso coherente en vez del fallback.
//
// TODO(G6+): cuando buildIa360OpenerInteractive emita payload ESTABLE (ids del
// tipo `opener:<seq>:si` en vez del título), este clasificador por texto deja de
// ser necesario para los openers nuevos; mantenerlo solo como red de seguridad
// para los templates frios viejos ya enviados.

// Quita acentos, baja a minúsculas, colapsa espacios y recorta puntuación de los
// bordes. "  Sí, Cuéntame! " -> "si, cuentame".
function normalizeOpenerReplyId(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas diacríticas (acentos, diéresis)
    .toLowerCase()
    .replace(/[¡!¿?.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Lexicón normalizado (sin acentos) de los títulos afirmativos y negativos que
// emiten los openers persona-first y el template Revenue OS. Debe permanecer en
// sintonía con IA360_SEQ_ALIAS_AFFIRMATIVE / IA360_SEQ_ALIAS_NEGATIVE de
// webhook.js (allí se conservan con acentos para el match exacto temprano).
const OPENER_AFFIRMATIVE = new Set([
  'si cuentame', 'si, cuentame',
  'si cuentame mas', 'si, cuentame mas',
  'si preguntame', 'si, preguntame',
  'si mandalo', 'si, mandalo',
  'si compartelo', 'si, compartelo',
  'si a ver', 'si, a ver',
  'si te cuento', 'si, te cuento',
  'si hay un tema', 'si, hay un tema',
  'me interesa', 'si me interesa', 'si, me interesa',
]);
const OPENER_NEGATIVE = new Set([
  'ahora no', 'por ahora no', 'no por ahora',
]);

// Devuelve 'affirmative' | 'negative' | null. null => no es un botón de opener
// reconocible (que siga su curso al fallback genérico).
function classifyOpenerReply(raw) {
  const key = normalizeOpenerReplyId(raw);
  if (!key) return null;
  if (OPENER_NEGATIVE.has(key)) return 'negative';
  if (OPENER_AFFIRMATIVE.has(key)) return 'affirmative';
  return null;
}

// Parse PURO del id de un reply interactivo desde el raw_payload de Meta.
// getInteractiveReplyId() de webhook.js delega aquí para que el test ejercite la
// misma extracción que corre en producción. Baja a minúsculas y hace trim
// (conserva acentos — la normalización fuerte la hace classifyOpenerReply).
function extractInteractiveReplyId(record) {
  try {
    const payload = typeof record.raw_payload === 'string' ? JSON.parse(record.raw_payload) : record.raw_payload;
    const msg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const interactive = msg?.interactive;
    if (interactive) {
      if (interactive.button_reply?.id) return String(interactive.button_reply.id).trim().toLowerCase();
      if (interactive.list_reply?.id) return String(interactive.list_reply.id).trim().toLowerCase();
    }
    if (msg?.button?.payload) return String(msg.button.payload).trim().toLowerCase();
    if (msg?.button?.text) return String(msg.button.text).trim().toLowerCase();
  } catch (_) {
    // ignore malformed/non-JSON payloads; fallback to visible title
  }
  return '';
}

module.exports = {
  normalizeOpenerReplyId,
  classifyOpenerReply,
  extractInteractiveReplyId,
  OPENER_AFFIRMATIVE,
  OPENER_NEGATIVE,
};
