#!/usr/bin/env bash
# ============================================================================
# E2E G-LIVE — no-silencio producción contactos activos/beta (2026-06-11)
#   SIM 1 — Respuesta real: QA beta pregunta sustantiva → reply del agente IA
#           (label ia360_cliente_activo_beta_agent_reply) en chat_history.
#   SIM 2 — Agente caído ([qa-force-agent-down]) → holding al contacto + alerta
#           al owner + fila en ia360_bot_failures.
#   SIM 3 — Guard inyector: wamid e2e.* hacia un número real no-QA → bloqueado
#           completo (0 filas, 0 egress, blocked_synthetic en la respuesta).
#   SIM 4 — Invariante de clase (watchdog): audio de QA beta sin handler → a los
#           75 s holding + failure 'invariante no-silencio'.
# Uso: bash glive-e2e.sh   (correr en el VPS). Solo números QA + owner.
# ============================================================================
set -uo pipefail

WA="5213321594582"
OWNER="5213322638033"
PID_NUM="873315362541590"
DB="forgecrm-db"
BE="forgecrm-backend"
ENVF="/home/alek/stack/forgechat-poc/backend/.env"
QA="5219990000950"            # QA cliente activo/beta (creado en STEP 0)
FAKE_REAL="5213399999999"     # número NO-QA inventado: el guard lo descarta antes de todo

APP_SECRET="$(grep -E '^META_APP_SECRET=' "$ENVF" | head -1 | cut -d= -f2-)"
PORT="$(docker exec "$BE" printenv PORT 2>/dev/null)"; PORT="${PORT:-3011}"
BASE="http://localhost:${PORT}/api"

PASS=0; FAIL=0
ok(){ echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FAIL] $1  (esperado='$3' obtuvo='$2')"; FAIL=$((FAIL+1)); }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }
chk_has(){ if echo "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "$2" "contiene:$3"; fi; }
chk_nonempty(){ if [ -n "$2" ]; then ok "$1"; else bad "$1" "(vacío)" "no-vacío"; fi; }

psql_q(){ docker exec "$DB" psql -U postgres -d postgres -tAc "$1"; }

NODE_POST='let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const h={"content-type":"application/json"};if(process.env.SIG)h["x-hub-signature-256"]=process.env.SIG;const r=await fetch(process.env.URL,{method:"POST",headers:h,body:d});const t=await r.text();process.stdout.write(String(r.status)+" "+t);}catch(e){process.stdout.write("ERR "+e.message);}});'

post_webhook(){
  local body="$1"
  local sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$APP_SECRET" -r | cut -d' ' -f1)"
  printf '%s' "$body" | docker exec -i -e SIG="$sig" -e URL="$BASE/webhook/whatsapp" "$BE" node -e "$NODE_POST"
}

ts(){ date +%s; }

text_payload(){ # $1=from $2=wamid $3=texto $4=nombre
  printf '{"object":"whatsapp_business_account","entry":[{"id":"WABA","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"%s","phone_number_id":"%s"},"contacts":[{"wa_id":"%s","profile":{"name":"%s"}}],"messages":[{"from":"%s","id":"%s","timestamp":"%s","type":"text","text":{"body":"%s"}}]}}]}]}' \
    "$WA" "$PID_NUM" "$1" "$4" "$1" "$2" "$(ts)" "$3"
}

audio_payload(){ # $1=from $2=wamid
  printf '{"object":"whatsapp_business_account","entry":[{"id":"WABA","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"%s","phone_number_id":"%s"},"contacts":[{"wa_id":"%s","profile":{"name":"QA Cliente Activo Beta"}}],"messages":[{"from":"%s","id":"%s","timestamp":"%s","type":"audio","audio":{"id":"fake-media-glive","mime_type":"audio/ogg; codecs=opus","voice":true}}]}}]}]}' \
    "$WA" "$PID_NUM" "$1" "$1" "$2" "$(ts)"
}

wait_out_label(){ # $1=contacto $2=label $3=timeout_s → message_body
  local deadline=$(( $(date +%s) + ${3:-90} )); local body=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    body=$(psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$1' AND template_meta->>'label'='$2' ORDER BY id DESC LIMIT 1")
    [ -n "$body" ] && { printf '%s' "$body"; return 0; }
    sleep 5
  done
  printf '%s' ""
}

echo "=== STEP 0 — preparar contacto QA cliente activo/beta ($QA) ==="
psql_q "INSERT INTO coexistence.contacts (wa_number, contact_number, name, tags, custom_fields)
  VALUES ('$WA', '$QA', 'QA Cliente Activo Beta',
    '[\"cliente-activo-beta\",\"staged\"]'::jsonb,
    '{\"staged\": true, \"ia360_cliente_activo_beta\": {\"schema\": \"cliente_activo_beta.v1\", \"contact_role\": \"Director de Finanzas (QA)\", \"project\": \"Camiones Selectos QA\", \"do_not_pitch\": true}}'::jsonb)
  ON CONFLICT (wa_number, contact_number) DO UPDATE SET
    name = EXCLUDED.name,
    tags = EXCLUDED.tags,
    custom_fields = coexistence.contacts.custom_fields || EXCLUDED.custom_fields" >/dev/null
chk "contacto QA beta existe" "$(psql_q "SELECT count(*) FROM coexistence.contacts WHERE contact_number='$QA' AND tags ? 'cliente-activo-beta'")" "1"
# Limpieza de corridas previas (solo el QA glive)
psql_q "DELETE FROM coexistence.chat_history WHERE contact_number='$QA'" >/dev/null
psql_q "DELETE FROM coexistence.ia360_bot_failures WHERE contact_number='$QA'" >/dev/null

echo "=== SIM 1 — pregunta sustantiva → respuesta REAL del agente ==="
W1="wamid.e2e.glive.real.$(ts).$RANDOM"
Q1="Oye, antes de subir nuestra información de clientes, ¿qué control tenemos sobre quién puede ver esos datos y qué riesgo hay si algo sale mal?"
ST=$(post_webhook "$(text_payload "$QA" "$W1" "$Q1" "QA Cliente Activo Beta")")
chk_has "SIM1 webhook 200" "$ST" "200"
R1=$(wait_out_label "$QA" "ia360_cliente_activo_beta_agent_reply" 90)
chk_nonempty "SIM1 reply real del agente en chat_history" "$R1"
echo "  reply: $(echo "$R1" | head -c 220)"
ROW1=$(psql_q "SELECT id||' | '||direction||' | '||status||' | '||LEFT(message_body,120) FROM coexistence.chat_history WHERE contact_number='$QA' AND template_meta->>'label'='ia360_cliente_activo_beta_agent_reply' ORDER BY id DESC LIMIT 1")
echo "  fila: $ROW1"

echo "=== SIM 2 — agente caído → holding + alerta + failure ==="
W2="wamid.e2e.glive.down.$(ts).$RANDOM"
Q2="[qa-force-agent-down] Necesito saber si nuestros datos del proyecto quedaron respaldados esta semana."
ST=$(post_webhook "$(text_payload "$QA" "$W2" "$Q2" "QA Cliente Activo Beta")")
chk_has "SIM2 webhook 200" "$ST" "200"
H2=$(wait_out_label "$QA" "ia360_fallback_no_silence" 60)
chk_nonempty "SIM2 holding al contacto" "$H2"
F2=$(psql_q "SELECT id||' | '||status||' | '||reason FROM coexistence.ia360_bot_failures WHERE contact_number='$QA' AND reason LIKE 'cliente activo/beta: agente IA%' ORDER BY id DESC LIMIT 1")
chk_nonempty "SIM2 failure registrado" "$F2"
echo "  failure: $F2"
A2=$(psql_q "SELECT LEFT(message_body,100) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'label'='owner_bot_failure' AND message_body LIKE '%$QA%' ORDER BY id DESC LIMIT 1")
chk_nonempty "SIM2 alerta al owner" "$A2"

echo "=== SIM 3 — guard del inyector: sintético a número real → bloqueado ==="
W3="wamid.e2e.glive.guard.$(ts).$RANDOM"
ST3=$(post_webhook "$(text_payload "$FAKE_REAL" "$W3" "Hola, me interesa" "Contacto Real Falso")")
chk_has "SIM3 webhook responde blocked_synthetic" "$ST3" "blocked_synthetic"
chk "SIM3 cero filas chat_history del número real" "$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE contact_number='$FAKE_REAL'")" "0"
chk "SIM3 cero egress al número real" "$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND (contact_number='$FAKE_REAL' OR to_number='$FAKE_REAL')")" "0"

echo "=== SIM 4 — invariante de clase: audio sin handler → watchdog a los 75 s ==="
W4="wamid.e2e.glive.audio.$(ts).$RANDOM"
ST=$(post_webhook "$(audio_payload "$QA" "$W4")")
chk_has "SIM4 webhook 200" "$ST" "200"
echo "  esperando ventana del watchdog (90 s)..."
sleep 90
F4=$(psql_q "SELECT id||' | '||status||' | '||LEFT(reason,90) FROM coexistence.ia360_bot_failures WHERE contact_number='$QA' AND reason LIKE 'invariante no-silencio%' ORDER BY id DESC LIMIT 1")
chk_nonempty "SIM4 watchdog disparó failure" "$F4"
echo "  failure: $F4"
H4=$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA' AND template_meta->>'label'='ia360_fallback_no_silence'")
if [ "$H4" -ge 2 ]; then ok "SIM4 holding del watchdog al contacto (total fallbacks=$H4)"; else bad "SIM4 holding del watchdog" "$H4" ">=2"; fi

echo ""
echo "=== RESULTADO: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" -eq 0 ] && echo "G-LIVE E2E: TODO VERDE" || echo "G-LIVE E2E: HAY FALLAS"
exit $FAIL
