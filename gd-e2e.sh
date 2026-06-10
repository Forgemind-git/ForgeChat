#!/usr/bin/env bash
# ============================================================================
# E2E G-D — selector de secuencias RECOMENDADO (ranker rule-based, sin LLM).
# 3 perfiles QA: A=deal vivo P7+fact (803), B=referido con quien_intro (805),
# C=sin datos (807). Sims contra produccion, solo numeros QA y owner.
# Uso: bash gd-e2e.sh
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
bad(){ echo "  [FAIL] $1  (esperado~'$3' obtuvo='$2')"; FAIL=$((FAIL+1)); }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }
chk_has(){ if echo "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "$2" "contiene:$3"; fi; }
chk_not(){ if echo "$2" | grep -qF "$3"; then bad "$1" "contiene $3" "sin $3"; else ok "$1"; fi; }

psql_q(){ docker exec "$DB" psql -U postgres -d postgres -tAc "$1"; }

NODE_POST='let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const h={"content-type":"application/json"};if(process.env.SIG)h["x-hub-signature-256"]=process.env.SIG;const r=await fetch(process.env.URL,{method:"POST",headers:h,body:d});await r.text();process.stdout.write(String(r.status));}catch(e){process.stdout.write("ERR "+e.message);}});'

post_webhook(){
  local body="$1"
  local sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$APP_SECRET" -r | cut -d' ' -f1)"
  printf '%s' "$body" | docker exec -i -e SIG="$sig" -e URL="$BASE/webhook/whatsapp" "$BE" node -e "$NODE_POST"
}

ts(){ date +%s; }
WB="wamid.e2e.gd.$(ts)"

owner_msg_id_by_label(){
  psql_q "SELECT message_id FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'label'='$1' ORDER BY id DESC LIMIT 1"
}
owner_body_by_label(){
  psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'label'='$1' ORDER BY id DESC LIMIT 1"
}
ranking_of(){
  psql_q "SELECT custom_fields->'ia360_selector_ranking' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$1'"
}

inject_vcard(){ # $1=nombre $2=numero
  local body="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"e2e\",\"changes\":[{\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"$WA\",\"phone_number_id\":\"$PID_NUM\"},\"contacts\":[{\"profile\":{\"name\":\"Alek\"},\"wa_id\":\"$OWNER\"}],\"messages\":[{\"from\":\"$OWNER\",\"id\":\"$WB.vcard.$RANDOM\",\"timestamp\":\"$(ts)\",\"type\":\"contacts\",\"contacts\":[{\"name\":{\"formatted_name\":\"$1\",\"first_name\":\"$1\"},\"phones\":[{\"phone\":\"+$2\",\"wa_id\":\"$2\",\"type\":\"CELL\"}]}]}]},\"field\":\"messages\"}]}]}"
  post_webhook "$body"
}
inject_list(){ # $1=reply_id $2=context_msg_id $3=title
  local body="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"e2e\",\"changes\":[{\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"$WA\",\"phone_number_id\":\"$PID_NUM\"},\"contacts\":[{\"profile\":{\"name\":\"Alek\"},\"wa_id\":\"$OWNER\"}],\"messages\":[{\"from\":\"$OWNER\",\"id\":\"$WB.$RANDOM\",\"timestamp\":\"$(ts)\",\"type\":\"interactive\",\"context\":{\"id\":\"$2\"},\"interactive\":{\"type\":\"list_reply\",\"list_reply\":{\"id\":\"$1\",\"title\":\"$3\"}}}]},\"field\":\"messages\"}]}]}"
  post_webhook "$body"
}

selector_flow(){ # $1=nombre $2=numero $3=persona_key $4=persona_title
  ST=$(inject_vcard "$1" "$2"); chk "vCard HTTP" "$ST" "200"
  sleep 7
  CARD1=$(owner_msg_id_by_label "owner_vcard_captured_$2")
  if [ -z "$CARD1" ]; then bad "tarjeta vCard capturado" "(vacio)" "message_id"; return; fi
  ok "tarjeta vCard capturado ($CARD1)"
  ST=$(inject_list "owner_pipe:$2:$3" "$CARD1" "$4"); chk "persona HTTP" "$ST" "200"
  sleep 7
}

echo "=============================================================="
echo "PERFIL A — deal vivo P7 + fact (5219990000803, persona cliente)"
echo "=============================================================="
selector_flow "QA Cliente Tres" "5219990000803" "persona_cliente" "Cliente activo"
BODY_A=$(owner_body_by_label "owner_sequence_selector_5219990000803_persona_cliente")
RANK_A=$(ranking_of "5219990000803")
chk_has "sugerida = cliente_expansion en chat_history" "$BODY_A" "sugerida: cliente_expansion"
chk_has "razon cita el deal real (Champions G-D)" "$BODY_A" "Champions G-D"
chk_has "ranking persistido: orden inicia con cliente_expansion" "$RANK_A" "\"order\": [\"cliente_expansion\""
chk_has "resumen linea 1 cita deal y pipeline" "$RANK_A" "Deal vivo:"
chk_has "resumen linea 2 cita el fact real" "$RANK_A" "Reportes manuales"
chk_has "ranked=true" "$RANK_A" "\"ranked\": true"

echo "=============================================================="
echo "PERFIL B — referido con quien_intro (5219990000805, persona referido)"
echo "=============================================================="
selector_flow "QA Intro Cinco" "5219990000805" "persona_referido" "Referido / BNI"
BODY_B=$(owner_body_by_label "owner_sequence_selector_5219990000805_persona_referido")
RANK_B=$(ranking_of "5219990000805")
chk_has "sugerida = referido_contexto en chat_history" "$BODY_B" "sugerida: referido_contexto"
chk_has "razon cita al introductor real" "$BODY_B" "Te lo presentó QA Fallback Cuatro"
chk_has "ranking persistido: orden inicia con referido_contexto" "$RANK_B" "\"order\": [\"referido_contexto\""
chk_has "resumen cita al introductor" "$RANK_B" "QA Fallback Cuatro"
chk_has "ranked=true" "$RANK_B" "\"ranked\": true"

echo "=============================================================="
echo "PERFIL C — contacto sin datos (5219990000807, persona cliente)"
echo "=============================================================="
selector_flow "QA Sin Datos Siete" "5219990000807" "persona_cliente" "Cliente activo"
BODY_C=$(owner_body_by_label "owner_sequence_selector_5219990000807_persona_cliente")
RANK_C=$(ranking_of "5219990000807")
chk_not "SIN sugerida inventada en chat_history" "$BODY_C" "sugerida:"
chk_has "ranked=false" "$RANK_C" "\"ranked\": false"
chk_has "orden default del catalogo (readout primero)" "$RANK_C" "\"order\": [\"cliente_readout\", \"cliente_soporte\", \"cliente_expansion\"]"
chk_has "resumen honesto sin senales" "$RANK_C" "Aún no tengo señales registradas"
chk_not "no afirma introductor" "$RANK_C" "Lo presentó"
chk_not "no afirma deal" "$RANK_C" "Deal vivo:"

echo "=============================================================="
echo "RESULTADO: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && echo "E2E G-D: TODO VERDE" || echo "E2E G-D: HAY FALLAS"
