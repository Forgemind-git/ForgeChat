#!/usr/bin/env bash
# ============================================================================
# qa-pipeline-harness.sh — Harness QA por pipeline (WhatsApp IA360)
#
# Prueba cada pipeline invocando su STARTER/ENDPOINT REAL, nunca TEMPLATE_ID
# directo. Sustituye al helper obsoleto /tmp/send_ia360_pipeline_test.js, que
# contaminaba metadata (pipeline="IA360 100M texto" hardcodeado para todo) y no
# soportaba headers IMAGE. Para envíos de template aislados (modo template_only,
# con soporte IMAGE y metadata veraz) usa scripts/qa-template-send.js.
#
# route_type (clasificación de cada prueba, doc 2026-06-10):
#   template_only          — solo se mandó el template; NO cuenta como pipeline probado.
#   forgechat_monolith_e2e — flujo real del monolito webhook.js (starter + router + estado + deal).
#   n8n_brain_v2_staged    — ruta canary Brain v2 (owner allowlist), staged.
#   new_arch_integrated    — arquitectura nueva integrada (aún no aplica en QA).
#
# Subcomandos:
#   revenue-os <num_qa>       E2E Pipeline "WhatsApp Revenue OS" vía POST
#                             /api/internal/ia360-revenue/opener (starter real).
#   gate-slots-bug <num_qa>   Reproducción del bug canon gate_slots (memoria
#                             ia360-revenue-os-bug): en estado handoff, el click
#                             "Sí, ver horarios" NO debe emitir ia360_os_revenue_ahora_no.
#                             Con STALE=1 inyecta además un "Ahora no" viejo
#                             (OJO: esa rama puede notificar al owner vía fallback global).
#   m100 <num_qa>             Router 100M del monolito: mapa real, anti-loop G-C,
#                             "No prioritario" sin botón Aplicarlo.
#   seq <num_qa> <seq_id> <opcion> <titulo>
#                             Respuesta del contacto a un opener v2 (ids seq_* G-C).
#   cold-send <num_qa> <persona> <seq_id> [nombre]
#                             Cadena cold-send completa vía owner: vCard → persona →
#                             secuencia → tarjeta de aprobación → owner_approve_send.
#                             *** EGRESA AL OWNER: correr UNA SOLA VEZ por sesión. ***
#   template-only <num_qa> <template_name> <pipeline> [header_image_url]
#                             Envío de template aislado con metadata veraz (no
#                             marca el pipeline como probado).
#
# Solo números QA 52199900*. El bot 5213321594582 nunca es contacto. Cero egress
# a contactos reales. Egress técnico a números QA inexistentes: Meta lo acepta o
# lo marca failed async; lo que se audita es chat_history/estado/deals.
# ============================================================================
set -uo pipefail

WA="5213321594582"            # wa_number cuenta IA360 (display_phone_number)
OWNER="5213322638033"         # owner Alek (solo para el subcomando cold-send)
PID_NUM="873315362541590"     # phone_number_id REAL (fix G-D: el inyector debe usarlo)
DB="forgecrm-db"
BE="forgecrm-backend"
REPO="/home/alek/stack/forgechat-poc"
ENVF="$REPO/backend/.env"

APP_SECRET="$(grep -E '^META_APP_SECRET=' "$ENVF" | head -1 | cut -d= -f2-)"
DIR_SECRET="$(grep -E '^IA360_DIRECTIVE_SECRET=' "$ENVF" | head -1 | cut -d= -f2-)"
# Sin secretos no hay HMAC válido: abortar aquí evita corridas que "pasan" sin autenticar.
[ -n "$APP_SECRET" ] || { echo "ABORT: META_APP_SECRET vacío (revisa $ENVF)" >&2; exit 2; }
[ -n "$DIR_SECRET" ] || { echo "ABORT: IA360_DIRECTIVE_SECRET vacío (revisa $ENVF)" >&2; exit 2; }
PORT="$(docker exec "$BE" printenv PORT 2>/dev/null)"; PORT="${PORT:-3011}"
BASE="http://localhost:${PORT}/api"

TEST_RUN="qa-harness.$(date +%s)"
PASS=0; FAIL=0
ok(){ echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FAIL] $1  (esperado~'$3' obtuvo='$2')"; FAIL=$((FAIL+1)); }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }
chk_has(){ if echo "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "$2" "contiene:$3"; fi; }
chk_not(){ if echo "$2" | grep -qF "$3"; then bad "$1" "contiene $3" "sin $3"; else ok "$1"; fi; }

psql_q(){ docker exec "$DB" psql -U postgres -d postgres -tAc "$1"; }

guard_qa(){ # ningún subcomando acepta números fuera del rango QA; solo dígitos
  # (regex estricta: evita basura tras el prefijo que rompería JSON/SQL embebidos)
  if ! [[ "$1" =~ ^52199900[0-9]{5}$ ]]; then
    echo "ABORT: '$1' no es número QA válido (52199900 + 5 dígitos). Este harness nunca egresa a contactos reales." >&2
    exit 2
  fi
}

NODE_POST='let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const h={"content-type":"application/json"};if(process.env.SIG)h["x-hub-signature-256"]=process.env.SIG;if(process.env.SECRET)h["X-IA360-Directive-Secret"]=process.env.SECRET;const r=await fetch(process.env.URL,{method:"POST",headers:h,body:d});const t=await r.text();process.stdout.write(String(r.status)+(process.env.SHOWBODY?(" "+t):""));}catch(e){process.stdout.write("ERR "+e.message);}});'

post_webhook(){
  local body="$1"
  local sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$APP_SECRET" -r | cut -d' ' -f1)"
  printf '%s' "$body" | docker exec -i -e SIG="$sig" -e URL="$BASE/webhook/whatsapp" "$BE" node -e "$NODE_POST"
}

ts(){ date +%s; }
wamid(){ echo "wamid.${TEST_RUN}.$1.$(ts).$RANDOM"; }

# Inyectores HMAC. entry.id="qa-harness" marca provenance veraz del evento sintético.
_envelope(){ # $1=from $2=profile $3=messages_json
  printf '{"object":"whatsapp_business_account","entry":[{"id":"qa-harness","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"%s","phone_number_id":"%s"},"contacts":[{"wa_id":"%s","profile":{"name":"%s"}}],"messages":[%s]}}]}]}' "$WA" "$PID_NUM" "$1" "$2" "$3"
}
inject_tpl_button(){ # $1=from $2=payload_texto (quick reply de template) $3=profile
  post_webhook "$(_envelope "$1" "${3:-QA Harness}" "{\"from\":\"$1\",\"id\":\"$(wamid tplbtn)\",\"timestamp\":\"$(ts)\",\"type\":\"button\",\"button\":{\"text\":\"$2\",\"payload\":\"$2\"}}")"
}
inject_button(){ # $1=from $2=reply_id $3=title $4=profile
  post_webhook "$(_envelope "$1" "${4:-QA Harness}" "{\"from\":\"$1\",\"id\":\"$(wamid btn)\",\"timestamp\":\"$(ts)\",\"type\":\"interactive\",\"interactive\":{\"type\":\"button_reply\",\"button_reply\":{\"id\":\"$2\",\"title\":\"$3\"}}}")"
}
inject_text(){ # $1=from $2=texto $3=profile $4=wamid (pásalo si luego auditas por ia360_handler_for)
  local id="${4:-$(wamid txt)}"
  post_webhook "$(_envelope "$1" "${3:-QA Harness}" "{\"from\":\"$1\",\"id\":\"$id\",\"timestamp\":\"$(ts)\",\"type\":\"text\",\"text\":{\"body\":\"$2\"}}")"
}
inject_list(){ # $1=from $2=row_id $3=context_msg_id $4=title $5=profile
  post_webhook "$(_envelope "$1" "${5:-QA Harness}" "{\"from\":\"$1\",\"id\":\"$(wamid list)\",\"timestamp\":\"$(ts)\",\"type\":\"interactive\",\"context\":{\"id\":\"$3\"},\"interactive\":{\"type\":\"list_reply\",\"list_reply\":{\"id\":\"$2\",\"title\":\"$4\"}}}")"
}
inject_vcard(){ # $1=from(owner) $2=nombre $3=numero
  post_webhook "$(_envelope "$1" "Alek" "{\"from\":\"$1\",\"id\":\"$(wamid vcard)\",\"timestamp\":\"$(ts)\",\"type\":\"contacts\",\"contacts\":[{\"name\":{\"formatted_name\":\"$2\",\"first_name\":\"$2\"},\"phones\":[{\"phone\":\"+$3\",\"wa_id\":\"$3\",\"type\":\"CELL\"}]}]}")"
}

# Lecturas de auditoría
max_out_id(){ psql_q "SELECT COALESCE(MAX(id),0) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$1'"; }
fresh_out_label(){ # $1=contact $2=label $3=base_id -> message_body de la saliente NUEVA con ese label
  psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$1' AND id>$3 AND template_meta->>'label'='$2' ORDER BY id DESC LIMIT 1"
}
fresh_count_label(){ psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$1' AND id>$3 AND template_meta->>'label'='$2'"; }
fresh_labels(){ psql_q "SELECT string_agg(template_meta->>'label', ', ' ORDER BY id) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$1' AND id>$2"; }
rev_state(){ psql_q "SELECT custom_fields->>'ia360_revenue_state' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$1'"; }
p5_stage(){ psql_q "SELECT s.name FROM coexistence.deals d JOIN coexistence.pipeline_stages s ON s.id=d.stage_id JOIN coexistence.pipelines p ON p.id=d.pipeline_id WHERE p.name='WhatsApp Revenue OS' AND d.contact_number='$1' ORDER BY d.updated_at DESC NULLS LAST, d.id DESC LIMIT 1"; }
cf_of(){ psql_q "SELECT custom_fields->>'$2' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$1'"; }

banner(){
  echo "=============================================================="
  echo "$1"
  echo "  test_run=$TEST_RUN  route_type=$2"
  echo "=============================================================="
}
verdict(){
  echo ""
  echo "--------------------------------------------------------------"
  echo "  RESULTADO ($1):  PASS=$PASS  FAIL=$FAIL  test_run=$TEST_RUN"
  echo "--------------------------------------------------------------"
  [ "$FAIL" -eq 0 ] || exit 1
}

# ───────────────────────────────────────────────────────────────────────────
cmd_revenue_os(){
  local QA="$1"; guard_qa "$QA"
  banner "REVENUE OS E2E — starter real POST /internal/ia360-revenue/opener — contacto QA $QA" "forgechat_monolith_e2e"

  echo "--- STEP 0: limpieza de estado P5 del contacto QA (no toca P2 ni otros contactos) ---"
  psql_q "DELETE FROM coexistence.deals WHERE contact_number='$QA' AND pipeline_id=(SELECT id FROM coexistence.pipelines WHERE name='WhatsApp Revenue OS')" >/dev/null
  psql_q "UPDATE coexistence.contacts SET custom_fields = custom_fields - 'ia360_revenue_state' - 'ia360_revenue_dolor' - 'ia360_revenue_canal' - 'ia360_revenue_volumen' - 'ia360_revenue_calificacion_raw' - 'ia360_revenue_started_at' WHERE wa_number='$WA' AND contact_number='$QA'" >/dev/null
  local BASE_ID; BASE_ID="$(max_out_id "$QA")"
  ok "estado P5 limpio (base chat_history id=$BASE_ID)"

  echo "--- PASO 1: opener vía endpoint real ---"
  local RES; RES="$(printf '%s' "{\"contact_number\":\"$QA\",\"name\":\"QA Revenue OS\"}" | docker exec -i -e SECRET="$DIR_SECRET" -e URL="$BASE/internal/ia360-revenue/opener" -e SHOWBODY=1 "$BE" node -e "$NODE_POST")"
  echo "  opener resp: $RES"
  chk_has "PASO1 endpoint respondió ok" "$RES" '"ok":true'
  sleep 6
  chk "PASO1 estado=apertura_sent" "$(rev_state "$QA")" "apertura_sent"
  chk "PASO1 deal P5 en 'Leads desorganizados'" "$(p5_stage "$QA")" "Leads desorganizados"
  local APERTURA; APERTURA="$(psql_q "SELECT status||' | '||message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA' AND id>$BASE_ID AND template_meta->>'template_name'='ia360_os_revenue_apertura' ORDER BY id DESC LIMIT 1")"
  echo "  apertura chat_history: $APERTURA"
  chk_has "PASO1 template apertura registrado" "$APERTURA" "soy la IA de Alek"

  echo "--- PASO 1→2: tap 'Sí, cuéntame' (quick reply del template) ---"
  chk "PASO1→2 HTTP" "$(inject_tpl_button "$QA" "Sí, cuéntame" "QA Revenue OS")" "200"
  sleep 5
  chk "PASO2 estado=calificacion" "$(rev_state "$QA")" "calificacion"
  local P2; P2="$(fresh_out_label "$QA" ia360_os_revenue_paso2 "$BASE_ID")"
  echo "  paso2: $P2"
  chk_has "PASO2 pregunta de calificación" "$P2" "rastro"

  echo "--- PASO 2→3: texto libre de calificación ---"
  local W2; W2="$(wamid calif)"
  chk "PASO2→3 HTTP" "$(inject_text "$QA" "Todo va en un Excel y la memoria, se nos caen como 15 leads al mes" "QA Revenue OS" "$W2")" "200"
  sleep 6
  chk "PASO3 estado=propuesta" "$(rev_state "$QA")" "propuesta"
  chk_has "PASO2 dolor capturado" "$(cf_of "$QA" ia360_revenue_dolor)" "Excel"
  local P3; P3="$(fresh_out_label "$QA" ia360_os_revenue_paso3 "$BASE_ID")"
  echo "  paso3: $P3"
  chk_has "PASO3 botón 'Ver cómo se vería'" "$P3" "Ver cómo se vería"
  chk_has "PASO3 botón 'Hablar con Alek'" "$P3" "Hablar con Alek"
  chk "PASO2 el agente genérico NO respondió (gate cortó)" "$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA' AND template_meta->>'ia360_handler_for'='$W2' AND template_meta->>'label' LIKE 'ia360_ai_%'")" "0"

  echo "--- PASO 3 rama A: 'Ver cómo se vería' → demo + deal a Diseño propuesto ---"
  chk "RAMA-A HTTP" "$(inject_button "$QA" "revenue_ver_demo" "Ver cómo se vería" "QA Revenue OS")" "200"
  sleep 5
  chk "RAMA-A estado=demo" "$(rev_state "$QA")" "demo"
  chk "RAMA-A deal P5 → 'Diseño propuesto'" "$(p5_stage "$QA")" "Diseño propuesto"
  chk "RAMA-A demo enviado" "$(fresh_count_label "$QA" ia360_os_revenue_demo "$BASE_ID")" "1"

  echo "--- reset a 'propuesta' para rama B (handoff) ---"
  psql_q "UPDATE coexistence.contacts SET custom_fields = custom_fields || '{\"ia360_revenue_state\":\"propuesta\"}'::jsonb WHERE wa_number='$WA' AND contact_number='$QA'" >/dev/null
  chk "RAMA-B HTTP" "$(inject_button "$QA" "revenue_hablar_alek" "Hablar con Alek" "QA Revenue OS")" "200"
  sleep 5
  chk "RAMA-B estado=handoff" "$(rev_state "$QA")" "handoff"
  local GATE; GATE="$(fresh_out_label "$QA" ia360_os_revenue_gate_agenda "$BASE_ID")"
  echo "  gate: $GATE"
  chk_has "RAMA-B compuerta de agenda con botones" "$GATE" "Sí, ver horarios"

  echo "--- Cero mezcla con el router 100M ---"
  chk "ninguna saliente ia360_100m_* en toda la corrida" "$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA' AND id>$BASE_ID AND template_meta->>'label' LIKE 'ia360_100m%'")" "0"
  echo "  labels de la corrida: $(fresh_labels "$QA" "$BASE_ID")"
  verdict "Revenue OS E2E ($QA)"
}

# ───────────────────────────────────────────────────────────────────────────
cmd_gate_slots_bug(){
  local QA="$1"; guard_qa "$QA"
  banner "BUG gate_slots (memoria ia360-revenue-os-bug) — contacto QA $QA" "forgechat_monolith_e2e"
  local ST; ST="$(rev_state "$QA")"
  if [ "$ST" != "handoff" ]; then
    echo "  [WARN] estado actual='$ST' ≠ handoff → lo siembro por SQL para la reproducción aislada"
    psql_q "UPDATE coexistence.contacts SET custom_fields = custom_fields || '{\"ia360_revenue_state\":\"handoff\"}'::jsonb WHERE wa_number='$WA' AND contact_number='$QA'" >/dev/null
  fi
  local BASE_ID; BASE_ID="$(max_out_id "$QA")"

  echo "--- Repro 1: click 'Sí, ver horarios' (gate_slots_yes) en estado handoff ---"
  echo "    Bug original 2026-06-09 00:30: este click emitía TAMBIÉN ia360_os_revenue_ahora_no."
  chk "R1 HTTP" "$(inject_button "$QA" "gate_slots_yes" "Sí, ver horarios" "QA Revenue OS")" "200"
  sleep 8
  chk "R1 ahora_no NO emitido" "$(fresh_count_label "$QA" ia360_os_revenue_ahora_no "$BASE_ID")" "0"
  chk "R1 estado sigue handoff (sin fuga a nutricion)" "$(rev_state "$QA")" "handoff"
  local SLOTS; SLOTS="$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA' AND id>$BASE_ID AND template_meta->>'label' IN ('ia360_lite_available_slots_reslots','ia360_lite_reslots_none')")"
  chk "R1 respuesta de horarios (slots reales o aviso sin huecos)" "$SLOTS" "1"
  echo "  labels tras R1: $(fresh_labels "$QA" "$BASE_ID")"

  if [ "${STALE:-0}" = "1" ]; then
    echo "--- Repro 2 (STALE=1): quick reply viejo 'Ahora no' en estado handoff ---"
    echo "    OJO: si cae al fallback global, notifica al owner (corre esto solo en el bloque final)."
    local BASE2; BASE2="$(max_out_id "$QA")"
    chk "R2 HTTP" "$(inject_tpl_button "$QA" "Ahora no" "QA Revenue OS")" "200"
    sleep 6
    chk "R2 ahora_no NO emitido (gateo por estado funciona)" "$(fresh_count_label "$QA" ia360_os_revenue_ahora_no "$BASE2")" "0"
    chk "R2 estado NO cayó a nutricion" "$(rev_state "$QA")" "handoff"
    echo "  respuesta real a R2: $(fresh_labels "$QA" "$BASE2")"
  else
    echo "  (Repro 2 'Ahora no' stale omitida; corre con STALE=1 en el bloque final con egress al owner)"
  fi
  verdict "bug gate_slots ($QA)"
}

# ───────────────────────────────────────────────────────────────────────────
cmd_m100(){
  local QA="$1"; guard_qa "$QA"
  banner "ROUTER 100M (monolito) — contacto QA $QA" "forgechat_monolith_e2e"
  psql_q "UPDATE coexistence.contacts SET custom_fields = custom_fields - 'ia360_100m_visited' WHERE wa_number='$WA' AND contact_number='$QA'" >/dev/null
  local BASE_ID; BASE_ID="$(max_out_id "$QA")"

  echo "--- T1: 'Quiero mapa' entrega mapa real (guardrail f4b56b2, sin offer_router) ---"
  chk "T1 HTTP" "$(inject_button "$QA" "100m_want_map" "Quiero mapa" "QA Cien Eme")" "200"
  sleep 6
  local L1; L1="$(fresh_labels "$QA" "$BASE_ID")"
  echo "  labels: $L1"
  chk_has "T1 responde la rama de mapa" "$L1" "mapa"
  chk_not "T1 NO abre el Flow ia360_offer_router" "$L1" "offer_router"

  echo "--- T2: anti-loop G-C — segunda visita al mismo nodo → versión condensada ---"
  local BASE2; BASE2="$(max_out_id "$QA")"
  chk "T2 HTTP" "$(inject_button "$QA" "100m_want_map" "Quiero mapa" "QA Cien Eme")" "200"
  sleep 6
  chk "T2 respuesta condensada (ia360_100m_condensed)" "$(fresh_count_label "$QA" ia360_100m_condensed "$BASE2")" "1"

  echo "--- T3: 'No prioritario' sin botón 'Aplicarlo' (anti-loop G-C) ---"
  local BASE3; BASE3="$(max_out_id "$QA")"
  chk "T3 HTTP" "$(inject_button "$QA" "100m_not_priority" "No prioritario" "QA Cien Eme")" "200"
  sleep 6
  local R3; R3="$(psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA' AND id>$BASE3 ORDER BY id DESC LIMIT 1")"
  echo "  respuesta: $R3"
  chk_not "T3 sin 'Aplicarlo'" "$R3" "Aplicarlo"
  verdict "router 100M ($QA)"
}

# ───────────────────────────────────────────────────────────────────────────
cmd_seq(){
  local QA="$1" SEQ="$2" OPT="$3" TITLE="$4"; guard_qa "$QA"
  banner "OPENERS V2 — respuesta seq_${SEQ}:${OPT} — contacto QA $QA" "forgechat_monolith_e2e"
  psql_q "UPDATE coexistence.contacts SET custom_fields = custom_fields - 'ia360_seq_last_response' WHERE wa_number='$WA' AND contact_number='$QA'" >/dev/null
  local BASE_ID; BASE_ID="$(max_out_id "$QA")"
  chk "HTTP" "$(inject_button "$QA" "seq_${SEQ}:${OPT}" "$TITLE")" "200"
  sleep 6
  local LBL; LBL="$(fresh_labels "$QA" "$BASE_ID")"
  echo "  labels: $LBL"
  chk_has "router seq_* respondió (label ia360_seq_*)" "$LBL" "ia360_seq_"
  chk_has "respuesta registrada en custom_fields" "$(cf_of "$QA" ia360_seq_last_response)" "$OPT"
  verdict "seq ${SEQ}:${OPT} ($QA)"
}

# ───────────────────────────────────────────────────────────────────────────
cmd_cold_send(){
  local QA="$1" PERSONA="$2" SEQ="$3" NAME="${4:-QA Cold Send}"; guard_qa "$QA"
  banner "COLD-SEND vía owner (starter real de secuencias) — $PERSONA/$SEQ → $QA" "forgechat_monolith_e2e"
  echo "  *** Este subcomando EGRESA AL OWNER (tarjetas + confirmación). Una sola corrida por sesión. ***"
  local BASE_OWNER; BASE_OWNER="$(max_out_id "$OWNER")"
  local BASE_QA; BASE_QA="$(max_out_id "$QA")"

  echo "--- C1: vCard del owner → tarjeta de captura ---"
  chk "C1 HTTP" "$(inject_vcard "$OWNER" "$NAME" "$QA")" "200"
  sleep 7
  local CARD; CARD="$(psql_q "SELECT message_id FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND id>$BASE_OWNER AND template_meta->>'label'='owner_vcard_captured_$QA' ORDER BY id DESC LIMIT 1")"
  if [ -z "$CARD" ]; then bad "C1 tarjeta vCard" "(vacío)" "message_id"; verdict "cold-send"; return; fi
  ok "C1 tarjeta vCard ($CARD)"

  echo "--- C2: persona $PERSONA → selector de secuencias ---"
  chk "C2 HTTP" "$(inject_list "$OWNER" "owner_pipe:$QA:$PERSONA" "$CARD" "Persona" "Alek")" "200"
  sleep 8
  local SEL; SEL="$(psql_q "SELECT message_id FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND id>$BASE_OWNER AND template_meta->>'label'='owner_sequence_selector_${QA}_${PERSONA}' ORDER BY id DESC LIMIT 1")"
  if [ -z "$SEL" ]; then bad "C2 selector" "(vacío)" "message_id"; verdict "cold-send"; return; fi
  ok "C2 selector de secuencias ($SEL)"

  echo "--- C3: secuencia $SEQ → readout + tarjeta de aprobación ---"
  chk "C3 HTTP" "$(inject_list "$OWNER" "owner_seq:$QA:$SEQ" "$SEL" "Secuencia" "Alek")" "200"
  sleep 8
  local APR; APR="$(psql_q "SELECT message_id FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND id>$BASE_OWNER AND template_meta->>'label'='owner_approve_card_${QA}_${SEQ}' ORDER BY id DESC LIMIT 1")"
  if [ -z "$APR" ]; then bad "C3 tarjeta de aprobación" "(vacío)" "message_id"; verdict "cold-send"; return; fi
  ok "C3 tarjeta de aprobación ($APR)"

  echo "--- C4: owner_approve_send → opener real al contacto QA ---"
  chk "C4 HTTP" "$(inject_list "$OWNER" "owner_approve_send:$QA:$SEQ" "$APR" "Aprobar y enviar" "Alek")" "200"
  sleep 8
  local DONE; DONE="$(psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND id>$BASE_OWNER AND template_meta->>'label' IN ('owner_approve_send_done','owner_approve_send_failed') ORDER BY id DESC LIMIT 1")"
  echo "  resultado owner: $DONE"
  chk_has "C4 confirmación de envío al owner" "$DONE" "Envié el opener"
  local OPENER; OPENER="$(psql_q "SELECT template_meta->>'label'||' | '||status FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA' AND id>$BASE_QA ORDER BY id DESC LIMIT 1")"
  echo "  opener al QA: $OPENER"
  chk_has "C4 opener registrado para el contacto" "$OPENER" "ia360"
  echo "  deal del QA: $(psql_q "SELECT p.name||' / '||s.name FROM coexistence.deals d JOIN coexistence.pipeline_stages s ON s.id=d.stage_id JOIN coexistence.pipelines p ON p.id=d.pipeline_id WHERE d.contact_number='$QA' ORDER BY d.updated_at DESC NULLS LAST, d.id DESC LIMIT 1")"

  echo "--- C5: respuesta del contacto al opener ('Sí, cuéntame' → alias seq_*) ---"
  local BASE_QA2; BASE_QA2="$(max_out_id "$QA")"
  chk "C5 HTTP" "$(inject_tpl_button "$QA" "Sí, cuéntame" "$NAME")" "200"
  sleep 6
  local L5; L5="$(fresh_labels "$QA" "$BASE_QA2")"
  echo "  labels: $L5"
  chk_has "C5 alias ruteado al paso 2 de la secuencia" "$L5" "ia360_seq_"
  verdict "cold-send $PERSONA/$SEQ ($QA)"
}

# ───────────────────────────────────────────────────────────────────────────
cmd_template_only(){
  local QA="$1" TPL="$2" PIPE="$3" IMG="${4:-}"; guard_qa "$QA"
  banner "TEMPLATE-ONLY — $TPL → $QA (NO cuenta como pipeline probado)" "template_only"
  docker cp "$REPO/scripts/qa-template-send.js" "$BE":/app/qa-template-send.js >/dev/null
  docker exec -e TEMPLATE_NAME="$TPL" -e TO="$QA" -e PIPELINE="$PIPE" -e TEST_RUN="$TEST_RUN" \
    -e EXPECTED_HANDLER="${EXPECTED_HANDLER:-}" -e HEADER_IMAGE_URL="$IMG" \
    -e SAMPLE_VALUES="${SAMPLE_VALUES:-{\"1\":\"QA\"}}" "$BE" node /app/qa-template-send.js
  local RC=$?
  chk "encolado template_only" "$RC" "0"
  sleep 5
  echo "  chat_history: $(psql_q "SELECT status||' | '||COALESCE(error_message,'-')||' | '||(raw_payload->'interactive'->>'pipeline')||' | '||(raw_payload->'interactive'->>'route_type') FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA' AND raw_payload->'interactive'->>'test_run'='$TEST_RUN' ORDER BY id DESC LIMIT 1")"
  verdict "template-only $TPL ($QA)"
}

# ───────────────────────────────────────────────────────────────────────────
case "${1:-help}" in
  revenue-os)     cmd_revenue_os "${2:?num_qa}";;
  gate-slots-bug) cmd_gate_slots_bug "${2:?num_qa}";;
  m100)           cmd_m100 "${2:?num_qa}";;
  seq)            cmd_seq "${2:?num_qa}" "${3:?seq_id}" "${4:?opcion}" "${5:?titulo}";;
  cold-send)      cmd_cold_send "${2:?num_qa}" "${3:?persona}" "${4:?seq_id}" "${5:-}";;
  template-only)  cmd_template_only "${2:?num_qa}" "${3:?template_name}" "${4:?pipeline}" "${5:-}";;
  *) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
esac
