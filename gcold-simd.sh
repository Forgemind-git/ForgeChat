#!/usr/bin/env bash
# ============================================================================
# E2E G-COLD — cold send con templates fríos para las 24 secuencias:
# selector con disponibilidad «lista para frío» fuera de ventana, aviso en el
# readout, tarjeta sin "Aprobar y enviar" cuando no hay template aprobado,
# cinturón en approve-send y envío real como template de Meta.
#   SIM A — sponsor_diagnostico (APPROVED) → sale como template.
#   SIM B — cfo_control (APPROVED) → sale como template.
#   SIM C — aliado_mapa_colaboracion (v2 APPROVED) → sale como template.
#   SIM D — aliado_criterios_fit (template en revisión) → bloqueado de punta a punta.
#   SIM JR — José Ramón (contacto REAL): solo tarjeta simulada, CERO egress a él.
# Uso: bash gcold-e2e.sh   (correr en el VPS)
# ============================================================================
set -uo pipefail

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
chk_not_has(){ if echo "$2" | grep -qF "$3"; then bad "$1" "$2" "NO contiene:$3"; else ok "$1"; fi; }
chk_any(){ # $1=nombre $2=valor $3=patron grep -E (alternativas)
  if echo "$2" | grep -qE "$3"; then ok "$1"; else bad "$1" "$2" "matchea:$3"; fi
}

psql_q(){ docker exec "$DB" psql -U postgres -d postgres -tAc "$1"; }

NODE_POST='let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const h={"content-type":"application/json"};if(process.env.SIG)h["x-hub-signature-256"]=process.env.SIG;const r=await fetch(process.env.URL,{method:"POST",headers:h,body:d});const t=await r.text();process.stdout.write(String(r.status));}catch(e){process.stdout.write("ERR "+e.message);}});'

post_webhook(){
  local body="$1"
  local sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$APP_SECRET" -r | cut -d' ' -f1)"
  printf '%s' "$body" | docker exec -i -e SIG="$sig" -e URL="$BASE/webhook/whatsapp" "$BE" node -e "$NODE_POST"
}

ts(){ date +%s; }
WAMID_BASE="wamid.e2e.gcold.$(ts)"

owner_msg_id_by_label(){ # $1=label → message_id de la última saliente al owner con ese label
  psql_q "SELECT message_id FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'label'='$1' ORDER BY id DESC LIMIT 1"
}
owner_body_by_label(){
  psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'label'='$1' ORDER BY id DESC LIMIT 1"
}

# G-COLD: espera con polling a que aparezca la saliente al owner con ese label.
# El presupuesto owner es 6 mensajes/60s: el polling absorbe la latencia de la
# cola sin depender de sleeps exactos.
wait_owner_msg(){ # $1=label $2=timeout_s (default 90) -> imprime message_id
  local deadline=$(( $(date +%s) + ${2:-90} ))
  local mid=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    mid=$(owner_msg_id_by_label "$1")
    [ -n "$mid" ] && { printf '%s' "$mid"; return 0; }
    sleep 5
  done
  printf '%s' ""
}

inject_interactive(){ # $1=reply_id $2=context_msg_id $3=title
  local body
  body=$(cat <<EOF
{"object":"whatsapp_business_account","entry":[{"id":"e2e","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"$WA","phone_number_id":"$PID_NUM"},"contacts":[{"profile":{"name":"Alek"},"wa_id":"$OWNER"}],"messages":[{"from":"$OWNER","id":"$WAMID_BASE.$RANDOM","timestamp":"$(ts)","type":"interactive","context":{"id":"$2"},"interactive":{"type":"list_reply","list_reply":{"id":"$1","title":"$3"}}}]},"field":"messages"}]}]}
EOF
)
  post_webhook "$body"
}

inject_vcard(){ # $1=numero $2=formatted_name $3=first_name $4=wamid_suffix
  local body
  body=$(cat <<EOF
{"object":"whatsapp_business_account","entry":[{"id":"e2e","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"$WA","phone_number_id":"$PID_NUM"},"contacts":[{"profile":{"name":"Alek"},"wa_id":"$OWNER"}],"messages":[{"from":"$OWNER","id":"$WAMID_BASE.$4","timestamp":"$(ts)","type":"contacts","contacts":[{"name":{"formatted_name":"$2","first_name":"$3"},"phones":[{"phone":"+$1","wa_id":"$1","type":"CELL"}]}]}]},"field":"messages"}]}]}
EOF
)
  post_webhook "$body"
}

clean_qa_number(){ # $1=numero QA → limpieza total (solo números sintéticos 52199900777xx)
  psql_q "DELETE FROM coexistence.deals WHERE contact_number='$1'" >/dev/null
  psql_q "DELETE FROM coexistence.chat_history WHERE contact_number='$1'" >/dev/null
  psql_q "DELETE FROM coexistence.contacts WHERE contact_number='$1'" >/dev/null
}

# ────────────────────────────────────────────────────────────────────────────
# ============================================================================
sleep 61  # G-COLD: ventana nueva del presupuesto owner (6 msg/60s)
echo ""
echo "=== SIM D — aliado (5219990077704): template EN REVISIÓN bloquea de punta a punta ==="
NUMD="5219990077704"

echo "--- STEP 0 — limpieza estado QA $NUMD ---"
clean_qa_number "$NUMD"
ok "estado limpio ($NUMD)"

echo "--- STEP 1 — vCard + persona aliado ---"
ST=$(inject_vcard "$NUMD" "QA Aliado Pending GCold" "QA" "vcard.$NUMD")
chk "webhook vCard HTTP" "$ST" "200"
sleep 6
CARD1=$(wait_owner_msg "owner_vcard_captured_$NUMD" 90)
[ -n "$CARD1" ] && ok "tarjeta de captura (msg_id=$CARD1)" || bad "tarjeta captura" "" "message_id"
ST=$(inject_interactive "owner_pipe:$NUMD:persona_aliado" "$CARD1" "Aliado / socio")
chk "webhook persona HTTP" "$ST" "200"
sleep 7
CARD2=$(wait_owner_msg "owner_sequence_selector_${NUMD}_persona_aliado" 90)
[ -n "$CARD2" ] && ok "selector de secuencias (msg_id=$CARD2)" || bad "selector secuencias" "" "message_id"

echo "--- STEP 2 — availability marca el template en revisión ---"
AVLBL=$(psql_q "SELECT custom_fields->'ia360_selector_ranking'->'cold'->'availability'->'aliado_criterios_fit'->>'label' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$NUMD'")
chk "availability(aliado_criterios_fit) en revisión" "$AVLBL" "template en revisión Meta"

echo "--- STEP 3 — owner elige secuencia: Criterios de fit ---"
ST=$(inject_interactive "owner_seq:$NUMD:aliado_criterios_fit" "$CARD2" "Criterios de fit")
chk "webhook secuencia HTTP" "$ST" "200"
sleep 7
READOUT=$(owner_body_by_label "owner_sequence_readout_aliado_criterios_fit")
chk_has "readout trae AVISO" "$READOUT" "AVISO"
chk_has "readout dice no aprobado por Meta" "$READOUT" "no está aprobado por Meta"
COLDBLK=$(psql_q "SELECT custom_fields->>'ia360_approve_card_cold_blocked' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$NUMD'")
chk "ia360_approve_card_cold_blocked = true" "$COLDBLK" "true"
CARD3=$(wait_owner_msg "owner_approve_card_${NUMD}_aliado_criterios_fit" 90)
[ -n "$CARD3" ] && ok "tarjeta de aprobación (msg_id=$CARD3)" || bad "tarjeta aprobacion" "" "message_id"
CARD3_BODY=$(psql_q "SELECT raw_payload::text FROM coexistence.chat_history WHERE message_id='$CARD3' LIMIT 1")
chk_not_has "tarjeta SIN fila Aprobar y enviar" "$CARD3_BODY" "owner_approve_send:$NUMD:aliado_criterios_fit"

echo "--- STEP 4 — tap de tarjeta vieja: owner_approve_send debe bloquearse ---"
ST=$(inject_interactive "owner_approve_send:$NUMD:aliado_criterios_fit" "$CARD3" "Aprobar y enviar")
chk "webhook aprobar HTTP" "$ST" "200"
sleep 8
BLOCKED=$(owner_body_by_label "owner_approve_send_blocked")
chk_has "cinturón avisa template no aprobado" "$BLOCKED" "aún no está aprobado por Meta"
TCOUNT=$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$NUMD' AND message_type='template'")
chk "cero templates salientes al QA" "$TCOUNT" "0"

echo ""
echo "=== RESULTADO SIM D: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && exit 0 || exit 1
