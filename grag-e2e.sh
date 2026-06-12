#!/usr/bin/env bash
# ============================================================================
# E2E G-RAG — puente seguro AlekContenido ↔ RAG IA360 (2026-06-11)
#   SIM 1 — Indexador: vault-bridge --scan puebla ia360_vault_notes (≥100 notas,
#           teléfono de JR bien, Andrés sin teléfono, blocklist limpia).
#   SIM 2 — JR: auto-match por teléfono + enriquecimiento (facts Konforthome)
#           + el expediente del owner refleja los facts del vault.
#   SIM 3 — Andrés: sin teléfono → tarjeta de candidatos al owner; dos taps
#           owner_vlink sellan las 2 notas, cada fact en su jaula de proyecto.
#   SIM 4 — JAULA multi-proyecto: el agente solo ve facts del proyecto activo
#           (negativo duro: jamás cita la clave del otro proyecto).
#   SIM 5 — Round-trip vinculado: docs_sync → append a la nota vinculada
#           (marcador GRAG-RT-757 + idempotencia por id).
#   SIM 6 — Drena las 2 filas reales (id 1 y 2) a Areas/CRM/contactos/
#           (entregable real, NO se borra).
# Uso: bash grag-e2e.sh   (correr en el VPS desde /home/alek/stack/forgechat-poc).
# Solo números QA + owner sintético; todo egress al owner queda qa_sandboxed.
# ============================================================================
set -uo pipefail

WA="5213321594582"
OWNER="5213322638033"
PID_NUM="873315362541590"
DB="forgecrm-db"
BE="forgecrm-backend"
ENVF="/home/alek/stack/forgechat-poc/backend/.env"
BRIDGE="/home/alek/stack/forgechat-poc/scripts/vault-bridge.js"
VAULT="/home/alek/vault-git-backup"
QA1="5219990000961"   # QA jaula multi-proyecto (cliente activo beta sintético)
QA2="5219990000962"   # QA round-trip vinculado (SIM 5)
JR_NUM="5213319706935"
JR_ID="899"
JR_NOTE="Areas/Proyectos/Konforthome/stakeholders/jose-ramon-reyes.md"
AND_NUM="5213321060293"
AND_ID="544"
AND_NOTE_CAM="Areas/Proyectos/Camiones-Selectos/stakeholders/andres-valencia.md"
AND_NOTE_META="Areas/Proyectos/0Prospectos/ArrendadoraMETA/stakeholders/andres-valencia.md"

APP_SECRET="$(grep -E '^META_APP_SECRET=' "$ENVF" | head -1 | cut -d= -f2-)"
PORT="$(docker exec "$BE" printenv PORT 2>/dev/null)"; PORT="${PORT:-3011}"
BASE="http://localhost:${PORT}/api"

PASS=0; FAIL=0
ok(){ echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad(){ echo "  [FAIL] $1  (esperado='$3' obtuvo='$2')"; FAIL=$((FAIL+1)); }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }
chk_nonempty(){ if [ -n "$2" ]; then ok "$1"; else bad "$1" "(vacío)" "no-vacío"; fi; }
chk_match(){ if echo "$2" | grep -qiE "$3"; then ok "$1"; else bad "$1" "$(echo "$2" | head -c 160)" "matchea:$3"; fi; }
chk_ge(){ if [ "${2:-0}" -ge "$3" ] 2>/dev/null; then ok "$1 ($2)"; else bad "$1" "${2:-0}" ">=$3"; fi; }

psql_q(){ docker exec "$DB" psql -U postgres -d postgres -tAc "$1"; }

NODE_POST='let d="";process.stdin.on("data",c=>d+=c).on("end",async()=>{try{const h={"content-type":"application/json"};if(process.env.SIG)h["x-hub-signature-256"]=process.env.SIG;const r=await fetch(process.env.URL,{method:"POST",headers:h,body:d});const t=await r.text();process.stdout.write(String(r.status));}catch(e){process.stdout.write("ERR "+e.message);}});'

post_webhook(){
  local body="$1"
  local sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$APP_SECRET" -r | cut -d' ' -f1)"
  printf '%s' "$body" | docker exec -i -e SIG="$sig" -e URL="$BASE/webhook/whatsapp" "$BE" node -e "$NODE_POST"
}

ts(){ date +%s; }

text_payload(){ # $1=from $2=wamid $3=texto $4=nombre
  printf '{"object":"whatsapp_business_account","entry":[{"id":"WABA","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"%s","phone_number_id":"%s"},"contacts":[{"wa_id":"%s","profile":{"name":"%s"}}],"messages":[{"from":"%s","id":"%s","timestamp":"%s","type":"text","text":{"body":"%s"}}]}}]}]}' \
    "$WA" "$PID_NUM" "$1" "$4" "$1" "$2" "$(ts)" "$3"
}

list_reply_payload(){ # $1=from $2=wamid $3=reply_id $4=title — tap de lista (mismo envelope que text_payload)
  printf '{"object":"whatsapp_business_account","entry":[{"id":"WABA","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"%s","phone_number_id":"%s"},"contacts":[{"wa_id":"%s","profile":{"name":"Alek"}}],"messages":[{"from":"%s","id":"%s","timestamp":"%s","type":"interactive","interactive":{"type":"list_reply","list_reply":{"id":"%s","title":"%s"}}}]}}]}]}' \
    "$WA" "$PID_NUM" "$1" "$1" "$2" "$(ts)" "$3" "$4"
}

max_id(){ psql_q "SELECT COALESCE(MAX(id),0) FROM coexistence.chat_history"; }

owner_text(){ # $1=texto — texto sintético del owner (wamid e2e ⇒ sandbox QA)
  local W="wamid.e2e.grag.$(ts).$RANDOM"
  post_webhook "$(text_payload "$OWNER" "$W" "$1" "Alek")" >/dev/null
}

wait_owner_sandboxed(){ # $1=min_id $2=label_like $3=timeout_s → message_body
  local deadline=$(( $(date +%s) + ${3:-60} )); local body=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    body=$(psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND to_number='$OWNER' AND status='qa_sandboxed' AND template_meta->>'label' LIKE '$2' AND id > $1 ORDER BY id ASC LIMIT 1")
    [ -n "$body" ] && { printf '%s' "$body"; return 0; }
    sleep 3
  done
  printf '%s' ""
}

wait_qa_reply(){ # $1=contacto $2=min_id $3=timeout_s → primer outgoing al contacto
  local deadline=$(( $(date +%s) + ${3:-90} )); local body=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    body=$(psql_q "SELECT message_body FROM coexistence.chat_history WHERE direction='outgoing' AND contact_number='$1' AND id > $2 ORDER BY id ASC LIMIT 1")
    [ -n "$body" ] && { printf '%s' "$body"; return 0; }
    sleep 5
  done
  printf '%s' ""
}

echo "=== STEP 0 — limpieza QA (números 521999*, facts y nota qa-grag) ==="
for q in "$QA1" "$QA2"; do
  psql_q "DELETE FROM coexistence.ia360_vault_links WHERE contact_number='$q'" >/dev/null
  psql_q "DELETE FROM coexistence.ia360_memory_facts WHERE contact_number='$q'" >/dev/null
  psql_q "DELETE FROM coexistence.chat_history WHERE contact_number='$q'" >/dev/null
  psql_q "DELETE FROM coexistence.deals WHERE contact_number='$q'" >/dev/null
  psql_q "DELETE FROM coexistence.contacts WHERE contact_number='$q'" >/dev/null
done
psql_q "DELETE FROM coexistence.ia360_memory_facts WHERE fact_key LIKE 'alekcontenido:%qa-grag%' OR fact_key LIKE 'grag-e2e-%'" >/dev/null
psql_q "DELETE FROM coexistence.ia360_docs_sync WHERE titulo='QA GRAG roundtrip'" >/dev/null
psql_q "DELETE FROM coexistence.ia360_ideas WHERE texto LIKE '%GRAG-RT-757%'" >/dev/null
psql_q "DELETE FROM coexistence.ia360_vault_links WHERE note_path LIKE '%qa-grag%'" >/dev/null
psql_q "DELETE FROM coexistence.ia360_vault_notes WHERE note_path LIKE '%qa-grag%'" >/dev/null
rm -f "$VAULT/Areas/CRM/contactos/qa-grag-sandbox-contacto.md"
# Re-runnabilidad: los SIM 2/3 reconstruyen desde cero los artefactos G-RAG de
# los pilotos (links + facts del vault, NUNCA su memoria de WhatsApp).
psql_q "DELETE FROM coexistence.ia360_vault_links WHERE forgechat_contact_id IN ($JR_ID, $AND_ID)" >/dev/null
psql_q "DELETE FROM coexistence.ia360_memory_facts WHERE source='alekcontenido' AND contact_number IN ('$JR_NUM','$AND_NUM')" >/dev/null
psql_q "UPDATE coexistence.contacts SET custom_fields = COALESCE(custom_fields,'{}'::jsonb) || '{\"rag_enriched_at\":\"\",\"ia360_vault_checked\":\"\",\"ia360_vault_offered\":\"\",\"ia360_vault_none\":\"\"}'::jsonb WHERE contact_number IN ('$JR_NUM','$AND_NUM')" >/dev/null
echo "  limpieza lista"

echo ""
echo "=== SIM 1 — indexador: vault-bridge --scan ==="
node "$BRIDGE" --scan
N1=$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_vault_notes WHERE missing_since IS NULL")
chk_ge "SIM1 notas vivas indexadas" "$N1" 100
T1=$(psql_q "SELECT telefono_wa FROM coexistence.ia360_vault_notes WHERE note_path='$JR_NOTE'")
chk "SIM1 nota de JR con telefono_wa" "$T1" "$JR_NUM"
A1=$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_vault_notes WHERE note_path IN ('$AND_NOTE_CAM','$AND_NOTE_META') AND telefono_wa IS NULL")
chk "SIM1 las 2 notas de Andrés sin telefono_wa" "$A1" "2"
B1=$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_vault_notes WHERE telefono_wa='$WA' OR telefono_wa='$OWNER' OR telefono_wa LIKE '521999%'")
chk "SIM1 cero notas con teléfono de bot/owner/QA" "$B1" "0"
E1=$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_vault_links WHERE note_path='$JR_NOTE' AND forgechat_contact_id <> $JR_ID")
chk "SIM1 nota de JR jamás vinculada a otro contacto" "$E1" "0"

echo ""
echo "=== SIM 2 — JR: auto-match por teléfono + enriquecimiento + expediente ==="
MID=$(max_id)
owner_text "sincroniza a José Ramón"
ACK2=$(wait_owner_sandboxed "$MID" "ia360_vault_synced" 60)
chk_nonempty "SIM2 ack sincronizado (sandbox)" "$ACK2"
echo "  ack: $(echo "$ACK2" | head -c 220)"
L2=$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_vault_links WHERE forgechat_contact_id=$JR_ID AND note_path='$JR_NOTE' AND estado='vinculado' AND matched_by='telefono'")
chk "SIM2 link JR vinculado por teléfono" "$L2" "1"
F2=$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_memory_facts WHERE source='alekcontenido' AND contact_number='$JR_NUM' AND project_name='Konforthome'")
chk_ge "SIM2 facts del vault en jaula Konforthome" "$F2" 2
R2=$(psql_q "SELECT COALESCE(custom_fields->>'rag_enriched_at','') FROM coexistence.contacts WHERE contact_number='$JR_NUM' ORDER BY (wa_number='$WA') DESC LIMIT 1")
chk_nonempty "SIM2 rag_enriched_at sellado" "$R2"
MID=$(max_id)
owner_text "qué sabes de José Ramón"
DOS2=$(wait_owner_sandboxed "$MID" "owner_memory_dossier" 60)
chk_nonempty "SIM2 expediente del owner (sandbox)" "$DOS2"
chk_match "SIM2 expediente refleja fact del vault" "$DOS2" "Canal preferido|Konforthome"

echo ""
echo "=== SIM 3 — Andrés: tarjeta de candidatos + 2 taps, cada fact en su jaula ==="
NID_CAM=$(psql_q "SELECT note_id FROM coexistence.ia360_vault_notes WHERE note_path='$AND_NOTE_CAM'")
NID_META=$(psql_q "SELECT note_id FROM coexistence.ia360_vault_notes WHERE note_path='$AND_NOTE_META'")
chk_nonempty "SIM3 note_id Camiones" "$NID_CAM"
chk_nonempty "SIM3 note_id META" "$NID_META"
MID=$(max_id)
owner_text "sincroniza a Andres"
CARD3=$(wait_owner_sandboxed "$MID" "ia360_vault_candidates" 60)
chk_nonempty "SIM3 tarjeta de candidatos (sandbox)" "$CARD3"
echo "  tarjeta: $(echo "$CARD3" | head -c 220)"
chk_match "SIM3 tarjeta menciona la nota Camiones" "$CARD3" "Camiones"
chk_match "SIM3 tarjeta menciona la nota META" "$CARD3" "ArrendadoraMETA"
# Tap 1: vincular la nota de Camiones-Selectos
MID=$(max_id)
W3="wamid.e2e.grag.$(ts).$RANDOM"
post_webhook "$(list_reply_payload "$OWNER" "$W3" "owner_vlink:${AND_NUM}:${NID_CAM}" "andres valencia")" >/dev/null
ACK3=$(wait_owner_sandboxed "$MID" "ia360_vault_linked" 60)
chk_nonempty "SIM3 ack del vínculo Camiones" "$ACK3"
LC3=$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_vault_links WHERE forgechat_contact_id=$AND_ID AND note_path='$AND_NOTE_CAM' AND estado='vinculado' AND matched_by='owner_tap'")
chk "SIM3 link Camiones sellado owner_tap" "$LC3" "1"
FC3=$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_memory_facts WHERE source='alekcontenido' AND contact_number='$AND_NUM' AND project_name='Camiones-Selectos'")
chk_ge "SIM3 facts en jaula Camiones-Selectos" "$FC3" 1
# Repetir el sincroniza: la tarjeta ya solo debe ofrecer la nota de META
MID=$(max_id)
owner_text "sincroniza a Andres"
SY3=$(wait_owner_sandboxed "$MID" "ia360_vault_synced" 60)
chk_nonempty "SIM3 ack synced tras el 1er vínculo" "$SY3"
CARD3B=$(wait_owner_sandboxed "$MID" "ia360_vault_candidates" 60)
chk_nonempty "SIM3 tarjeta restante (sandbox)" "$CARD3B"
chk_match "SIM3 tarjeta restante ofrece META" "$CARD3B" "ArrendadoraMETA"
if echo "$CARD3B" | grep -q "Camiones"; then bad "SIM3 tarjeta restante ya no ofrece Camiones" "menciona Camiones" "sin Camiones"; else ok "SIM3 tarjeta restante ya no ofrece Camiones"; fi
# Tap 2: vincular la nota de ArrendadoraMETA
MID=$(max_id)
W3B="wamid.e2e.grag.$(ts).$RANDOM"
post_webhook "$(list_reply_payload "$OWNER" "$W3B" "owner_vlink:${AND_NUM}:${NID_META}" "andres valencia")" >/dev/null
ACK3B=$(wait_owner_sandboxed "$MID" "ia360_vault_linked" 60)
chk_nonempty "SIM3 ack del vínculo META" "$ACK3B"
LM3=$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_vault_links WHERE forgechat_contact_id=$AND_ID AND note_path='$AND_NOTE_META' AND estado='vinculado' AND matched_by='owner_tap'")
chk "SIM3 link META sellado owner_tap" "$LM3" "1"
FM3=$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_memory_facts WHERE source='alekcontenido' AND contact_number='$AND_NUM' AND project_name='ArrendadoraMETA'")
chk_ge "SIM3 facts en jaula ArrendadoraMETA" "$FM3" 1
LT3=$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_vault_links WHERE forgechat_contact_id=$AND_ID AND estado='vinculado'")
chk "SIM3 dos links vinculados del contacto 544" "$LT3" "2"
XL3=$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_memory_facts WHERE source='alekcontenido' AND ((payload->>'note_path' LIKE '%ArrendadoraMETA%' AND project_name='Camiones-Selectos') OR (payload->>'note_path' LIKE '%Camiones-Selectos%' AND project_name='ArrendadoraMETA'))")
chk "SIM3 cero fuga inter-proyecto (fact_key/payload.note_path)" "$XL3" "0"

echo ""
echo "=== SIM 4 — JAULA multi-proyecto: el agente no ve el otro proyecto ==="
# Contacto QA cliente activo beta con proyecto 'QA Jaula Alfa' (mismo
# custom_fields beta que usan gbrain-e2e.sh/glive-e2e.sh).
psql_q "INSERT INTO coexistence.contacts (wa_number, contact_number, name, tags, custom_fields)
  VALUES ('$WA', '$QA1', 'QA Jaula Alfa Contacto',
    '[\"cliente-activo-beta\",\"staged\"]'::jsonb,
    '{\"staged\": true, \"ia360_cliente_activo_beta\": {\"schema\": \"cliente_activo_beta.v1\", \"contact_role\": \"Director de Finanzas (QA)\", \"project\": \"QA Jaula Alfa\", \"do_not_pitch\": true}}'::jsonb)
  ON CONFLICT (wa_number, contact_number) DO UPDATE SET
    name = EXCLUDED.name,
    tags = EXCLUDED.tags,
    custom_fields = coexistence.contacts.custom_fields || EXCLUDED.custom_fields" >/dev/null
psql_q "INSERT INTO coexistence.ia360_memory_facts (fact_key, contact_wa_number, contact_number, project_name, preference, confidence, status, last_seen_at) VALUES
  ('grag-e2e-jaula-alfa-$QA1', '$WA', '$QA1', 'QA Jaula Alfa', 'Clave interna del proyecto: marca-alfa-757', 0.9, 'confirmado', NOW()),
  ('grag-e2e-jaula-beta-$QA1', '$WA', '$QA1', 'QA Jaula Beta', 'Clave interna del proyecto: marca-beta-757', 0.9, 'confirmado', NOW())" >/dev/null
chk "SIM4 facts de 2 proyectos precargados" "$(psql_q "SELECT COUNT(*) FROM coexistence.ia360_memory_facts WHERE contact_number='$QA1'")" "2"
MID=$(max_id)
W4="wamid.e2e.grag.$(ts).$RANDOM"
post_webhook "$(text_payload "$QA1" "$W4" "¿Cuál es la clave interna de mi proyecto?" "QA Jaula Alfa Contacto")" >/dev/null
R4=$(wait_qa_reply "$QA1" "$MID" 90)
chk_nonempty "SIM4 reply del agente al QA" "$R4"
echo "  reply: $(echo "$R4" | head -c 220)"
if echo "$R4" | grep -q "marca-beta-757"; then
  bad "SIM4 negativo duro: jamás cita la clave Beta" "contiene marca-beta-757" "sin marca-beta-757"
else
  ok "SIM4 negativo duro: jamás cita la clave Beta"
fi
J4=$(docker logs "$BE" --since 5m 2>&1 | grep '\[ia360-jaula\]' | grep -c 'proyecto=QA Jaula Alfa' || true)
chk_ge "SIM4 log [ia360-jaula] con proyecto=QA Jaula Alfa" "$J4" 1

echo ""
echo "=== SIM 5 — round-trip vinculado: docs_sync → nota del vault ==="
NOTE5="$VAULT/Areas/CRM/contactos/qa-grag-sandbox-contacto.md"
mkdir -p "$VAULT/Areas/CRM/contactos"
cat > "$NOTE5" <<'EOF'
---
nombre: QA GRAG Sandbox
tipo: contacto
---

# QA GRAG Sandbox

Nota sintética del harness G-RAG; se elimina al final del SIM 5.
EOF
psql_q "INSERT INTO coexistence.contacts (wa_number, contact_number, name, tags, custom_fields)
  VALUES ('$WA', '$QA2', 'QA GRAG Sandbox', '[\"staged\"]'::jsonb, '{\"staged\": true}'::jsonb)
  ON CONFLICT (wa_number, contact_number) DO NOTHING" >/dev/null
CID2=$(psql_q "SELECT id FROM coexistence.contacts WHERE wa_number='$WA' AND contact_number='$QA2' LIMIT 1")
chk_nonempty "SIM5 contacto QA round-trip" "$CID2"
psql_q "INSERT INTO coexistence.ia360_vault_links (forgechat_contact_id, contact_number, note_path, project_name, estado, matched_by, confirmado_at)
  VALUES ($CID2, '$QA2', 'Areas/CRM/contactos/qa-grag-sandbox-contacto.md', NULL, 'vinculado', 'owner_tap', NOW())
  ON CONFLICT (forgechat_contact_id, note_path) DO UPDATE SET estado='vinculado', matched_by='owner_tap', confirmado_at=NOW()" >/dev/null
# head -1: psql -tAc imprime el id Y la etiqueta "INSERT 0 1" en otra línea.
IDEA_ID=$(psql_q "INSERT INTO coexistence.ia360_ideas (fuente, contact_number, texto, contexto_json) VALUES ('owner', '$QA2', 'QA GRAG roundtrip GRAG-RT-757', '{}'::jsonb) RETURNING id" | head -1)
SYNC_ID=$(psql_q "INSERT INTO coexistence.ia360_docs_sync (idea_id, titulo, contenido, destino, status) VALUES ($IDEA_ID, 'QA GRAG roundtrip', 'Marcador round-trip del harness: GRAG-RT-757', 'AlekContenido', 'queued') RETURNING id" | head -1)
chk_nonempty "SIM5 fila docs_sync queued" "$SYNC_ID"
node "$BRIDGE" --drain
if grep -q "GRAG-RT-757" "$NOTE5" 2>/dev/null; then ok "SIM5 la nota recibió el contenido (GRAG-RT-757)"; else bad "SIM5 contenido en la nota" "(sin marcador)" "GRAG-RT-757"; fi
if grep -q "ia360_docs_sync id=" "$NOTE5" 2>/dev/null; then ok "SIM5 marcador de idempotencia presente"; else bad "SIM5 marcador de idempotencia" "(sin marcador)" "ia360_docs_sync id="; fi
ST5=$(psql_q "SELECT status FROM coexistence.ia360_docs_sync WHERE id=$SYNC_ID")
chk "SIM5 fila marcada synced" "$ST5" "synced"
# Limpieza del SIM 5 (artefactos 100% sintéticos)
rm -f "$NOTE5"
psql_q "DELETE FROM coexistence.ia360_docs_sync WHERE id=$SYNC_ID" >/dev/null
psql_q "DELETE FROM coexistence.ia360_ideas WHERE id=$IDEA_ID" >/dev/null
psql_q "DELETE FROM coexistence.ia360_vault_links WHERE contact_number='$QA2'" >/dev/null
psql_q "DELETE FROM coexistence.ia360_memory_facts WHERE contact_number='$QA2'" >/dev/null
psql_q "DELETE FROM coexistence.contacts WHERE contact_number='$QA2'" >/dev/null
psql_q "DELETE FROM coexistence.ia360_vault_notes WHERE note_path LIKE '%qa-grag%'" >/dev/null
echo "  limpieza SIM 5 lista"

echo ""
echo "=== SIM 6 — drenar las 2 filas reales (id 1 y 2) — entregable real ==="
# El drain del SIM 5 procesa TODO lo queued, así que aquí puede ser no-op;
# este SIM verifica el resultado (y NO borra: los archivos son el entregable).
node "$BRIDGE" --drain
ST61=$(psql_q "SELECT status FROM coexistence.ia360_docs_sync WHERE id=1")
ST62=$(psql_q "SELECT status FROM coexistence.ia360_docs_sync WHERE id=2")
chk "SIM6 fila 1 synced" "$ST61" "synced"
chk "SIM6 fila 2 synced" "$ST62" "synced"
F61=$(grep -lF "ia360_docs_sync id=1 -->" "$VAULT/Areas/CRM/contactos/"*.md 2>/dev/null | head -1)
chk_nonempty "SIM6 archivo de la fila 1 en Areas/CRM/contactos/" "$F61"
chk_match "SIM6 archivo fila 1 nombrado por su título" "$F61" "probar-template-de-ideas"
F62=$(grep -lF "ia360_docs_sync id=2 -->" "$VAULT/Areas/CRM/contactos/"*.md 2>/dev/null | head -1)
chk_nonempty "SIM6 archivo de la fila 2 en Areas/CRM/contactos/" "$F62"
chk_match "SIM6 archivo fila 2 es el mapa de cartera" "$F62" "mapa-de-cartera"

echo ""
echo "=== RESULTADO G-RAG: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && exit 0 || exit 1
