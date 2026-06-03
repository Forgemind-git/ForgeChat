const test = require('node:test');
const assert = require('node:assert/strict');

function cleanDigits(v) { return String(v || '').replace(/\D/g, ''); }
function mapEspoStage(eventType, targetStage) {
  if (eventType === 'proposal_requested' || targetStage === 'Propuesta / siguiente paso') return 'Proposal';
  if (eventType === 'opt_out') return 'Closed Lost';
  if (eventType === 'meeting_confirmed_calendar_zoom') return 'Qualification';
  if (eventType === 'agenda_preference_selected' || eventType === 'call_requested') return 'Qualification';
  if (eventType === 'nurture_selected') return null;
  return targetStage ? 'Qualification' : 'Prospecting';
}
function shouldCreateTask(eventType, priority) {
  return priority === 'high' || [
    'apply_requested', 'scope_requested', 'proposal_requested', 'call_requested',
    'agenda_preference_selected', 'meeting_confirmed_calendar_zoom',
    'diagnostic_answered'
  ].includes(eventType);
}

test('Espo stage mapping keeps meeting confirmed in commercial qualification until custom stage exists', () => {
  assert.equal(mapEspoStage('meeting_confirmed_calendar_zoom', 'Reunión agendada'), 'Qualification');
  assert.equal(mapEspoStage('proposal_requested', 'Propuesta / siguiente paso'), 'Proposal');
  assert.equal(mapEspoStage('opt_out', 'Perdido / no fit'), 'Closed Lost');
  assert.equal(mapEspoStage('nurture_selected', 'Nutrición'), null);
});

test('task creation only for high-intent or high-priority events', () => {
  assert.equal(shouldCreateTask('nurture_selected', 'normal'), false);
  assert.equal(shouldCreateTask('mechanism_selected', 'normal'), false);
  assert.equal(shouldCreateTask('call_requested', 'normal'), true);
  assert.equal(shouldCreateTask('mechanism_selected', 'high'), true);
});
