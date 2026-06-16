# Runbook operativo IA360 / ForgeChat — para agentes en el VPS (claude / codex)

Este archivo lo cargan claude (CLAUDE.md) y codex (AGENTS.md) al arrancar en
`~/stack/forgechat-poc/backend`. Lee todo antes de trabajar. Estás EN el VPS Linux:
tienes bash, docker, psql y los archivos directos — más fácil que por SSH.

## Qué es esto
ForgeChat = backend Node del bot de WhatsApp IA360 (TransformIA) de Alek. Atiende
WhatsApp por la **Cloud API oficial de Meta**: openers, secuencias, pipeline de ventas
por persona/journey, aprobación humana del owner. El "cerebro" conversacional vive en
n8n (Brain v2, canary).

## Rutas y constantes clave
- **Backend (código):** `~/stack/forgechat-poc/backend` — git, rama `main`, remoto `Forgemind-git/ForgeChat`.
- **Deploy (compose):** `~/stack/forgechat-poc` — `docker-compose.yml`, servicio `forgecrm-backend`.
- **Vault / docs:** `~/stack/obsidian/config/MKT` — Obsidian Sync (NO es git aquí), pero hay copia git en `github.com/AlekZen/MKT`. Las auditorías viven en `05-Agentes/auditorias/`.
- **DB:** contenedor `forgecrm-db` (Postgres). `DATABASE_URL` en `backend/.env`. Esquema `coexistence.*` (contacts, deals, pipelines, pipeline_stages, chat_history).
- **Cerebro:** n8n en `n8n.geekstudio.dev`; Brain v2 workflow id `b74vYWxP5YT8dQ2H`.
- **Números:** owner (WhatsApp de Alek) `5213322638033`; bot/emisor `5213321594582`; WABA `1190241942503057` (id 6 pipeline aliados); **sandbox = prefijo `52199900*`**.

## Reglas de oro (no negociables)
1. **Shell default = fish.** Para scripts y `$(...)`/`&&` usa `bash -lc '...'`.
2. **Código BAKEADO** en el container: editar archivos en disco **NO afecta producción** hasta `docker compose build + up`. Es tu red de seguridad: trabaja tranquilo en disco.
3. **CERO egress a números reales** sin aprobación explícita de Alek. Prueba con sandbox `52199900*` o con el owner `5213322638033`.
4. **No reinicies el backend** (build+up) sin avisar a Alek.
5. Español correcto (acentos, ñ). Sin emojis en scripts (charmap).
6. **No asumas que funciona: testea con datos.** Corre los tests tú mismo y verifica en la DB.

## Patrón de trabajo (la "ventana dual" de hoy)
1. `git checkout -b gN-nombre` desde `main`.
2. Implementa; saca la lógica a un **módulo puro testeable** (ej. `src/routes/ia360DealRouting.js`, `ia360ReferidoIntro.js`) que `webhook.js` importa.
3. `node --check <archivos>`.
4. **Test real** en `test/` SIN deps externas (npm no corre: no hay `node_modules`/`pg`). `node --test test/<archivo>.test.js`.
5. `git commit` en la rama. **Sin deploy todavía.**
6. Audita: corre los tests, revisa `git diff`, confirma que el container no se reinició.
7. Merge a `main` (conflictos de `require` → conserva AMBOS bloques).
8. `node --test` de TODOS los tests en main.
9. Deploy (abajo) y verifica arranque.
10. **Test directo en vivo** (owner/sandbox) y verifica el efecto en la DB.

## Correr tests
```bash
cd ~/stack/forgechat-poc/backend
node --test test/ia360OpenerButtons.test.js test/paymentCircuitBreaker.test.js \
  test/ia360AliadoPipelineRouting.test.js test/ia360QuienIntroCommand.test.js \
  test/ia360NoSilenceRegression.test.js
```
Los tests nuevos no usan deps externas. El único fallo global es `access.test.js`
(`Cannot find module 'pg'`) = ambiental, ignóralo. Harness E2E extra (contra
localhost:3011): `~/stack/forgechat-poc/*.sh` (glive-e2e, gbrain-e2e, gcold-e2e, gd-e2e, grag-e2e).

## Deploy (reinicia el backend ~10s)
```bash
cd ~/stack/forgechat-poc
docker compose build forgecrm-backend
docker compose up -d forgecrm-backend
docker logs forgecrm-backend --tail 8   # OK si dice: [ForgeChat] Backend running on port 3011
```
**NO** corras `install.sh` entero (regenera config y toca la DB). Solo build+up del backend.

## Probar envío de templates al owner
Sonda: `.forgechat-work/template-probe.js` (en el vault) o `/tmp/template-probe.js`.
**Tras cada rebuild el `/tmp` del container se borra** → re-copia:
```bash
docker cp /tmp/template-probe.js forgecrm-backend:/tmp/template-probe.js
cd ~/stack/forgechat-poc/backend; set -a; . ./.env; set +a
docker exec -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e PROBE_BASE=http://localhost:3011/api -e PROBE_TO=5213322638033 -e PROBE_IDS=42 \
  forgecrm-backend node /tmp/template-probe.js
```
El status REAL de entrega llega **asíncrono** por webhook. Verifícalo en
`coexistence.chat_history` (status delivered/failed + error_message). El "ERROR" que
imprime la sonda es falso positivo del heurístico: mira el `wamid` y el status en DB.

## Consultar la DB (esquiva el quoting de fish/docker)
Escribe el SQL a un archivo con **python** (maneja comillas limpio) y:
```bash
DBURL=$(grep -E '^DATABASE_URL=' ~/stack/forgechat-poc/backend/.env | cut -d= -f2- | tr -d '"')
docker exec -i forgecrm-db psql "$DBURL" -t -A -F'|' < /tmp/q.sql
```

## Estado del trabajo — cierre 2026-06-16 (DESPLEGADO en producción, main)
- **G10** P2 stages: `IA360_PARTNER_STAGE_MAP` ahora alcanza `Fit identificado` (pos 0) y `Diagnóstico compartido` (pos 3). Callsite Fit en `handleIa360OwnerSequenceChoice` (pre-envío, partner): cuando el owner elige secuencia para un aliado/referido, su deal nace en pos 0. Secuencias Blueprint/Propuesta = **stub inerte detrás de flag `IA360_PARTNER_BLUEPRINT` (default OFF)** con predicado `ia360PartnerBlueprintSendable` fail-closed (sin template aprobado → no envía; no hay ruta de envío todavía). Módulo `ia360DealRouting.js`, test `ia360PartnerBlueprintStages.test.js` (9/9). Bugfix `d8f68ee`: el callsite Fit re-scopea `record` a `targetContact` (si no, el deal se creaba bajo el número del owner — lo cazó la prueba viva). Verificado en vivo: deal del aliado en pos 0, y guard de no-regresión (deal avanzado no vuelve a pos 0).
- **G6** botones de opener ("Sí, cuéntame"→Revenue OS paso2 / "Ahora no"→cierre).
- **G5** circuit breaker de pago: detecta status `failed` 131042 en el webhook, alerta al owner (anti-spam), `skipRetry` en sendQueue; gate de pausa NO activado (deadlock).
- **G8** ruteo: deals con `relationshipContext` `aliado_socio`/`referido_bni` → pipeline "Partners / Aliados (BNI)" (id 6), no al genérico. `syncIa360Deal(pipelineName=...)`, módulo `ia360DealRouting.js`.
- **G9** comando owner `intro <contacto>: <quien>` (atajo `referido <contacto> de <quien>`) puebla `quien_intro` → desbloquea la secuencia de referido. Módulo `ia360ReferidoIntro.js`.

## Pendientes (backlog)
- **P1 (test vivo): ✅ HECHO 2026-06-16.** Verificado end-to-end por inyección de webhook firmado del owner: `quien_intro` se puebla en `coexistence.contacts`, y el efecto downstream queda probado con las funciones de producción — el gate COLD (`cold_send_missing_quien_intro`) y el HOT (`copy_blocked`, placeholder en draft) pasan de BLOCKED→CLEAR. Falta solo, si se quiere, que Alek lo teclee desde su WhatsApp real (la lógica ya está verificada).
- **P2 (journey aliado): código HECHO (G10), falta lo externo.** Stages `Fit identificado`/`Diagnóstico compartido` ya cableados + stub Blueprint/Propuesta fail-closed desplegado. **Pendiente NO-código:** crear y aprobar en Meta los templates `ia360_partner_blueprint` y `ia360_partner_propuesta`, luego activar `IA360_PARTNER_BLUEPRINT=on` y cablear la ruta de envío real (que DEBE pasar por los gates `outside_window_template_not_approved`/`cold_template_status_check_failed`). Sin esos templates no se ofrece ni envía nada (por diseño).
- **DEFERRED (optimización, NO ahora):** latencia del cerebro Brain v2 (nodo responder gpt-5 ~27s) se corta por timeout 30s de `callIa360Agent` (webhook.js ~L2669). Opción: async sin timeout. Nota: Hermes edita mensajes porque usa **Baileys/WhatsApp-Web** (`/opt/hermes-agent/.../whatsapp-bridge/bridge.js`), no la Cloud API; la Cloud API oficial NO edita salientes.
- **BLOQUEO push:** `git push` del backend falla **403** (usuario `AlekZen` sin permiso a `Forgemind-git/ForgeChat`). Los commits están en `main` local del VPS; resolver permiso o pushear con la cuenta dueña.

## Docs de referencia (en el vault)
- `05-Agentes/auditorias/2026-06-15 - Auditoria coherencia y UX pipelines WhatsApp y Email.md`
- `05-Agentes/auditorias/2026-06-15-diagnostico-no-delivery.md`
- `05-Agentes/auditorias/2026-06-15-pipeline-aliado-bni-vs-journey.md`
