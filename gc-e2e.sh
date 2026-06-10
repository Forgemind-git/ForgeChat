#!/usr/bin/env bash
# ============================================================================
# E2E G-C — ruteo seq_*, anti-loop 100M, CTAs unicos, dedupe doble tap.
# Sims contra produccion con numeros QA (5219990000801-806). Sin contactos reales.
# Uso: bash gc-e2e.sh
# ============================================================================
set -uo pipefail

WA="5213321594582"
OWNER="5213322638033"
PID_NUM="873315362541590"
DB="forgecrm-db"
BE="forgecrm-backend"
ENVF="/home/alek/stack/forgechat-poc/backend/.env"

QA_BETA="5219990000806"      # persona beta (botones) — la crea approve-send-e2e.sh
QA_REFERIDO="5219990000802"  # persona referido (botones)
QA_CLIENTE="5219990000803"   # persona cliente (lista)
QA_ALIADO="5219990000801"    # alias CTA "Si, cuentame" (pf.send presente)
QA_LOOP="5219990000805"      # anti-loop 100M

APP_SECRET="$(grep -E '^META_APP_SECRET=' "$ENVF" | head -1 | cut -d= -f2-)"
PORT="$(docker exec "$BE" printenv PORT 2>/dev/null)"; PORT="${PORT:-3011}"
BASE="http://localhost:${PORT}/api"

PASS=0; FAIL=0
ok(){ echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FAIL] $1  (obtuvo='$2' esperado~'$3')"; FAIL=$((FAIL+1)); }
chk_has(){ if echo "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "$2" "$3"; fi; }
chk_not(){ if echo "$2" | grep -qF "$3"; then bad "$1" "contiene $3" "sin $3"; else ok "$1"; fi; }
chk_eq(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }

psql_q(){ docker exec "$DB" psql -U postgres -d postgres -tAc "$1"; }

NODE_POST='let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const h={"content-type":"application/json"};if(process.env.SIG)h["x-hub-signature-256"]=process.env.SIG;const r=await fetch(process.env.URL,{method:"POST",headers:h,body:d});await r.text();process.stdout.write(String(r.status));}catch(e){process.stdout.write("ERR "+e.message);}});'

post_webhook(){
  local body="$1"
  local sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$APP_SECRET" -r | cut -d' ' -f1)"
  printf '%s' "$body" | docker exec -i -e SIG="$sig" -e URL="$BASE/webhook/whatsapp" "$BE" node -e "$NODE_POST"
}

ts(){ date +%s; }
WB="wamid.e2e.gc.$(ts)"

inject_button(){ # $1=from $2=reply_id $3=title
  local body="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"e2e\",\"changes\":[{\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"$WA\",\"phone_number_id\":\"$PID_NUM\"},\"contacts\":[{\"profile\":{\"name\":\"QA\"},\"wa_id\":\"$1\"}],\"messages\":[{\"from\":\"$1\",\"id\":\"$WB.$RANDOM\",\"timestamp\":\"$(ts)\",\"type\":\"interactive\",\"interactive\":{\"type\":\"button_reply\",\"button_reply\":{\"id\":\"$2\",\"title\":\"$3\"}}}]},\"field\":\"messages\"}]}]}"
  post_webhook "$body"
}
inject_list(){ # $1=from $2=row_id $3=title
  local body="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"e2e\",\"changes\":[{\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"$WA\",\"phone_number_id\":\"$PID_NUM\"},\"contacts\":[{\"profile\":{\"name\":\"QA\"},\"wa_id\":\"$1\"}],\"messages\":[{\"from\":\"$1\",\"id\":\"$WB.$RANDOM\",\"timestamp\":\"$(ts)\",\"type\":\"interactive\",\"interactive\":{\"type\":\"list_reply\",\"list_reply\":{\"id\":\"$2\",\"title\":\"$3\"}}}]},\"field\":\"messages\"}]}]}"
  post_webhook "$body"
}
inject_tpl_button(){ # $1=from $2=payload_texto (quick reply de template)
  local body="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"e2e\",\"changes\":[{\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"$WA\",\"phone_number_id\":\"$PID_NUM\"},\"contacts\":[{\"profile\":{\"name\":\"QA\"},\"wa_id\":\"$1\"}],\"messages\":[{\"from\":\"$1\",\"id\":\"$WB.$RANDOM\",\"timestamp\":\"$(ts)\",\"type\":\"button\",\"button\":{\"payload\":\"$2\",\"text\":\"$2\"}}]},\"field\":\"messages\"}]}]}"
  post_webhook "$body"
}

last_out(){ # $1=contact — ultimo saliente
  psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$1' ORDER BY id DESC LIMIT 1"
}
last_out_label(){ # $1=contact $2=label
  psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$1' AND template_meta->>'label'='$2' ORDER BY id DESC LIMIT 1"
}
stage_of(){ # $1=contact
  psql_q "SELECT s.name FROM coexistence.deals d JOIN coexistence.pipeline_stages s ON s.id=d.stage_id JOIN coexistence.pipelines p ON p.id=d.pipeline_id WHERE p.name='IA360 WhatsApp Revenue Pipeline' AND d.contact_number='$1' ORDER BY d.updated_at DESC NULLS LAST, d.id DESC LIMIT 1"
}
seq_resp(){ # $1=contact
  psql_q "SELECT custom_fields->'ia360_seq_last_response' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$1'"
}

echo "=============================================================="
echo "TEST 1 — seq_* BOTONES persona beta ($QA_BETA): si_pregunta -> paso 2"
echo "=============================================================="
ST=$(inject_button "$QA_BETA" "seq_beta_architectura:si_pregunta" "Sí, pregúntame"); chk_eq "HTTP" "$ST" "200"
sleep 7
R=$(last_out_label "$QA_BETA" "ia360_seq_step2_beta_architectura_si_pregunta")
chk_has "paso 2 de la secuencia enviado" "$R" "Va la pregunta"
SR=$(seq_resp "$QA_BETA"); chk_has "respuesta registrada en custom_fields" "$SR" "si_pregunta"
chk_not "no cayo al fallback generico" "$(last_out "$QA_BETA")" "la estoy ubicando"

echo "=============================================================="
echo "TEST 2 — seq_* BOTONES persona referido ($QA_REFERIDO): horarios -> agenda"
echo "=============================================================="
ST=$(inject_button "$QA_REFERIDO" "seq_referido_permiso_agenda:horarios" "Proponme horarios"); chk_eq "HTTP" "$ST" "200"
sleep 7
R=$(last_out_label "$QA_REFERIDO" "ia360_seq_horarios_referido_permiso_agenda")
chk_has "pregunta de ventana de agenda enviada" "$R" "ventana te acomoda"
chk_eq "deal en Agenda en proceso" "$(stage_of "$QA_REFERIDO")" "Agenda en proceso"
SR=$(seq_resp "$QA_REFERIDO"); chk_has "respuesta registrada" "$SR" "horarios"

echo "=============================================================="
echo "TEST 3 — seq_* LISTA persona cliente ($QA_CLIENTE): datos -> acuse especifico"
echo "=============================================================="
ST=$(inject_list "$QA_CLIENTE" "seq_cliente_expansion:datos" "Datos y reportes"); chk_eq "HTTP" "$ST" "200"
sleep 7
R=$(last_out_label "$QA_CLIENTE" "ia360_seq_ack_cliente_expansion_datos")
chk_has "acuse especifico con eco del tema" "$R" "Datos y reportes"
SR=$(seq_resp "$QA_CLIENTE"); chk_has "respuesta registrada" "$SR" "cliente_expansion"
OWN=$(psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'label'='owner_seq_reply_cliente_expansion' ORDER BY id DESC LIMIT 1")
chk_has "owner notificado con next action" "$OWN" "Next action"

echo "=============================================================="
echo "TEST 4 — alias CTA template ($QA_ALIADO): 'Sí, cuéntame' -> id seq_* unico"
echo "=============================================================="
ST=$(inject_tpl_button "$QA_ALIADO" "Sí, cuéntame"); chk_eq "HTTP" "$ST" "200"
sleep 7
R=$(last_out_label "$QA_ALIADO" "ia360_seq_step2_aliado_mapa_colaboracion_si_pregunta")
chk_has "alias ruteo a paso 2 de aliado (NO Revenue OS, NO fallback)" "$R" "clientes atiendes"
chk_not "no cayo al fallback generico" "$(last_out "$QA_ALIADO")" "la estoy ubicando"
REV=$(psql_q "SELECT coalesce(custom_fields->>'ia360_revenue_state','') FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$QA_ALIADO'")
chk_eq "no abrio flujo Revenue OS" "$REV" ""

echo "=============================================================="
echo "TEST 5 — anti-loop 100M ($QA_LOOP)"
echo "=============================================================="
echo "--- 5a: primer 'Estoy explorando' -> bloque completo"
ST=$(inject_button "$QA_LOOP" "100m_exploring" "Estoy explorando"); chk_eq "HTTP" "$ST" "200"
sleep 7
R=$(last_out_label "$QA_LOOP" "ia360_100m_explorando")
chk_has "primera visita: bloque exploracion completo" "$R" "modo exploración"
echo "--- 5b: segundo 'Estoy explorando' -> version condensada"
ST=$(inject_button "$QA_LOOP" "100m_exploring" "Estoy explorando"); chk_eq "HTTP" "$ST" "200"
sleep 7
R=$(last_out_label "$QA_LOOP" "ia360_100m_condensed")
chk_has "visita repetida: condensado con salidas terminales" "$R" "Eso ya lo vimos"
echo "--- 5c: 'WhatsApp -> CRM' primera y repetida"
ST=$(inject_button "$QA_LOOP" "100m_wa_crm" "WhatsApp → CRM"); chk_eq "HTTP" "$ST" "200"
sleep 7
R1=$(last_out_label "$QA_LOOP" "ia360_100m_mecanismo-whatsapp-crm")
chk_has "primera visita mecanismo completo" "$R1" "clasifica"
ST=$(inject_button "$QA_LOOP" "100m_wa_crm" "WhatsApp → CRM"); chk_eq "HTTP" "$ST" "200"
sleep 7
N_COND=$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA_LOOP' AND template_meta->>'label'='ia360_100m_condensed'")
chk_eq "mecanismo repetido tambien condensado (2 condensados)" "$N_COND" "2"
echo "--- 5d: 'No prioritario' sin boton Aplicarlo"
ST=$(inject_button "$QA_LOOP" "100m_not_priority" "No prioritario"); chk_eq "HTTP" "$ST" "200"
sleep 7
RAWNP=$(psql_q "SELECT coalesce(template_meta::text,'')||' '||coalesce(message_body,'') FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$QA_LOOP' ORDER BY id DESC LIMIT 1")
chk_not "respuesta de No prioritario sin 'Aplicarlo'" "$RAWNP" "Aplicarlo"
echo "--- 5e: avanzar a agenda y probar guard de estado"
ST=$(inject_button "$QA_LOOP" "100m_schedule" "Agendar"); chk_eq "HTTP" "$ST" "200"
sleep 7
chk_eq "deal avanzo a Agenda en proceso" "$(stage_of "$QA_LOOP")" "Agenda en proceso"
ST=$(inject_button "$QA_LOOP" "100m_want_map" "Quiero mapa"); chk_eq "HTTP" "$ST" "200"
sleep 7
R=$(last_out_label "$QA_LOOP" "ia360_100m_continuity")
chk_has "boton viejo con estado avanzado -> continuidad (no reabre)" "$R" "ya va más adelante"
chk_eq "deal NO retrocedio" "$(stage_of "$QA_LOOP")" "Agenda en proceso"

echo ""
echo "=== RESULTADO G-C: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && exit 0 || exit 1
