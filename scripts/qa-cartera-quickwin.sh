#!/usr/bin/env bash
# ============================================================================
# qa-cartera-quickwin.sh — E2E del quick-win "Mapa de cartera" (G-WIN, P7).
#
# route_type: forgechat_monolith_e2e (starter real: inbound HMAC al webhook).
# Solo números QA 52199900*. El bot 5213321594582 nunca es contacto. Cero
# egress a contactos reales (Andrés 5213321060293 queda intacto; se audita).
#
# Escenario (contacto QA 5219990000808, persona cliente_activo/CFO):
#   T1 gate tema:    mensaje no-cartera NO dispara el flujo.
#   T2 PASO 1:       "saldos no cuadran" → Hallazgo/Impacto/Dato faltante/
#                    Siguiente acción; estado esperando_tabla; nota en deal.
#   T3 media:        imagen durante esperando_tabla → pide versión en texto.
#   T4 PASO 2:       tabla pegada → mapa + deal a "Quick win entregado" +
#                    ia360_docs_sync + readout al owner.
#   T5 gate persona: contacto NO cliente_activo (QA Aliado Uno) con texto de
#                    cartera NO dispara el flujo.
#   T6 cero egress:  0 salientes a Andrés real desde el deploy.
# ============================================================================
set -uo pipefail

WA="5213321594582"
PID_NUM="873315362541590"
QA="5219990000808"            # QA CFO Cartera (cliente_activo)
QA_NEG="5219990000801"        # QA Aliado Uno (aliado_socio — NO cliente)
ANDRES="5213321060293"        # contacto REAL: debe quedar en cero egress
OWNER="5213322638033"
DEPLOY_TS="${DEPLOY_TS:-2026-06-10T23:54:00Z}"
DB="forgecrm-db"
BE="forgecrm-backend"
REPO="/home/alek/stack/forgechat-poc"
ENVF="$REPO/backend/.env"

APP_SECRET="$(grep -E '^META_APP_SECRET=' "$ENVF" | head -1 | cut -d= -f2-)"
[ -n "$APP_SECRET" ] || { echo "ABORT: META_APP_SECRET vacío" >&2; exit 2; }
PORT="$(docker exec "$BE" printenv PORT 2>/dev/null)"; PORT="${PORT:-3011}"
BASE="http://localhost:${PORT}/api"
TEST_RUN="qa-cartera.$(date +%s)"
PASS=0; FAIL=0

psql_q(){ docker exec "$DB" psql -U postgres -d postgres -tAc "$1"; }
NODE_POST='let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const h={"content-type":"application/json"};if(process.env.SIG)h["x-hub-signature-256"]=process.env.SIG;const r=await fetch(process.env.URL,{method:"POST",headers:h,body:d});process.stdout.write(String(r.status));}catch(e){process.stdout.write("ERR "+e.message);}});'
post_webhook(){
  local body="$1"
  local sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$APP_SECRET" -r | cut -d' ' -f1)"
  printf '%s' "$body" | docker exec -i -e SIG="$sig" -e URL="$BASE/webhook/whatsapp" "$BE" node -e "$NODE_POST"
}
ts(){ date +%s; }
wamid(){ echo "wamid.${TEST_RUN}.$1.$(ts).$RANDOM"; }
_envelope(){
  printf '{"object":"whatsapp_business_account","entry":[{"id":"qa-harness","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"%s","phone_number_id":"%s"},"contacts":[{"wa_id":"%s","profile":{"name":"%s"}}],"messages":[%s]}}]}]}' "$WA" "$PID_NUM" "$1" "$2" "$3"
}
inject_text(){ # $1=from $2=texto(JSON-escapado, \n permitido) $3=profile
  post_webhook "$(_envelope "$1" "${3:-QA Harness}" "{\"from\":\"$1\",\"id\":\"$(wamid txt)\",\"timestamp\":\"$(ts)\",\"type\":\"text\",\"text\":{\"body\":\"$2\"}}")"
}
inject_image(){ # $1=from $2=profile
  post_webhook "$(_envelope "$1" "${2:-QA Harness}" "{\"from\":\"$1\",\"id\":\"$(wamid img)\",\"timestamp\":\"$(ts)\",\"type\":\"image\",\"image\":{\"id\":\"qa-fake-media-$(ts)\",\"mime_type\":\"image/jpeg\",\"sha256\":\"qa\"}}")"
}
max_out_id(){ psql_q "SELECT COALESCE(MAX(id),0) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$1'"; }
fresh_label_body(){ psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$1' AND id>$3 AND template_meta->>'label'='$2' ORDER BY id DESC LIMIT 1"; }
fresh_cartera_count(){ psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$1' AND id>$2 AND template_meta->>'label' LIKE 'ia360_cartera%'"; }
cartera_state(){ psql_q "SELECT COALESCE(custom_fields->>'ia360_cartera_state','') FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$1'"; }
deal_stage(){ psql_q "SELECT s.name FROM coexistence.deals d JOIN coexistence.pipeline_stages s ON s.id=d.stage_id WHERE d.pipeline_id=7 AND d.contact_number='$1' ORDER BY d.updated_at DESC NULLS LAST, d.id DESC LIMIT 1"; }
chk(){ # $1=nombre $2=obtenido $3=esperado
  if [ "$2" = "$3" ]; then echo "PASS  $1 = '$2'"; PASS=$((PASS+1));
  else echo "FAIL  $1: esperado '$3', obtenido '$2'"; FAIL=$((FAIL+1)); fi
}
chk_contains(){ # $1=nombre $2=haystack $3=needle
  if printf '%s' "$2" | grep -qF "$3"; then echo "PASS  $1 contiene '$3'"; PASS=$((PASS+1));
  else echo "FAIL  $1 NO contiene '$3'"; FAIL=$((FAIL+1)); fi
}

echo "== Setup: contacto QA CFO Cartera ($QA) + deal P7 en 'Validación en curso' =="
psql_q "INSERT INTO coexistence.contacts (wa_number, contact_number, name, tags, custom_fields, created_at, updated_at)
        VALUES ('$WA','$QA','QA CFO Cartera','[\"persona:cliente_activo\",\"staged\",\"qa-cartera\"]'::jsonb,'{\"persona_context\":\"Cliente activo\",\"staged\":true}'::jsonb,NOW(),NOW())
        ON CONFLICT (wa_number, contact_number) DO UPDATE SET
          name='QA CFO Cartera',
          tags=(SELECT COALESCE(jsonb_agg(DISTINCT v),'[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(coexistence.contacts.tags,'[]'::jsonb) || EXCLUDED.tags) v),
          custom_fields=COALESCE(coexistence.contacts.custom_fields,'{}'::jsonb) || EXCLUDED.custom_fields,
          updated_at=NOW()"
psql_q "INSERT INTO coexistence.deals (pipeline_id, stage_id, title, value, currency, status, contact_wa_number, contact_number, contact_name, notes, position, created_by, assigned_user_id)
        SELECT 7, 54, 'IA360 · QA CFO Cartera · Quick win cartera', 0, 'MXN', 'open', '$WA', '$QA', 'QA CFO Cartera',
               '[setup QA] deal staged para E2E G-WIN mapa de cartera', COALESCE((SELECT MAX(position)+1 FROM coexistence.deals WHERE stage_id=54),0),
               (SELECT id FROM coexistence.forgecrm_users WHERE role='admin' ORDER BY id LIMIT 1),
               (SELECT id FROM coexistence.forgecrm_users WHERE role='admin' ORDER BY id LIMIT 1)
        WHERE NOT EXISTS (SELECT 1 FROM coexistence.deals WHERE pipeline_id=7 AND contact_number='$QA')"
# Estado limpio del flujo para corrida repetible
psql_q "UPDATE coexistence.contacts SET custom_fields = custom_fields - 'ia360_cartera_state' - 'ia360_cartera_dolor' - 'ia360_cartera_tabla_raw' WHERE wa_number='$WA' AND contact_number='$QA'"
psql_q "UPDATE coexistence.deals SET stage_id=54, status='open' WHERE pipeline_id=7 AND contact_number='$QA'"
echo "deal QA: $(deal_stage "$QA")"

echo ""
echo "== T1 · GATE TEMA: mensaje no-cartera NO dispara el flujo =="
B1=$(max_out_id "$QA")
chk "T1 HTTP" "$(inject_text "$QA" "Hola, ¿me recomiendas un libro de liderazgo para mi equipo de finanzas?" "QA CFO Cartera")" "200"
sleep 4
chk "T1 salientes ia360_cartera*" "$(fresh_cartera_count "$QA" "$B1")" "0"
chk "T1 estado cartera" "$(cartera_state "$QA")" ""

echo ""
echo "== T2 · PASO 1: saldos que no cuadran → Hallazgo/Impacto/Dato faltante/Siguiente acción =="
B2=$(max_out_id "$QA")
chk "T2 HTTP" "$(inject_text "$QA" "Oye, los saldos de cartera que muestra el portal no cuadran con lo que tenemos en contabilidad. Traigo varias cuentas mal." "QA CFO Cartera")" "200"
sleep 4
P1=$(fresh_label_body "$QA" "ia360_cartera_paso1" "$B2")
chk_contains "T2 respuesta" "$P1" "*Hallazgo:*"
chk_contains "T2 respuesta" "$P1" "*Impacto:*"
chk_contains "T2 respuesta" "$P1" "*Dato faltante:*"
chk_contains "T2 respuesta" "$P1" "*Siguiente acción:*"
chk_contains "T2 respuesta pide tabla" "$P1" "Cliente | Saldo en portal | Saldo correcto | Fecha de corte | Responsable"
chk_contains "T2 respuesta avisa imágenes" "$P1" "no puedo leer imágenes"
case "$P1" in *agenda*|*llamada*|*horario*) echo "FAIL  T2 contiene agenda/pitch"; FAIL=$((FAIL+1));; *) echo "PASS  T2 sin agenda ni pitch"; PASS=$((PASS+1));; esac
chk "T2 estado" "$(cartera_state "$QA")" "esperando_tabla"

echo ""
echo "== T3 · MEDIA: imagen durante esperando_tabla → pide versión en texto =="
B3=$(max_out_id "$QA")
chk "T3 HTTP" "$(inject_image "$QA" "QA CFO Cartera")" "200"
sleep 4
P3=$(fresh_label_body "$QA" "ia360_cartera_pide_texto" "$B3")
chk_contains "T3 respuesta" "$P3" "no puedo leer imágenes ni documentos"
chk "T3 estado sigue" "$(cartera_state "$QA")" "esperando_tabla"

echo ""
echo "== T4 · PASO 2: tabla pegada → mapa + deal + docs_sync + readout owner =="
B4=$(max_out_id "$QA")
BO=$(max_out_id "$OWNER")
DS=$(psql_q "SELECT COALESCE(MAX(id),0) FROM coexistence.ia360_docs_sync")
TABLA='Cliente | Saldo en portal | Saldo correcto | Fecha de corte | Responsable\nTransportes del Bajío | 1,250,000.00 | 980,000.00 | 31/05/2026 | Laura\nLogística Occidente | 430,500.00 | 512,300.00 | 31/05/2026 | Marco\nGrúas y Plataformas GDL | 88,000.00 | 88,000.00 | 31/05/2026 | Laura'
chk "T4 HTTP" "$(inject_text "$QA" "$TABLA" "QA CFO Cartera")" "200"
sleep 5
P4=$(fresh_label_body "$QA" "ia360_cartera_mapa" "$B4")
chk_contains "T4 mapa" "$P4" "*Mapa de cartera — saldos por corregir*"
chk_contains "T4 mapa cuenta 1" "$P4" "Cuenta: Transportes del Bajío"
chk_contains "T4 mapa diferencia 1" "$P4" "Diferencia: -\$270,000.00"
chk_contains "T4 mapa responsable" "$P4" "confirmarlo con Laura"
chk_contains "T4 mapa resumen" "$P4" "Cuentas con descuadre: 2 de 3"
chk "T4 estado" "$(cartera_state "$QA")" "mapa_entregado"
chk "T4 deal stage" "$(deal_stage "$QA")" "Quick win entregado"
DSROW=$(psql_q "SELECT titulo FROM coexistence.ia360_docs_sync WHERE id>$DS AND destino='AlekContenido' ORDER BY id DESC LIMIT 1")
chk_contains "T4 docs_sync" "$DSROW" "Mapa de cartera — QA CFO Cartera"
RO=$(fresh_label_body "$OWNER" "owner_cartera_readout" "$BO")
chk_contains "T4 readout owner" "$RO" "Quick win cartera — QA CFO Cartera"
chk_contains "T4 readout owner deal" "$RO" "Quick win entregado"

echo ""
echo "== T5 · GATE PERSONA: aliado (NO cliente) con texto de cartera NO dispara =="
B5=$(max_out_id "$QA_NEG")
chk "T5 HTTP" "$(inject_text "$QA_NEG" "Los saldos de la cartera del portal no cuadran, hay diferencias." "QA Aliado Uno")" "200"
sleep 4
chk "T5 salientes ia360_cartera*" "$(fresh_cartera_count "$QA_NEG" "$B5")" "0"
chk "T5 estado cartera" "$(cartera_state "$QA_NEG")" ""

echo ""
echo "== T6 · CERO EGRESS a Andrés real ($ANDRES) desde el deploy =="
chk "T6 salientes a Andrés" "$(psql_q "SELECT count(*) FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$ANDRES' AND created_at >= '$DEPLOY_TS'")" "0"
echo "Deals Nexus P7 (16-24) — deben seguir en Validación en curso:"
psql_q "SELECT d.id || ' | ' || s.name || ' | updated=' || d.updated_at FROM coexistence.deals d JOIN coexistence.pipeline_stages s ON s.id=d.stage_id WHERE d.pipeline_id=7 AND d.id BETWEEN 16 AND 24 ORDER BY d.id"

echo ""
echo "=============================================================="
echo "RESULTADO: PASS=$PASS FAIL=$FAIL test_run=$TEST_RUN"
echo "=============================================================="
[ "$FAIL" -eq 0 ]
