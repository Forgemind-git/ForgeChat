const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('cliente activo beta memory dry-run must fall through to no-silence fallback', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'webhook.js'), 'utf8');
  const dryRunStart = src.indexOf('if (!IA360_MEMORY_EGRESS_ON)');
  const dryRunEnd = src.indexOf("await enqueueIa360Text({ record, label: 'ia360_cliente_activo_beta_memory_reply'", dryRunStart);
  assert.notEqual(dryRunStart, -1, 'dry-run memory branch missing');
  assert.notEqual(dryRunEnd, -1, 'egress-on memory branch missing');
  const dryRunBlock = src.slice(dryRunStart, dryRunEnd);

  assert.match(dryRunBlock, /egress=dry_run -> fallback_required/);
  assert.match(dryRunBlock, /return false;/, 'dry-run memory learning is not a customer response');

  const parentFallback = src.slice(src.indexOf('async function handleIa360FreeText'), src.indexOf('const agent = await callIa360Agent'));
  assert.match(parentFallback, /handleIa360BotFailure/);
  assert.match(parentFallback, /cliente activo\/beta sin contexto suficiente/);
});
