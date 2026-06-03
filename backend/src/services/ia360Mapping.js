function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const EVENT_STAGE = {
  meeting_confirmed_calendar_zoom: 'Reunión agendada',
  agenda_preference_selected: 'Agenda en proceso',
  call_requested: 'Agenda en proceso',
  proposal_requested: 'Propuesta / siguiente paso',
  apply_requested: 'Requiere Alek',
  scope_requested: 'Requiere Alek',
  map_requested: 'Diagnóstico enviado',
  flow_map_requested: 'Dolor calificado',
  example_requested: 'Dolor calificado',
  mechanism_selected: 'Dolor calificado',
  pain_segmented: 'Dolor calificado',
  nurture_selected: 'Nutrición',
  opt_out: 'Perdido / no fit',
  negative_feedback: 'Requiere Alek',
};

const REPLY_STAGE_BY_ID = {
  wa_flow_map: 'Dolor calificado',
  flow_architecture: 'Dolor calificado',
  next_example: 'Dolor calificado',
  '100m_see_example': 'Dolor calificado',
  ex_wa_crm: 'Dolor calificado',
  '100m_wa_crm': 'Dolor calificado',
  ex_erp_bi: 'Dolor calificado',
  '100m_erp_bi': 'Dolor calificado',
  ex_agent_followup: 'Dolor calificado',
  '100m_want_map': 'Diagnóstico enviado',
  next_5q: 'Diagnóstico enviado',
  wa_apply: 'Requiere Alek',
  apply_scope: 'Requiere Alek',
  apply_cost: 'Propuesta / siguiente paso',
  wa_schedule: 'Agenda en proceso',
  '100m_schedule': 'Agenda en proceso',
  next_schedule: 'Agenda en proceso',
  apply_call: 'Agenda en proceso',
};

function getIa360StageForEvent(eventType, fallback = null) {
  return EVENT_STAGE[eventType] || fallback;
}

function getIa360StageForReply({ replyId, answer } = {}, fallback = null) {
  if (replyId && REPLY_STAGE_BY_ID[replyId]) return REPLY_STAGE_BY_ID[replyId];
  const text = normalizeText(answer);
  if (!text) return fallback;
  if (
    text.includes('pendej') ||
    text.includes('basta de pruebas') ||
    text.includes('no me sirve') ||
    text.includes('pruebas sueltas') ||
    text.includes('pruebas a lo') ||
    text.includes('molesto') ||
    text.includes('esto esta mal') ||
    text.includes('no sigas')
  ) return 'Requiere Alek';
  if (text.includes('ver flujo') || text.includes('arquitectura') || text.includes('ver ejemplo') || text.includes('whatsapp') || text.includes('erp') || text.includes('agente')) return 'Dolor calificado';
  if (text.includes('quiero mapa') || text.includes('5 pregunta')) return 'Diagnóstico enviado';
  if (text.includes('aplicarlo') || text.includes('alcance')) return 'Requiere Alek';
  if (text.includes('costo') || text.includes('propuesta')) return 'Propuesta / siguiente paso';
  if (text.includes('agendar') || text.includes('llamada')) return 'Agenda en proceso';
  return fallback;
}

module.exports = {
  getIa360StageForEvent,
  getIa360StageForReply,
};
