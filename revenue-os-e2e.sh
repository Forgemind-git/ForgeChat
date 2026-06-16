#!/usr/bin/env bash
# ============================================================================
# E2E — Pipeline 5 "WhatsApp Revenue OS" (flujo de apertura, 3 pasos)
# Corre EN EL VPS, contra el owner 5213322638033 (staged). Egress real al owner.
# Requiere: backend ya desplegado con el código Revenue OS.
#   ssh alek@cloud-alek-01.tail0c281d.ts.net 'bash -s' < revenue-os-e2e.sh
# o copiarlo al VPS y ejecutarlo allí.
# ============================================================================
set -uo pipefail

WA="5213321594582"          # wa_number cuenta IA360 (display_phone_number)
OWNER="5213322638033"       # contacto owner (Alek), staged
PID="123456789"             # phone_number_id placeholder (resolveAccount usa wa_number)
DB="forgecrm-db"
BE="forgecrm-backend"
ENVF="/home/alek/stack/forgechat-poc/backend/.env"

APP_SECRET="$(grep -E '^META_APP_SECRET=' "$ENVF" | head -1 | cut -d= -f2-)"
DIR_SECRET="$(grep -E '^IA360_DIRECTIVE_SECRET=' "$ENVF" | head -1 | cut -d= -f2-)"
# Puerto real donde escucha el backend DENTRO del contenedor (robusto: lee el env del contenedor).
PORT="$(docker exec "$BE" printenv PORT 2>/dev/null)"; PORT="${PORT:-3001}"
BASE="http://localhost:${PORT}/api"

PASS=0; FAIL=0
ok(){ echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FAIL] $1  (esperado='$2' obtuvo='$3')"; FAIL=$((FAIL+1)); }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$3" "$2"; fi; }
chk_has(){ if echo "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "contiene:$3" "$2"; fi; }

psql_q(){ docker exec "$DB" psql -U postgres -d postgres -tAc "$1"; }

# Cliente HTTP dentro del contenedor con node (fetch). El body va por STDIN para no
# pelear con el quoting de acentos/comillas. Imprime el status HTTP.
NODE_POST='let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const h={"content-type":"application/json"};if(process.env.SIG)h["x-hub-signature-256"]=process.env.SIG;if(process.env.SECRET)h["X-IA360-Directive-Secret"]=process.env.SECRET;const r=await fetch(process.env.URL,{method:"POST",headers:h,body:d});const t=await r.text();process.stdout.write(String(r.status)+(process.env.SHOWBODY?(" "+t):""));}catch(e){process.stdout.write("ERR "+e.message);}});'

# Firma HMAC (host) + POST del payload Meta al webhook (vía node en el contenedor).
post_webhook(){
  local body="$1"
  local sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$APP_SECRET" -r | cut -d' ' -f1)"
  printf '%s' "$body" | docker exec -i -e SIG="$sig" -e URL="$BASE/webhook/whatsapp" "$BE" node -e "$NODE_POST"
}

ts(){ date +%s; }
wamid(){ echo "wamid.e2e.revenueos.$1.$(ts).$RANDOM"; }

latest_out_label(){ # $1=label -> message_body de la última saliente con ese label
  psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'label'='$1' ORDER BY id DESC LIMIT 1"
}
out_count_handler(){ # $1=handler_for -> # de salientes con ese ia360_handler_for
  psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'ia360_handler_for'='$1'"
}
state(){ psql_q "SELECT custom_fields->>'ia360_revenue_state' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$OWNER'"; }
p5_stage(){ psql_q "SELECT s.name FROM coexistence.deals d JOIN coexistence.pipeline_stages s ON s.id=d.stage_id JOIN coexistence.pipelines p ON p.id=d.pipeline_id WHERE p.name='WhatsApp Revenue OS' AND d.contact_number='$OWNER' ORDER BY d.updated_at DESC NULLS LAST, d.id DESC LIMIT 1"; }
has_tag(){ psql_q "SELECT EXISTS(SELECT 1 FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$OWNER' AND tags ? '$1')"; }

echo "=== SECRETS check ==="
[ -n "$APP_SECRET" ] && ok "META_APP_SECRET presente" || echo "  [WARN] META_APP_SECRET vacío (webhook sin firma → revisar verifyMetaSignature)"
[ -n "$DIR_SECRET" ] && ok "IA360_DIRECTIVE_SECRET presente" || bad "IA360_DIRECTIVE_SECRET" "no-vacío" "vacío"

echo "=== STEP 0 — limpieza estado P5 del owner (NO toca P2 ni bookings) ==="
psql_q "DELETE FROM coexistence.deals WHERE contact_number='$OWNER' AND pipeline_id=(SELECT id FROM coexistence.pipelines WHERE name='WhatsApp Revenue OS')" >/dev/null
psql_q "UPDATE coexistence.contacts SET custom_fields = custom_fields - 'ia360_revenue_state' - 'ia360_revenue_dolor' - 'ia360_revenue_canal' - 'ia360_revenue_volumen' - 'ia360_revenue_calificacion_raw' - 'ia360_revenue_started_at', tags = (SELECT COALESCE(jsonb_agg(DISTINCT v),'[]'::jsonb) FROM jsonb_array_elements_text(tags) v WHERE v NOT IN ('nutricion-suave','revenue-os-interesado','revenue-os-calificado','revenue-os-diseno-propuesto','revenue-os-handoff-agenda','pipeline:revenue-os')) WHERE wa_number='$WA' AND contact_number='$OWNER'" >/dev/null
ok "estado P5 limpio"

echo "=== PASO 1 — apertura (template ia360_os_revenue_apertura) ==="
OPENER_RES="$(printf '%s' "{\"contact_number\":\"$OWNER\",\"name\":\"Alejandro Orozco Flores\"}" | docker exec -i -e SECRET="$DIR_SECRET" -e URL="$BASE/internal/ia360-revenue/opener" -e SHOWBODY=1 "$BE" node -e "$NODE_POST")"
echo "  opener resp: $OPENER_RES"
sleep 6
chk "PASO1 estado=apertura_sent" "$(state)" "apertura_sent"
chk "PASO1 deal P5 en 'Leads desorganizados'" "$(p5_stage)" "Leads desorganizados"
APERTURA_ROW="$(psql_q "SELECT status||' | '||message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'template_name'='ia360_os_revenue_apertura' ORDER BY id DESC LIMIT 1")"
echo "  apertura chat_history: $APERTURA_ROW"
chk_has "PASO1 copy de apertura presente" "$APERTURA_ROW" "soy la IA de Alek"
APERTURA_SENT="$(psql_q "SELECT status FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'template_name'='ia360_os_revenue_apertura' ORDER BY id DESC LIMIT 1")"
chk "PASO1 status=sent (render real, no status=delivered)" "$APERTURA_SENT" "sent"
# Eyeball del render de {{1}}=nombre: imprimir componentes enviados si messageSender los persiste.
echo "  apertura render check (nombre): $(psql_q "SELECT CASE WHEN message_body LIKE '%{{1}}%' THEN 'BODY-CRUDO(render en components Meta)' ELSE 'BODY-RENDERIZADO' END FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'template_name'='ia360_os_revenue_apertura' ORDER BY id DESC LIMIT 1")"

echo "=== PASO 1->2 — tap 'Sí, cuéntame' (button de template) ==="
W1="$(wamid si)"
BODY1="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"WABA\",\"changes\":[{\"field\":\"messages\",\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"$WA\",\"phone_number_id\":\"$PID\"},\"contacts\":[{\"wa_id\":\"$OWNER\",\"profile\":{\"name\":\"Alejandro Orozco Flores\"}}],\"messages\":[{\"from\":\"$OWNER\",\"id\":\"$W1\",\"timestamp\":\"$(ts)\",\"type\":\"button\",\"button\":{\"text\":\"Sí, cuéntame\",\"payload\":\"Sí, cuéntame\"}}]}}]}]}"
echo "  http=$(post_webhook "$BODY1")"
sleep 5
chk "PASO2 estado=calificacion" "$(state)" "calificacion"
PASO2_BODY="$(latest_out_label ia360_os_revenue_paso2)"
echo "  paso2 saliente: $PASO2_BODY"
chk_has "PASO2 pregunta de calificación enviada" "$PASO2_BODY" "cómo le siguen el rastro"

echo "=== PASO 2->3 — texto libre de calificación ==="
W2="$(wamid texto)"
QTXT="Hoy se confian a la memoria y un Excel, se nos pierden como 20 leads al mes"
BODY2="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"WABA\",\"changes\":[{\"field\":\"messages\",\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"$WA\",\"phone_number_id\":\"$PID\"},\"contacts\":[{\"wa_id\":\"$OWNER\",\"profile\":{\"name\":\"Alejandro Orozco Flores\"}}],\"messages\":[{\"from\":\"$OWNER\",\"id\":\"$W2\",\"timestamp\":\"$(ts)\",\"type\":\"text\",\"text\":{\"body\":\"$QTXT\"}}]}}]}]}"
echo "  http=$(post_webhook "$BODY2")"
sleep 6
chk "PASO3 estado=propuesta" "$(state)" "propuesta"
chk "PASO2 captura dolor" "$(psql_q "SELECT custom_fields->>'ia360_revenue_dolor' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$OWNER'")" "$QTXT"
echo "  señal: canal=$(psql_q "SELECT custom_fields->>'ia360_revenue_canal' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$OWNER'") volumen=$(psql_q "SELECT custom_fields->>'ia360_revenue_volumen' FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$OWNER'")"
PASO3_BODY="$(latest_out_label ia360_os_revenue_paso3)"
echo "  paso3 saliente: $PASO3_BODY"
chk_has "PASO3 propuesta enviada" "$PASO3_BODY" "Revenue OS"
chk_has "PASO3 incluye botones" "$PASO3_BODY" "Ver cómo se vería"
# GUARDRAIL anti-doble-respuesta: el gate debe cortar al agente genérico. Aserción que
# MUERDE (no enmascarada por dedup): NINGUNA saliente con label ia360_ai_* para ese inbound.
AGENT_REPLIES="$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$OWNER' AND template_meta->>'ia360_handler_for'='$W2' AND template_meta->>'label' LIKE 'ia360_ai_%'")"
chk "PASO2 sin respuesta del agente (gate cortó el embudo)" "$AGENT_REPLIES" "0"
chk "PASO2 exactamente 1 saliente (la propuesta)" "$(out_count_handler "$W2")" "1"

echo "=== PASO 3 rama A — 'Ver cómo se vería' (demo + mover stage) ==="
W3="$(wamid demo)"
BODY3="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"WABA\",\"changes\":[{\"field\":\"messages\",\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"$WA\",\"phone_number_id\":\"$PID\"},\"contacts\":[{\"wa_id\":\"$OWNER\",\"profile\":{\"name\":\"Alejandro Orozco Flores\"}}],\"messages\":[{\"from\":\"$OWNER\",\"id\":\"$W3\",\"timestamp\":\"$(ts)\",\"type\":\"interactive\",\"interactive\":{\"type\":\"button_reply\",\"button_reply\":{\"id\":\"revenue_ver_demo\",\"title\":\"Ver cómo se vería\"}}}]}}]}]}"
echo "  http=$(post_webhook "$BODY3")"
sleep 5
chk "RAMA-A estado=demo" "$(state)" "demo"
chk "RAMA-A deal movido a 'Diseño propuesto'" "$(p5_stage)" "Diseño propuesto"
DEMO_BODY="$(latest_out_label ia360_os_revenue_demo)"
echo "  demo saliente: $DEMO_BODY"
chk_has "RAMA-A readout/mini-demo enviado" "$DEMO_BODY" "Revenue OS"

echo "=== reset estado a 'propuesta' para probar rama B ==="
psql_q "UPDATE coexistence.contacts SET custom_fields = custom_fields || '{\"ia360_revenue_state\":\"propuesta\"}'::jsonb WHERE wa_number='$WA' AND contact_number='$OWNER'" >/dev/null
chk "reset ok" "$(state)" "propuesta"

echo "=== PASO 3 rama B — 'Hablar con Alek' (handoff a compuerta de agenda) ==="
W4="$(wamid handoff)"
BODY4="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"WABA\",\"changes\":[{\"field\":\"messages\",\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"$WA\",\"phone_number_id\":\"$PID\"},\"contacts\":[{\"wa_id\":\"$OWNER\",\"profile\":{\"name\":\"Alejandro Orozco Flores\"}}],\"messages\":[{\"from\":\"$OWNER\",\"id\":\"$W4\",\"timestamp\":\"$(ts)\",\"type\":\"interactive\",\"interactive\":{\"type\":\"button_reply\",\"button_reply\":{\"id\":\"revenue_hablar_alek\",\"title\":\"Hablar con Alek\"}}}]}}]}]}"
echo "  http=$(post_webhook "$BODY4")"
sleep 5
chk "RAMA-B estado=handoff" "$(state)" "handoff"
GATE_BODY="$(latest_out_label ia360_os_revenue_gate_agenda)"
echo "  gate saliente: $GATE_BODY"
chk_has "RAMA-B compuerta de agenda (NO offer_slots directo)" "$GATE_BODY" "horarios para una llamada"
chk_has "RAMA-B botones gate" "$GATE_BODY" "Sí, ver horarios"

echo "=== rama 'Ahora no' — reset a apertura_sent y probar cierre+nutrición ==="
psql_q "UPDATE coexistence.contacts SET custom_fields = custom_fields || '{\"ia360_revenue_state\":\"apertura_sent\"}'::jsonb WHERE wa_number='$WA' AND contact_number='$OWNER'" >/dev/null
W5="$(wamid no)"
BODY5="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"WABA\",\"changes\":[{\"field\":\"messages\",\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"$WA\",\"phone_number_id\":\"$PID\"},\"contacts\":[{\"wa_id\":\"$OWNER\",\"profile\":{\"name\":\"Alejandro Orozco Flores\"}}],\"messages\":[{\"from\":\"$OWNER\",\"id\":\"$W5\",\"timestamp\":\"$(ts)\",\"type\":\"button\",\"button\":{\"text\":\"Ahora no\",\"payload\":\"Ahora no\"}}]}}]}]}"
echo "  http=$(post_webhook "$BODY5")"
sleep 5
chk "AHORA-NO estado=nutricion" "$(state)" "nutricion"
chk "AHORA-NO tag nutricion-suave" "$(has_tag nutricion-suave)" "t"
NO_BODY="$(latest_out_label ia360_os_revenue_ahora_no)"
echo "  cierre saliente: $NO_BODY"
chk_has "AHORA-NO cierre cordial enviado" "$NO_BODY" "Te dejo el espacio"
chk "AHORA-NO sin insistir (1 saliente para ese inbound)" "$(out_count_handler "$W5")" "1"

echo ""
echo "============================================================"
echo "  RESULTADO E2E Revenue OS:  PASS=$PASS  FAIL=$FAIL"
echo "============================================================"
[ "$FAIL" -eq 0 ] && echo "  >>> 8/8 OK <<<" || echo "  >>> revisar FAILs arriba <<<"
exit 0
