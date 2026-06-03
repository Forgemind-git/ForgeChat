const test = require('node:test');
const assert = require('node:assert/strict');

const { getIa360StageForEvent, getIa360StageForReply } = require('../src/services/ia360Mapping');

test('meeting confirmation maps to Reunión agendada, while preferences stay Agenda en proceso', () => {
  assert.equal(getIa360StageForEvent('meeting_confirmed_calendar_zoom'), 'Reunión agendada');
  assert.equal(getIa360StageForEvent('agenda_preference_selected'), 'Agenda en proceso');
  assert.equal(getIa360StageForEvent('call_requested'), 'Agenda en proceso');
});

test('informational clicks do not jump to proposal, but apply/cost do', () => {
  assert.equal(getIa360StageForReply({ replyId: 'wa_flow_map', answer: 'ver flujo' }), 'Dolor calificado');
  assert.equal(getIa360StageForReply({ replyId: 'ex_wa_crm', answer: 'WhatsApp → CRM' }), 'Dolor calificado');
  assert.equal(getIa360StageForReply({ replyId: 'wa_apply', answer: 'aplicarlo' }), 'Requiere Alek');
  assert.equal(getIa360StageForReply({ replyId: 'apply_scope', answer: 'alcance' }), 'Requiere Alek');
  assert.equal(getIa360StageForReply({ replyId: 'apply_cost', answer: 'costo' }), 'Propuesta / siguiente paso');
  assert.equal(getIa360StageForReply({ replyId: 'apply_call', answer: 'llamada' }), 'Agenda en proceso');
});
