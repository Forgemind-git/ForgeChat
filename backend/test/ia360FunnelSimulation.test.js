const test = require('node:test');
const assert = require('node:assert/strict');
const { getIa360StageForEvent, getIa360StageForReply } = require('../src/services/ia360Mapping');

function espoStage(eventType, targetStage) {
  if (eventType === 'proposal_requested' || targetStage === 'Propuesta / siguiente paso') return 'Proposal';
  if (eventType === 'opt_out') return 'Closed Lost';
  if (eventType === 'nurture_selected') return null;
  if (eventType === 'meeting_confirmed_calendar_zoom') return 'Qualification';
  if (eventType === 'agenda_preference_selected' || eventType === 'call_requested') return 'Qualification';
  if (eventType === 'negative_feedback') return 'Qualification';
  return targetStage ? 'Qualification' : 'Prospecting';
}

function shouldCreateTask(eventType, priority = 'normal') {
  return priority === 'high' || [
    'apply_requested', 'scope_requested', 'proposal_requested', 'call_requested',
    'agenda_preference_selected', 'meeting_confirmed_calendar_zoom',
    'diagnostic_answered', 'negative_feedback'
  ].includes(eventType);
}

const scenarios = [
  {
    name: 'Ruta WhatsApp Revenue OS alta intención hasta reunión',
    steps: [
      ['reply', { replyId: '100m_wa_crm', answer: 'WhatsApp → CRM' }, 'Dolor calificado', 'mechanism_selected', 'Qualification', false],
      ['reply', { replyId: 'wa_flow_map', answer: 'Ver flujo' }, 'Dolor calificado', 'flow_map_requested', 'Qualification', false],
      ['reply', { replyId: 'wa_apply', answer: 'Aplicarlo' }, 'Requiere Alek', 'apply_requested', 'Qualification', true],
      ['reply', { replyId: 'apply_call', answer: 'Llamada' }, 'Agenda en proceso', 'call_requested', 'Qualification', true],
      ['event', 'meeting_confirmed_calendar_zoom', 'Reunión agendada', 'meeting_confirmed_calendar_zoom', 'Qualification', true],
    ]
  },
  {
    name: 'Ruta propuesta directa por costo',
    steps: [
      ['reply', { replyId: 'apply_cost', answer: 'Costo' }, 'Propuesta / siguiente paso', 'proposal_requested', 'Proposal', true],
    ]
  },
  {
    name: 'Ruta nutrición no crea oportunidad ni tarea',
    steps: [
      ['event', 'nurture_selected', 'Nutrición', 'nurture_selected', null, false],
    ]
  },
  {
    name: 'Ruta baja cierra/no contactar',
    steps: [
      ['event', 'opt_out', 'Perdido / no fit', 'opt_out', 'Closed Lost', false],
    ]
  },
  {
    name: 'Feedback negativo requiere Alek y no debe continuar automático',
    steps: [
      ['reply', { answer: 'De que me sirve que me mandes pruebas a lo pendejo. Basta de pruebas pendejas.' }, 'Requiere Alek', 'negative_feedback', 'Qualification', true],
    ]
  }
];

test('IA360 dry-run funnel scenarios route to expected stages/tasks', () => {
  for (const scenario of scenarios) {
    for (const [kind, input, expectedStage, eventType, expectedEspo, expectedTask] of scenario.steps) {
      const stage = kind === 'event' ? getIa360StageForEvent(input) : getIa360StageForReply(input);
      assert.equal(stage, expectedStage, `${scenario.name}: ForgeChat stage`);
      assert.equal(espoStage(eventType, stage), expectedEspo, `${scenario.name}: Espo stage`);
      assert.equal(shouldCreateTask(eventType), expectedTask, `${scenario.name}: task flag`);
    }
  }
});
