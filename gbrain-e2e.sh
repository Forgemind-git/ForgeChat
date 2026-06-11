#!/usr/bin/env bash
# ============================================================================
# E2E G-BRAIN — el agente conversa con memoria, cierre y contexto (2026-06-11)
#   SIM 1 — Contexto inyectado: contacto QA con facts precargados → el reply
#           del agente refleja los facts (memory-lookup vía roleHint).
#   SIM 2 — Corrección del contacto → persistida en ia360_conv_state.corrections
#           y respetada en el turno siguiente.
#   SIM 3 — Señal de compra ("no tenemos...") → el reply propone siguiente
#           paso, el estado acumula turnos/preguntas.
#   SIM 4 — Modo por etapa: deal movido a "Dolor calificado" → el reply propone
#           (no excava) y el estado registra el presupuesto de preguntas.
#   SIM 5 — DEDUPE anti-doble-ruta: dos inbound casi simultáneos → UNA sola
#           respuesta del agente (la otra queda 'superseded' en logs).
#   SIM 6 — Sandbox QA: todo el egress de este sim quedó sin salida real
#           (wamid.qa-sandbox.* en la cola; 0 tarjetas e2e con egress al owner).
# Uso: bash gbrain-e2e.sh   (correr en el VPS). Solo números QA.
# ============================================================================
set -uo pipefail

WA="5213321594582"
OWNER="5213322638033"
PID_NUM="873315362541590"
DB="forgecrm-db"
BE="forgecrm-backend"
ENVF="/home/alek/stack/forgechat-poc/backend/.env"
QA="5219990000951"   # QA G-BRAIN conversacional (no-beta, deal en pipeline IA360)

APP_SECRET="$(grep -E '^META_APP_SECRET=' "$ENVF" | head -1 | cut -d= -f2-)"
PORT="$(docker exec "$BE" printenv PORT 2>/dev/null)"; PORT="${PORT:-3011}"
BASE="http://localhost:${PORT}/api"

PASS=0; FAIL=0
ok(){ echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FAIL] $1  (esperado='$3' obtuvo='$2')"; FAIL=$((FAIL+1)); }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }
chk_nonempty(){ if [ -n "$2" ]; then ok "$1"; else bad "$1" "(vacío)" "no-vacío"; fi; }
chk_match(){ if echo "$2" | grep -qiE "$3"; then ok "$1"; else bad "$1" "$(echo "$2" | head -c 160)" "matchea:$3"; fi; }

psql_q(){ docker exec "$DB" psql -U postgres -d postgres -tAc "$1"; }

NODE_POST='let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const h={"content-type":"application/json"};if(process.env.SIG)h["x-hub-signature-256"]=process.env.SIG;const r=await fetch(process.env.URL,{method:"POST",headers:h,body:d});const t=await r.text();process.stdout.write(String(r.status));}catch(e){process.stdout.write("ERR "+e.message);}});'

post_webhook(){
  local body="$1"
  local sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$APP_SECRET" -r | cut -d' ' -f1)"
  printf '%s' "$body" | docker exec -i -e SIG="$sig" -e URL="$BASE/webhook/whatsapp" "$BE" node -e "$NODE_POST"
}

ts(){ date +%s; }

text_payload(){ # $1=from $2=wamid $3=texto
  printf '{"object":"whatsapp_business_account","entry":[{"id":"WABA","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"%s","phone_number_id":"%s"},"contacts":[{"wa_id":"%s","profile":{"name":"QA Brain Conv"}}],"messages":[{"from":"%s","id":"%s","timestamp":"%s","type":"text","text":{"body":"%s"}}]}}]}]}' \
    "$WA" "$PID_NUM" "$1" "$1" "$2" "$(ts)" "$3"
}

wait_reply_after(){ # $1=min_id $2=timeout_s → message_body del primer ia360_ai_reply con id > min_id
  local deadline=$(( $(date +%s) + ${2:-60} )); local body=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    body=$(psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA' AND template_meta->>'label' IN ('ia360_ai_reply','ia360_ai_holding') AND id > $1 ORDER BY id ASC LIMIT 1")
    [ -n "$body" ] && { printf '%s' "$body"; return 0; }
    sleep 4
  done
  printf '%s' ""
}

max_id(){ psql_q "SELECT COALESCE(MAX(id),0) FROM coexistence.chat_history"; }

send_and_wait(){ # $1=texto → imprime reply (y lo registra en el hilo)
  local MID; MID=$(max_id)
  local W="wamid.e2e.gbrain.$(ts).$RANDOM"
  post_webhook "$(text_payload "$QA" "$W" "$1")" >/dev/null
  wait_reply_after "$MID" 60
}

echo "=== STEP 0 — preparar contacto QA conversacional ($QA) con deal + facts ==="
psql_q "DELETE FROM coexistence.deals WHERE contact_number='$QA'" >/dev/null
psql_q "DELETE FROM coexistence.chat_history WHERE contact_number='$QA'" >/dev/null
psql_q "DELETE FROM coexistence.ia360_memory_facts WHERE contact_number='$QA'" >/dev/null
psql_q "DELETE FROM coexistence.ia360_memory_events WHERE contact_number='$QA'" >/dev/null
psql_q "DELETE FROM coexistence.contacts WHERE contact_number='$QA'" >/dev/null
psql_q "INSERT INTO coexistence.contacts (wa_number, contact_number, name, tags, custom_fields)
  VALUES ('$WA', '$QA', 'QA Brain Conv', '[\"staged\"]'::jsonb, '{\"staged\": true}'::jsonb)" >/dev/null
PIPE_ID=$(psql_q "SELECT id FROM coexistence.pipelines WHERE name='IA360 WhatsApp Revenue Pipeline' LIMIT 1")
STAGE_ID=$(psql_q "SELECT id FROM coexistence.pipeline_stages WHERE pipeline_id=$PIPE_ID AND name='Intención detectada' LIMIT 1")
psql_q "INSERT INTO coexistence.deals (pipeline_id, stage_id, contact_wa_number, contact_number, title, status)
  VALUES ($PIPE_ID, $STAGE_ID, '$WA', '$QA', 'IA360 · QA Brain Conv (G-BRAIN E2E)', 'open')" >/dev/null
psql_q "INSERT INTO coexistence.ia360_memory_facts (fact_key, contact_wa_number, contact_number, project_name, persona, role, recurring_pain, affected_process, confidence, status, last_seen_at)
  VALUES ('gbrain-e2e-fact-taller-$QA', '$WA', '$QA', 'QA Brain Conv Empresa', 'operaciones', 'Gerente de operaciones', 'distribuidora de refacciones con taller: unidades detenidas días sin responsable claro', 'taller -> diagnóstico -> refacción -> entrega', 0.9, 'confirmado', NOW())" >/dev/null
chk "deal QA en Intención detectada" "$(psql_q "SELECT count(*) FROM coexistence.deals WHERE contact_number='$QA' AND status='open'")" "1"
chk "fact precargado" "$(psql_q "SELECT count(*) FROM coexistence.ia360_memory_facts WHERE contact_number='$QA'")" "1"

echo ""
echo "=== SIM 1 — contexto inyectado: el reply refleja los facts precargados ==="
R1=$(send_and_wait "Hola, Alek me dijo que me podías ayudar a ordenar la operación. ¿Por dónde empezamos?")
chk_nonempty "SIM1 reply del agente" "$R1"
echo "  [HILO] contacto: Hola, Alek me dijo que me podías ayudar a ordenar la operación. ¿Por dónde empezamos?"
echo "  [HILO] agente:   $R1"
chk_match "SIM1 reply usa los facts (taller/unidades/refacciones)" "$R1" "taller|unidad|refacci|detenid"

echo ""
echo "=== SIM 2 — corrección del contacto: registrada y respetada ==="
R2=$(send_and_wait "No, en realidad el taller ya lo resolvimos. El problema sí es la cobranza: nadie da seguimiento a los pagos.")
chk_nonempty "SIM2 reply tras corrección" "$R2"
echo "  [HILO] contacto: No, en realidad el taller ya lo resolvimos. El problema sí es la cobranza: nadie da seguimiento a los pagos."
echo "  [HILO] agente:   $R2"
CORR=$(psql_q "SELECT custom_fields->'ia360_conv_state'->'corrections'->>0 FROM coexistence.contacts WHERE contact_number='$QA'")
chk_nonempty "SIM2 corrección persistida en ia360_conv_state" "$CORR"
chk_match "SIM2 reply gira a cobranza" "$R2" "cobranza|pago|cartera|seguimiento"

echo ""
echo "=== SIM 3 — señal de compra: propone siguiente paso, no otra pregunta ==="
R3=$(send_and_wait "Es que no tenemos estrategias de seguimiento de cobranza, ¿cómo le hacemos?")
chk_nonempty "SIM3 reply ante señal de compra" "$R3"
echo "  [HILO] contacto: Es que no tenemos estrategias de seguimiento de cobranza, ¿cómo le hacemos?"
echo "  [HILO] agente:   $R3"
chk_match "SIM3 reply propone (paso/llamada/plan/mapa)" "$R3" "propon|llamada|plan|mapa|paso|empez|Alek"
TURNS=$(psql_q "SELECT custom_fields->'ia360_conv_state'->>'turns' FROM coexistence.contacts WHERE contact_number='$QA'")
chk_nonempty "SIM3 estado acumula turnos (turns=$TURNS)" "$TURNS"

echo ""
echo "=== SIM 4 — modo por etapa: deal en Dolor calificado → PROPONER ==="
STAGE_DC=$(psql_q "SELECT id FROM coexistence.pipeline_stages WHERE pipeline_id=$PIPE_ID AND name='Dolor calificado' LIMIT 1")
psql_q "UPDATE coexistence.deals SET stage_id=$STAGE_DC WHERE contact_number='$QA'" >/dev/null
R4=$(send_and_wait "Sí, eso nos pega cada mes con la cartera vencida.")
chk_nonempty "SIM4 reply en modo proponer" "$R4"
echo "  [HILO] contacto: Sí, eso nos pega cada mes con la cartera vencida."
echo "  [HILO] agente:   $R4"
chk_match "SIM4 reply propone acciones (no excava)" "$R4" "propon|llamada|plan|mapa|resum|opci|paso|empez|asignar|separar|alerta|armar[ií]a|cosas:"
ST_JSON=$(psql_q "SELECT custom_fields->'ia360_conv_state' FROM coexistence.contacts WHERE contact_number='$QA'")
echo "  [ESTADO] ia360_conv_state: $(echo "$ST_JSON" | head -c 400)"
chk_match "SIM4 estado guarda preguntas hechas" "$ST_JSON" "questions_asked"

echo ""
echo "=== SIM 5 — DEDUPE: dos inbound casi simultáneos → UNA respuesta ==="
MID5=$(max_id)
W5A="wamid.e2e.gbrain.dup.$(ts).a$RANDOM"
W5B="wamid.e2e.gbrain.dup.$(ts).b$RANDOM"
post_webhook "$(text_payload "$QA" "$W5A" "Una duda: ¿esto se integra con lo que ya usamos?")" >/dev/null &
sleep 1
post_webhook "$(text_payload "$QA" "$W5B" "¿Y cuánto tardaría en quedar andando?")" >/dev/null
wait
echo "  esperando a que el agente procese ambos (45 s)..."
sleep 45
N5=$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA' AND template_meta->>'label' IN ('ia360_ai_reply','ia360_ai_holding') AND id > $MID5")
chk "SIM5 exactamente UNA respuesta del agente" "$N5" "1"
SUPLOG=$(docker logs "$BE" --since 3m 2>&1 | grep -c 'ia360-dedupe. reply del agente DESCARTADO' || true)
echo "  [INFO] descartes anti-doble-ruta en logs (3 min): $SUPLOG"

echo ""
echo "=== SIM 6 — sandbox QA: cero egress real en todo el sim ==="
QASENT=$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA' AND status='sent' AND message_id NOT LIKE 'wamid.qa-sandbox.%'")
chk "SIM6 todo egress al QA quedó en sandbox (0 wamid reales)" "$QASENT" "0"
OWNER_E2E=$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'ia360_handler_for' LIKE 'wamid.e2e.gbrain%' AND status NOT IN ('qa_sandboxed')")
chk "SIM6 cero tarjetas e2e con egress real al owner" "$OWNER_E2E" "0"

echo ""
echo "=== HILO COMPLETO DEL SIM (chat_history) ==="
psql_q "SELECT id || ' | ' || direction || ' | ' || COALESCE(status,'-') || ' | ' || LEFT(regexp_replace(message_body, E'[\\n\\r]+', ' ', 'g'), 150) FROM coexistence.chat_history WHERE contact_number='$QA' ORDER BY id"

echo ""
echo "=== RESULTADO G-BRAIN: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && exit 0 || exit 1
