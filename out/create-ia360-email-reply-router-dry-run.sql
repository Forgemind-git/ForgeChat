INSERT INTO workflow_entity (
  name, active, nodes, connections, "createdAt", "updatedAt", settings,
  "staticData", "pinData", "versionId", "triggerCount", id, meta,
  "parentFolderId", "isArchived", "versionCounter", description, "activeVersionId", "nodeGroups"
)
VALUES (
  'IA360 Email Reply Router — Dry Run',
  false,
  '[
    {
      "parameters": {"httpMethod": "POST", "path": "ia360-email-reply-router-dry-run", "responseMode": "responseNode", "options": {}},
      "id": "Webhook_IA360_Email_Reply_Dry_Run",
      "name": "Webhook Email Reply Dry Run",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [-620, 0]
    },
    {
      "parameters": {"mode": "runOnceForAllItems", "jsCode": "const input = $input.first().json.body || $input.first().json;\nconst text = String(input.text || input.body_plain || input.body || input.reply_text || '''').toLowerCase();\nconst subject = input.subject || input.name || input.subject_or_type || '''';\nconst eventId = input.event_id || input.email_id || input.id || '''';\nfunction has(patterns) { return patterns.some(p => new RegExp(p, ''i'').test(text)); }\nconst negative = has([''pendej'', ''basta de pruebas'', ''pruebas sueltas'', ''no me sirve'', ''cagadero'', ''deja de'']);\nconst highIntent = has([''ventas'', ''prospecci[oó]n'', ''empresarios'', ''alto nivel'', ''contratar'', ''implementar'', ''aplicar'', ''costo'', ''propuesta'', ''agenda'', ''reuni[oó]n'']);\nconst painTags = [];\nif (has([''ventas'', ''prospecci[oó]n'', ''prospectos'', ''empresarios'', ''alto nivel''])) painTags.push(''ventas_prospeccion_alto_nivel'');\nif (has([''whatsapp'', ''crm'', ''pipeline'', ''embudo''])) painTags.push(''whatsapp_crm_pipeline'');\nif (has([''erp'', ''bi'', ''reportes'', ''datapower'', ''dashboards''])) painTags.push(''erp_bi_operativo'');\nif (has([''agente'', ''agentes'', ''n8n'', ''automatiz'', ''clasific''])) painTags.push(''agentic_workflows'');\nlet decision;\nif (negative) {\n  decision = { event_type: ''negative_feedback'', intent: ''human_review'', temperature: ''high'', forgechat_stage: ''Requiere Alek'', espo_stage: ''Qualification'', should_create_task: true, should_create_or_update_opportunity: false, should_send_auto_reply: false, next_action: ''pause_automation_and_create_human_review_task'' };\n} else if (highIntent) {\n  decision = { event_type: ''reply_high_intent'', intent: ''qualified_interest'', temperature: painTags.length ? ''hot'' : ''warm'', forgechat_stage: ''Requiere Alek'', espo_stage: ''Qualification'', should_create_task: true, should_create_or_update_opportunity: true, should_send_auto_reply: false, next_action: ''create_or_update_opportunity_and_human_followup_task'' };\n} else {\n  decision = { event_type: ''reply_unclassified'', intent: ''unknown'', temperature: ''cold'', forgechat_stage: ''Nutrición'', espo_stage: ''Prospecting'', should_create_task: false, should_create_or_update_opportunity: false, should_send_auto_reply: false, next_action: ''log_note_only_or_nurture'' };\n}\nreturn [{ json: { mode: ''dry_run_no_writes'', source: ''email'', event_id: eventId, subject, text_excerpt: String(input.text || input.body_plain || input.body || '''').replace(/\\s+/g, '' '').slice(0, 220), pain_tags: painTags, decision } }];"},
      "id": "Code_Classify_Email_Reply_Dry_Run",
      "name": "Classify Email Reply Dry Run",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [-300, 0]
    },
    {
      "parameters": {"respondWith": "json", "responseBody": "={{ $json }}", "options": {}},
      "id": "Respond_Dry_Run",
      "name": "Respond Dry Run",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1,
      "position": [20, 0]
    }
  ]'::json,
  '{"Webhook Email Reply Dry Run":{"main":[[{"node":"Classify Email Reply Dry Run","type":"main","index":0}]]},"Classify Email Reply Dry Run":{"main":[[{"node":"Respond Dry Run","type":"main","index":0}]]}}'::json,
  now(), now(), '{}'::json, '{}'::json, '{}'::json,
  'ia360-email-reply-router-dry-run-v1', 0,
  'IA360EmailReplyRouterDryRun20260602',
  '{"templateCredsSetupCompleted":true}'::json,
  NULL, false, 1,
  'Dry-run only. Classifies email replies into IA360 pipeline decisions. No CRM writes, no sends, inactive until explicitly approved.',
  NULL, '[]'::json
)
ON CONFLICT (id) DO UPDATE SET
  name=excluded.name,
  active=false,
  nodes=excluded.nodes,
  connections=excluded.connections,
  "updatedAt"=now(),
  description=excluded.description,
  "nodeGroups"='[]'::json;

select id||'|'||name||'|'||active||'|'||description from workflow_entity where id='IA360EmailReplyRouterDryRun20260602';
