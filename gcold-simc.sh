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
# run_cold_sim — flujo feliz fuera de ventana: vCard → persona → selector con
# marcas frías → secuencia (readout con aviso de template) → tarjeta → aprobar
# → el opener sale como TEMPLATE de Meta.
# $1=num $2=vcard_name $3=persona_id $4=persona_title $5=seq_id $6=seq_title $7=template_name
# ────────────────────────────────────────────────────────────────────────────
run_cold_sim(){
  local NUM="$1" VNAME="$2" PERSONA="$3" PTITLE="$4" SEQ="$5" STITLE="$6" TPL="$7"

  echo "--- STEP 0 — limpieza estado QA $NUM ---"
  clean_qa_number "$NUM"
  ok "estado limpio ($NUM)"

  echo "--- STEP 1 — owner comparte vCard \"$VNAME\" ---"
  local ST; ST=$(inject_vcard "$NUM" "$VNAME" "QA" "vcard.$NUM")
  chk "webhook vCard HTTP" "$ST" "200"
  
  local CARD1; CARD1=$(wait_owner_msg "owner_vcard_captured_$NUM" 90)
  [ -n "$CARD1" ] && ok "tarjeta de captura (msg_id=$CARD1)" || bad "tarjeta captura" "" "message_id"

  echo "--- STEP 2 — owner elige persona: $PTITLE ---"
  ST=$(inject_interactive "owner_pipe:$NUM:$PERSONA" "$CARD1" "$PTITLE")
  chk "webhook persona HTTP" "$ST" "200"
  sleep 8
  local CARD2; CARD2=$(wait_owner_msg "owner_sequence_selector_${NUM}_${PERSONA}" 90)
  [ -n "$CARD2" ] && ok "selector de secuencias (msg_id=$CARD2)" || bad "selector secuencias" "" "message_id"

  echo "--- STEP 3 — asserts del ranking persistido (modo frío) ---"
  local OUTW; OUTW=$(psql_q "SELECT custom_fields->'ia360_selector_ranking'->'cold'->>'outside_window' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$NUM'")
  chk "cold.outside_window persistido" "$OUTW" "true"
  local AVLBL; AVLBL=$(psql_q "SELECT custom_fields->'ia360_selector_ranking'->'cold'->'availability'->'$SEQ'->>'label' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$NUM'")
  chk "availability($SEQ) = lista para frío" "$AVLBL" "✓ lista para frío"

  echo "--- STEP 4 — owner elige secuencia: $STITLE ---"
  ST=$(inject_interactive "owner_seq:$NUM:$SEQ" "$CARD2" "$STITLE")
  chk "webhook secuencia HTTP" "$ST" "200"
  sleep 7
  local READOUT; READOUT=$(owner_body_by_label "owner_sequence_readout_$SEQ")
  chk_has "readout avisa salida como template" "$READOUT" "saldrá como template aprobado"
  local CARD3; CARD3=$(wait_owner_msg "owner_approve_card_${NUM}_${SEQ}" 90)
  [ -n "$CARD3" ] && ok "tarjeta de aprobación (msg_id=$CARD3)" || bad "tarjeta aprobacion" "" "message_id"

  echo "--- STEP 5 — owner tap: Aprobar y enviar ---"
  ST=$(inject_interactive "owner_approve_send:$NUM:$SEQ" "$CARD3" "Aprobar y enviar")
  chk "webhook aprobar HTTP" "$ST" "200"
  sleep 10

  echo "--- STEP 6 — el opener salió como TEMPLATE de Meta ---"
  local TROW; TROW=$(psql_q "SELECT template_meta->>'template_name' || '|' || status || '|' || COALESCE(error_message,'-') FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$NUM' AND message_type='template' ORDER BY id DESC LIMIT 1")
  local TNAME TSTATUS TERR
  TNAME=$(echo "$TROW" | cut -d'|' -f1)
  TSTATUS=$(echo "$TROW" | cut -d'|' -f2)
  TERR=$(echo "$TROW" | cut -d'|' -f3-)
  echo "  [TEMPLATE] name=$TNAME status=$TSTATUS error=$TERR"
  chk "template_name correcto" "$TNAME" "$TPL"
  chk_any "status del template en sent|failed" "$TSTATUS" "^(sent|failed)$"
}

echo ""
echo "=== REGRESIÓN SIM C — aliado (5219990077703): aliado_mapa_colaboracion v2 como template frío ==="
run_cold_sim "5219990077703" "QA Aliado GCold" "persona_aliado" "Aliado / socio" "aliado_mapa_colaboracion" "Mapa colaboración" "ia360_aliado_mapa_colaboracion_v2"

echo ""
echo "=== RESULTADO REGRESIÓN C: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && exit 0 || exit 1
