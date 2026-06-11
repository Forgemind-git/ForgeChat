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
chk_nonempty(){ if [ -n "$2" ]; then ok "$1"; else bad "$1" "(vacío)" "no-vacío"; fi; }

psql_q(){ docker exec "$DB" psql -U postgres -d postgres -tAc "$1"; }

NODE_POST='let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const h={"content-type":"application/json"};if(process.env.SIG)h["x-hub-signature-256"]=process.env.SIG;const r=await fetch(process.env.URL,{method:"POST",headers:h,body:d});const t=await r.text();process.stdout.write(String(r.status));}catch(e){process.stdout.write("ERR "+e.message);}});'

post_webhook(){
  local body="$1"
  local sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$APP_SECRET" -r | cut -d' ' -f1)"
  printf '%s' "$body" | docker exec -i -e SIG="$sig" -e URL="$BASE/webhook/whatsapp" "$BE" node -e "$NODE_POST"
}

ts(){ date +%s; }
WAMID_BASE="wamid.e2e.gcold.$(ts)"

# G-BRAIN: filtro temporal (15 min) — sin él, un label de una corrida anterior
# produce falsos PASS (p.ej. un owner_approve_send_blocked viejo).
owner_msg_id_by_label(){ # $1=label → message_id de la última saliente al owner con ese label
  psql_q "SELECT message_id FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'label'='$1' AND created_at > NOW() - INTERVAL '15 minutes' ORDER BY id DESC LIMIT 1"
}
owner_body_by_label(){
  psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'label'='$1' AND created_at > NOW() - INTERVAL '15 minutes' ORDER BY id DESC LIMIT 1"
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

# ============================================================================
echo "=== SIM A — sponsor (5219990077701): sponsor_diagnostico como template frío ==="
run_cold_sim "5219990077701" "QA Sponsor GCold" "persona_sponsor" "Sponsor / ejecutivo" "sponsor_diagnostico" "Diagnóstico ejecutivo" "ia360_sponsor_diagnostico"

sleep 61  # G-COLD: ventana nueva del presupuesto owner (6 msg/60s)
echo ""
echo "=== SIM B — cfo (5219990077702): cfo_control como template frío ==="
run_cold_sim "5219990077702" "QA CFO GCold" "persona_cfo" "CFO / finanzas" "cfo_control" "Auditar control" "ia360_cfo_control"

sleep 61  # G-COLD: ventana nueva del presupuesto owner (6 msg/60s)
echo ""
echo "=== SIM C — aliado (5219990077703): aliado_mapa_colaboracion v2 como template frío ==="
run_cold_sim "5219990077703" "QA Aliado GCold" "persona_aliado" "Aliado / socio" "aliado_mapa_colaboracion" "Mapa colaboración" "ia360_aliado_mapa_colaboracion_v2"

# ============================================================================
sleep 61  # G-COLD: ventana nueva del presupuesto owner (6 msg/60s)
echo ""
echo "=== SIM D — aliado (5219990077704): template EN REVISIÓN bloquea de punta a punta ==="
NUMD="5219990077704"

# G-BRAIN fixture: ia360_aliado_criterios_fit ya está APPROVED en Meta. Para
# conservar la cobertura del caso "template en revisión", el SIM D lo simula
# mutando el cache local de status y lo RESTAURA SIEMPRE al salir (trap EXIT).
# OJO: el check constraint solo admite DRAFT/SUBMITTED/APPROVED/REJECTED/PAUSED/
# DISABLED — se usa SUBMITTED, que ia360ColdAvailability trata como "en revisión".
restore_criterios_fit(){
  psql_q "UPDATE coexistence.message_templates SET status='APPROVED' WHERE name='ia360_aliado_criterios_fit'" >/dev/null
}
trap restore_criterios_fit EXIT
psql_q "UPDATE coexistence.message_templates SET status='SUBMITTED' WHERE name='ia360_aliado_criterios_fit'" >/dev/null
chk "fixture: criterios_fit simulado en revisión" "$(psql_q "SELECT status FROM coexistence.message_templates WHERE name='ia360_aliado_criterios_fit'")" "SUBMITTED"

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

# G-BRAIN: restaurar el status real (APPROVED) ya, sin esperar al EXIT.
restore_criterios_fit
chk "fixture: criterios_fit restaurado a APPROVED" "$(psql_q "SELECT status FROM coexistence.message_templates WHERE name='ia360_aliado_criterios_fit'")" "APPROVED"

# ============================================================================
sleep 61  # G-COLD: ventana nueva del presupuesto owner (6 msg/60s)
echo ""
echo "=== SIM JR — José Ramón (5213319706935, contacto REAL): tarjeta simulada, CERO egress ==="
JR="5213319706935"
# SIN limpieza y SIN approve: solo persona → selector (las tarjetas van al OWNER).

echo "--- STEP 1 — última tarjeta del owner para JR ---"
JR_CARD=$(psql_q "SELECT message_id FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'label' LIKE '%${JR}%' ORDER BY id DESC LIMIT 1")
JR_CARD_LABEL=""
[ -n "$JR_CARD" ] && JR_CARD_LABEL=$(psql_q "SELECT template_meta->>'label' FROM coexistence.chat_history WHERE message_id='$JR_CARD' ORDER BY id DESC LIMIT 1")
# owner_pipe exige contexto de tarjeta de CAPTURA; si la última tarjeta es otra
# (selector/approve) o no existe, re-compartimos su vCard (egress solo al owner).
case "$JR_CARD_LABEL" in
  owner_vcard_captured_${JR}*) ok "tarjeta de captura previa encontrada (msg_id=$JR_CARD)";;
  *)
    echo "  [INFO] sin tarjeta de captura reciente (label='$JR_CARD_LABEL'); re-comparto vCard"
    ST=$(inject_vcard "$JR" "José Ramón" "José" "vcard.jr")
    chk "webhook vCard JR HTTP" "$ST" "200"
    JR_CARD=$(wait_owner_msg "owner_vcard_captured_$JR" 90)
    [ -n "$JR_CARD" ] && ok "tarjeta de captura JR (msg_id=$JR_CARD)" || bad "tarjeta captura JR" "" "message_id"
    ;;
esac

echo "--- STEP 2 — owner clasifica a JR como aliado → selector con marcas frías ---"
ST=$(inject_interactive "owner_pipe:$JR:persona_aliado" "$JR_CARD" "Aliado / socio")
chk "webhook persona JR HTTP" "$ST" "200"
sleep 8
JR_SEL=$(wait_owner_msg "owner_sequence_selector_${JR}_persona_aliado" 90)
[ -n "$JR_SEL" ] && ok "selector enviado al owner (msg_id=$JR_SEL)" || bad "selector JR" "" "message_id"

echo "--- STEP 3 — la tarjeta simulada (ranking persistido completo) ---"
psql_q "SELECT jsonb_pretty(custom_fields->'ia360_selector_ranking') FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$JR'"
JR_DESC=$(psql_q "SELECT r->>'description' FROM coexistence.contacts c, jsonb_array_elements(c.custom_fields->'ia360_selector_ranking'->'rows') r WHERE c.wa_number='$WA' AND c.contact_number='$JR' AND r->>'title'='Criterios de fit' LIMIT 1")
# G-BRAIN: la marca de disponibilidad SOLO existe en modo frío (fuera de ventana
# de 24 h). Si JR tiene conversación viva (escribió hace <24 h), el selector va
# en modo caliente y el row sin marca es el comportamiento CORRECTO.
JR_OUTW=$(psql_q "SELECT custom_fields->'ia360_selector_ranking'->'cold'->>'outside_window' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$JR'")
if [ "$JR_OUTW" = "true" ]; then
  chk_any "row Criterios de fit con marca de disponibilidad (modo frío)" "$JR_DESC" "template|✓"
else
  chk_nonempty "row Criterios de fit presente (modo caliente, sin marca: ventana abierta)" "$JR_DESC"
fi

echo "--- STEP 4 — CERO egress a JR durante la simulación ---"
JR_EGRESS=$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$JR' AND created_at > now() - interval '10 minutes'")
chk "cero salientes recientes a JR" "$JR_EGRESS" "0"

# ============================================================================
echo ""
echo "=== RESULTADO G-COLD: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && exit 0 || exit 1
