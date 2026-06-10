#!/usr/bin/env bash
# ============================================================================
# E2E — APPROVE-SEND ("último metro" P0): vCard → persona → secuencia → readout
# → tarjeta de aprobación → Aprobar y enviar.
# Fase A (default): gate cerrado (allowlist vacía) → demuestra que NO envía.
# Fase B (TESTNUM en allowlist): envía el opener al contacto de prueba.
# Uso: bash approve-send-e2e.sh <numero_contacto_prueba> [positivo]
# ============================================================================
set -uo pipefail

TESTNUM="${1:?numero de contacto de prueba requerido}"
MODE="${2:-negativo}"

WA="5213321594582"
OWNER="5213322638033"
PID_NUM="873315362541590"
DB="forgecrm-db"
BE="forgecrm-backend"
ENVF="/home/alek/stack/forgechat-poc/backend/.env"

APP_SECRET="$(grep -E '^META_APP_SECRET=' "$ENVF" | head -1 | cut -d= -f2-)"
PORT="$(docker exec "$BE" printenv PORT 2>/dev/null)"; PORT="${PORT:-3011}"
BASE="http://localhost:${PORT}/api"

PASS=0; FAIL=0
ok(){ echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FAIL] $1  (esperado='$3' obtuvo='$2')"; FAIL=$((FAIL+1)); }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }
chk_has(){ if echo "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "$2" "contiene:$3"; fi; }

psql_q(){ docker exec "$DB" psql -U postgres -d postgres -tAc "$1"; }

NODE_POST='let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const h={"content-type":"application/json"};if(process.env.SIG)h["x-hub-signature-256"]=process.env.SIG;const r=await fetch(process.env.URL,{method:"POST",headers:h,body:d});const t=await r.text();process.stdout.write(String(r.status));}catch(e){process.stdout.write("ERR "+e.message);}});'

post_webhook(){
  local body="$1"
  local sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$APP_SECRET" -r | cut -d' ' -f1)"
  printf '%s' "$body" | docker exec -i -e SIG="$sig" -e URL="$BASE/webhook/whatsapp" "$BE" node -e "$NODE_POST"
}

ts(){ date +%s; }
WAMID_BASE="wamid.e2e.approvesend.$(ts)"

owner_msg_id_by_label(){ # $1=label → message_id de la última saliente al owner con ese label
  psql_q "SELECT message_id FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'label'='$1' ORDER BY id DESC LIMIT 1"
}
owner_body_by_label(){
  psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'label'='$1' ORDER BY id DESC LIMIT 1"
}

inject_interactive(){ # $1=reply_id $2=context_msg_id $3=title
  local body
  body=$(cat <<EOF
{"object":"whatsapp_business_account","entry":[{"id":"e2e","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"$WA","phone_number_id":"$PID_NUM"},"contacts":[{"profile":{"name":"Alek"},"wa_id":"$OWNER"}],"messages":[{"from":"$OWNER","id":"$WAMID_BASE.$RANDOM","timestamp":"$(ts)","type":"interactive","context":{"id":"$2"},"interactive":{"type":"list_reply","list_reply":{"id":"$1","title":"$3"}}}]},"field":"messages"}]}]}
EOF
)
  post_webhook "$body"
}

echo "=== STEP 0 — limpieza estado del contacto de prueba $TESTNUM ==="
psql_q "DELETE FROM coexistence.deals WHERE contact_number='$TESTNUM'" >/dev/null
psql_q "DELETE FROM coexistence.chat_history WHERE contact_number='$TESTNUM'" >/dev/null
psql_q "DELETE FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$TESTNUM'" >/dev/null
ok "estado limpio"

echo "=== STEP 1 — owner comparte vCard del contacto de prueba ==="
VCARD_BODY="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"e2e\",\"changes\":[{\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"$WA\",\"phone_number_id\":\"$PID_NUM\"},\"contacts\":[{\"profile\":{\"name\":\"Alek\"},\"wa_id\":\"$OWNER\"}],\"messages\":[{\"from\":\"$OWNER\",\"id\":\"$WAMID_BASE.vcard\",\"timestamp\":\"$(ts)\",\"type\":\"contacts\",\"contacts\":[{\"name\":{\"formatted_name\":\"Contacto Prueba ApproveSend\",\"first_name\":\"Contacto\"},\"phones\":[{\"phone\":\"+$TESTNUM\",\"wa_id\":\"$TESTNUM\",\"type\":\"CELL\"}]}]}]},\"field\":\"messages\"}]}]}"
ST=$(post_webhook "$VCARD_BODY"); chk "webhook vCard HTTP" "$ST" "200"
sleep 6
CARD1=$(owner_msg_id_by_label "owner_vcard_captured_$TESTNUM")
[ -n "$CARD1" ] && ok "tarjeta de captura enviada al owner (msg_id=$CARD1)" || bad "tarjeta captura" "" "message_id"

echo "=== STEP 2 — owner elige persona: Beta / amigo ==="
ST=$(inject_interactive "owner_pipe:$TESTNUM:persona_beta" "$CARD1" "Beta / amigo"); chk "webhook persona HTTP" "$ST" "200"
sleep 6
CARD2=$(owner_msg_id_by_label "owner_sequence_selector_${TESTNUM}_persona_beta")
[ -n "$CARD2" ] && ok "selector de secuencias enviado (msg_id=$CARD2)" || bad "selector secuencias" "" "message_id"

echo "=== STEP 3 — owner elige secuencia: beta_architectura ==="
ST=$(inject_interactive "owner_seq:$TESTNUM:beta_architectura" "$CARD2" "Validar arquitectura"); chk "webhook secuencia HTTP" "$ST" "200"
sleep 7
READOUT=$(owner_body_by_label "owner_sequence_readout_beta_architectura")
chk_has "readout persona-first al owner" "$READOUT" "Secuencia elegida: Validar arquitectura IA360"
CARD3=$(owner_msg_id_by_label "owner_approve_card_${TESTNUM}_beta_architectura")
[ -n "$CARD3" ] && ok "TARJETA DE APROBACION enviada (msg_id=$CARD3)" || bad "tarjeta aprobacion" "" "message_id"
CARD3_BODY=$(psql_q "SELECT message_body FROM coexistence.chat_history WHERE message_id='$CARD3' LIMIT 1")
chk_has "tarjeta de aprobacion correcta" "$CARD3_BODY" "IA360: aprobar"

if [ "$MODE" = "positivo" ]; then
  echo "=== STEP 4P — abrir ventana 24h: inbound simulado del contacto de prueba ==="
  INBODY="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"e2e\",\"changes\":[{\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"$WA\",\"phone_number_id\":\"$PID_NUM\"},\"contacts\":[{\"profile\":{\"name\":\"Contacto Prueba\"},\"wa_id\":\"$TESTNUM\"}],\"messages\":[{\"from\":\"$TESTNUM\",\"id\":\"$WAMID_BASE.inwindow\",\"timestamp\":\"$(ts)\",\"type\":\"text\",\"text\":{\"body\":\"hola\"}}]},\"field\":\"messages\"}]}]}"
  ST=$(post_webhook "$INBODY"); chk "webhook inbound contacto HTTP" "$ST" "200"
  sleep 8
fi

echo "=== STEP 5 — owner tap: Aprobar y enviar ==="
ST=$(inject_interactive "owner_approve_send:$TESTNUM:beta_architectura" "$CARD3" "Aprobar y enviar"); chk "webhook aprobar HTTP" "$ST" "200"
sleep 10

if [ "$MODE" = "positivo" ]; then
  echo "=== STEP 6P — el CONTACTO recibe el opener + stage avanzado ==="
  OPENER=$(psql_q "SELECT message_body||' | status='||status FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$TESTNUM' AND template_meta->>'label'='ia360_seq_opener_beta_architectura' ORDER BY id DESC LIMIT 1")
  chk_has "opener RENDERIZADO en chat_history del contacto" "$OPENER" "soy la IA de Alek"
  echo "  [RENDER] $OPENER"
  STAGE=$(psql_q "SELECT s.name FROM coexistence.deals d JOIN coexistence.pipeline_stages s ON s.id=d.stage_id JOIN coexistence.pipelines p ON p.id=d.pipeline_id WHERE p.name='IA360 WhatsApp Revenue Pipeline' AND d.contact_number='$TESTNUM' ORDER BY d.updated_at DESC NULLS LAST, d.id DESC LIMIT 1")
  chk "stage del deal avanzado" "$STAGE" "Diagnóstico enviado"
  APPROVED=$(psql_q "SELECT custom_fields->>'approved_by' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$TESTNUM'")
  chk "approved_by persistido" "$APPROVED" "$OWNER"
  DONE_MSG=$(owner_body_by_label "owner_approve_send_done")
  chk_has "confirmacion al owner" "$DONE_MSG" "Diagnóstico enviado"
else
  echo "=== STEP 6N — GATE: sin allowlist NO envia ==="
  BLOCKED=$(owner_body_by_label "owner_approve_send_blocked")
  chk_has "owner notificado del bloqueo por allowlist" "$BLOCKED" "IA360_APPROVE_SEND_ALLOWLIST"
  SENT_TO_CONTACT=$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$TESTNUM'")
  chk "cero mensajes salientes al contacto" "$SENT_TO_CONTACT" "0"
  REASON=$(psql_q "SELECT custom_fields->>'ia360_approve_send_blocked_reason' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$TESTNUM'")
  chk "razon de bloqueo persistida" "$REASON" "not_in_test_allowlist"
fi

echo ""
echo "=== RESULTADO: PASS=$PASS FAIL=$FAIL (modo=$MODE) ==="
[ "$FAIL" = "0" ] && exit 0 || exit 1
