// ============================================================================
// qa-template-send.js — envío de template en modo "template_only" (QA harness)
//
// REEMPLAZA al helper obsoleto /tmp/send_ia360_pipeline_test.js, que:
//   1) hardcodeaba rawPayloadExtra.pipeline = "IA360 100M texto" para CUALQUIER
//      template (contaminó metadata de Lite, Revenue OS y Referidos en la
//      corrida 2026-06-10, chat_history 1143/1165/1167), y
//   2) no soportaba headers IMAGE (los visuales ia360_100m_img_* fallaban con
//      #132012 antes de Meta).
//
// REGLA DE ORO: enviar un template NO prueba un pipeline. Este modo existe solo
// para validar render/entrega de templates aislados; los pipelines se prueban
// con sus starters reales vía scripts/qa-pipeline-harness.sh (route_type
// forgechat_monolith_e2e / n8n_brain_v2_staged / new_arch_integrated).
//
// Uso (dentro del contenedor backend, copiado por el harness):
//   TEMPLATE_NAME=ia360_100m_img_01_dolor TO=5219990000911 \
//   PIPELINE="IA360 100M visual" TEST_RUN=qa.123 EXPECTED_HANDLER=router_100m \
//   HEADER_IMAGE_URL=https://wa.geekstudio.dev/ia360-bca/dolor_ceo.jpg \
//   SAMPLE_VALUES='{"1":"QA"}' node /app/qa-template-send.js
// ============================================================================
const pool = require('./src/db');
const { resolveAccount, insertPendingRow } = require('./src/services/messageSender');
const { enqueueSend } = require('./src/queue/sendQueue');

function extractVars(t) { return [...(t || '').matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1]).sort((a, b) => +a - +b); }

(async () => {
  const templateName = process.env.TEMPLATE_NAME || '';
  const templateId = Number(process.env.TEMPLATE_ID || 0);
  const to = String(process.env.TO || '').replace(/\D/g, '');
  const pipeline = String(process.env.PIPELINE || '').trim();
  const testRun = String(process.env.TEST_RUN || '').trim();
  const expectedHandler = String(process.env.EXPECTED_HANDLER || '').trim();
  const headerImageUrl = String(process.env.HEADER_IMAGE_URL || '').trim();
  const sampleValues = JSON.parse(process.env.SAMPLE_VALUES || '{"1":"QA"}');

  // Metadata veraz u honestamente vacía: nunca un default que mienta.
  if (!pipeline) throw new Error('PIPELINE es obligatorio (el helper viejo lo hardcodeaba a "IA360 100M texto"; aquí se declara el real)');
  if (!testRun) throw new Error('TEST_RUN es obligatorio (id de corrida para auditoría)');
  if (!to.startsWith('52199900')) throw new Error(`TO=${to} no es un número QA (52199900*). Este modo nunca egresa a contactos reales.`);

  const { rows } = templateName
    ? await pool.query('SELECT id,name,language,body,header_type,whatsapp_account_id FROM coexistence.message_templates WHERE name=$1 ORDER BY id DESC LIMIT 1', [templateName])
    : await pool.query('SELECT id,name,language,body,header_type,whatsapp_account_id FROM coexistence.message_templates WHERE id=$1', [templateId]);
  if (!rows.length) throw new Error('template no encontrado: ' + (templateName || templateId));
  const tpl = rows[0];

  const { account, error } = await resolveAccount({ accountId: tpl.whatsapp_account_id });
  if (error) throw new Error(error);

  const vars = extractVars(tpl.body);
  const missing = vars.filter(v => !String(sampleValues[v] ?? '').trim());
  if (missing.length) throw new Error('faltan variables ' + missing.join(','));
  const renderedBody = vars.reduce((acc, v) => acc.split('{{' + v + '}}').join(String(sampleValues[v])), tpl.body || '');

  const components = [];
  // Soporte de header IMAGE: el helper viejo no lo tenía y los visuales morían
  // en el validador (#132012). Si el template lo exige y no hay URL, se corta
  // aquí con un error claro en vez de encolar un envío condenado.
  if (String(tpl.header_type || '').toUpperCase() === 'IMAGE') {
    if (!headerImageUrl) throw new Error(`template "${tpl.name}" tiene header IMAGE: pasa HEADER_IMAGE_URL`);
    components.push({ type: 'header', parameters: [{ type: 'image', image: { link: headerImageUrl } }] });
  }
  if (vars.length) components.push({ type: 'body', parameters: vars.map(v => ({ type: 'text', text: String(sampleValues[v]) })) });

  const localId = await insertPendingRow({
    account,
    toNumber: to,
    messageType: 'template',
    messageBody: renderedBody,
    rawPayloadExtra: {
      qa_harness: true,
      test_run: testRun,
      route_type: 'template_only',
      pipeline,
      template: tpl.name,
      expected_handler: expectedHandler || null,
      header_image_url: headerImageUrl || null,
      note: 'template_only NO cuenta como pipeline probado; ver scripts/qa-pipeline-harness.sh',
    },
  });
  await enqueueSend({ kind: 'template', accountId: account.id, to, localMessageId: localId, payload: { name: tpl.name, languageCode: tpl.language || 'es_MX', components } });
  console.log(JSON.stringify({ ok: true, localId, template: tpl.name, header_type: tpl.header_type, to, route_type: 'template_only', test_run: testRun, pipeline }, null, 2));
  setTimeout(() => process.exit(0), 300);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
