# ForgeChat — Deployment Guide

Standalone deployment instructions for spinning ForgeChat on a fresh host. Follow this end-to-end and the dashboard will be live behind TLS with all features (webhooks, queues, media, automations, template lifecycle, analytics) working.

The current production deployment co-exists with other apps inside `docker-compose.yml` on the production server — this document captures the *minimum* container set, env vars, volumes, and one-time setup so a fresh deployment doesn't accidentally drop a dependency.

---

## 1. Container topology (5 required services)

| Container | Image | Port | Purpose |
|---|---|---|---|
| `forgecrm-backend` | built from `backend/Dockerfile` (`node:20-alpine` + apk `ffmpeg`) | 3011 internal | Express API + BullMQ workers |
| `forgecrm-frontend` | built from `frontend/Dockerfile` (`nginx:alpine` after `vite build`) | 80 internal | React SPA, nginx proxies `/api` + `/uploads` + `/media` to backend |
| `forgecrm-db` | `postgres:15` (plain PostgreSQL — no Supabase) | 5432 (localhost only) | All ForgeChat data lives in the `coexistence` schema |
| `redis` | `redis:6` or newer | 6379 (internal only) | BullMQ send queue (60 msg/sec rate-limited) + media-download queue (concurrency 2) |
| `traefik` | `traefik:v2.x` | 80 / 443 | TLS termination via Let's Encrypt + host-based routing |

All four must be on the same Docker network (production uses `root_default`).
Media Library files are stored in Postgres (`coexistence.media_objects`), so no object-storage service (MinIO/S3) is required.

### Not required
- **Supabase** — the project runs on plain PostgreSQL. The backend speaks raw SQL via the `pg` Pool; there is no PostgREST / Realtime / Auth / object-storage dependency, and no Supabase roles (`anon`/`authenticated`/`service_role`) or RLS
- **n8n** — historically forwarded Meta webhooks. Meta now posts directly to ForgeChat, so n8n is no longer in the path
- The dozens of other apps in the production compose (NocoDB, Metabase, Evolution, ForgeChat, etc.) are unrelated

## 2. Volumes (persistent state)

| Volume | Mount point in container | Purpose | Backup priority |
|---|---|---|---|
| `forgecrm-uploads` | `forgecrm-backend:/app/uploads` | Team-member profile pictures | Low |
| `forgecrm-media` | `forgecrm-backend:/app/media` | Downloaded WhatsApp media (image/video/audio/document) — cleaned up at 180 days by cron | Medium |
| Postgres data | `forgecrm-db:/var/lib/postgresql/data` (bind-mount recommended: `/srv/forgecrm/pgdata`) | **All CRM data** including AES-encrypted Meta access tokens | **Critical** — back up daily |
| `redis_data` | `redis:/data` | BullMQ queue state (survives restarts so jobs don't drop) | Medium |
| Traefik certs | `traefik:/letsencrypt` | TLS certs (avoids hitting Let's Encrypt rate limits on restart) | Low (regenerable) |

## 3. Environment variables

ForgeChat reads from `backend/.env` (or process env in Docker). Use `backend/.env.example` as a starting template.

### Required
```bash
PORT=3011                        # Matches docker compose port mapping
NODE_ENV=production

# Database
DATABASE_URL=postgresql://postgres:<password>@forgecrm-db:5432/postgres
POSTGRES_SSL=false               # true if connecting over public network

# Auth
JWT_SECRET=<random-64-char-hex>              # openssl rand -hex 32
CORS_ORIGIN=https://crm.yourdomain.com

# The auth cookie is host-only (scoped to the domain the API is served from).
# Serve the frontend and API on the same host (as the sample Caddy/nginx setup
# does) and no cookie-domain config is needed.

# Encryption for stored Meta access tokens (AES-256-GCM)
FORGECRM_ENCRYPTION_KEY=<random-64-char-hex>  # openssl rand -hex 32 — DIFFERENT from JWT secret

# Admin seed — REQUIRED in production (first boot only, when the users table is empty)
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=<a-strong-password>

# Postgres password — must match the password in DATABASE_URL above
POSTGRES_PASSWORD=<same-as-in-DATABASE_URL>

# Meta webhook verify token (whatever string you configure in Meta's webhook settings)
META_WEBHOOK_VERIFY_TOKEN=<your-chosen-string>
META_API_VERSION=v21.0

# Queues / Redis
REDIS_URL=redis://redis:6379
MEDIA_QUEUE_CONCURRENCY=2
MEDIA_QUEUE_ATTEMPTS=5
MEDIA_RETENTION_DAYS=180

# Storage path inside the backend container (downloaded chat media; matches the
# volume mount). Media Library files live in Postgres (coexistence.media_objects),
# so no MinIO/object-store config is needed.
MEDIA_DIR=/app/media
```

### Optional (with sensible defaults if omitted)
```bash
ANALYTICS_SYNC_DAYS=30           # template analytics window
WEBHOOK_RETENTION_DAYS=30        # webhook_events table retention
```

### Where to keep them
**Never commit** any env file with real values. Production keeps everything in `.env` (gitignored). For a new host, either bind-mount an env file or pass via `docker compose --env-file`.

## 4. DNS + TLS

| Step | Action |
|---|---|
| 1 | Point an A record `crm.<yourdomain>` at the host IP |
| 2 | Open ports 80 and 443 to the world for Traefik |
| 3 | Configure Traefik with a cert resolver (production uses `mytlschallenge` on Let's Encrypt) |
| 4 | Backend gets two Traefik routers: `Host(crm.<yourdomain>) && PathPrefix(/api)` priority 20 + `Host(crm.<yourdomain>)` priority 10 → frontend |

Exact Traefik labels live in `docker-compose.yml` under the `forgecrm-backend` and `forgecrm-frontend` services on the production VPS; copy them verbatim and swap the domain.

## 5. Database setup (one-time)

Plain Postgres — the only one-time setup is creating the schema (the app uses a single `coexistence` schema and connects as the `postgres` superuser; no extra roles or RLS):

```sql
CREATE SCHEMA IF NOT EXISTS coexistence;
```

Then apply all migrations in order:

```bash
for f in $(ls db/migrations/*.sql | sort); do
  docker exec -i forgecrm-db psql -U postgres -d postgres < "$f"
done
```

Latest migration as of writing: `044_drop_supabase_artifacts.sql`. The CI workflow at `.github/workflows/ci.yml` already runs every migration against a fresh Postgres 15 on every push, so any migration drift will fail CI before reaching prod.

## 6. Bootstrap order

```bash
docker compose up -d traefik              # always first — handles TLS for everything
docker compose up -d redis forgecrm-db    # data layer
# wait for forgecrm-db to be ready, then apply migrations (§5)
docker compose up -d forgecrm-backend     # depends on db + redis; runs ensureTables() on startup
docker compose up -d forgecrm-frontend    # nginx proxies to backend
```

Verify each service:
```bash
docker compose ps                                 # all five should be "Up"
curl -fsS https://crm.<yourdomain>/api/health     # → {"ok":true,"ts":...}
docker logs forgecrm-backend | tail               # should show "Backend running on port 3011"
                                                  # + "[mediaQueue] worker started, concurrency=2"
                                                  # + "[sendQueue] worker started, concurrency=5, rate=60/1000ms"
```

## 7. Host cron jobs (run as root, NOT inside containers)

```cron
0  3  * * *  docker exec forgecrm-backend node scripts/cleanupMedia.js          >> /var/log/forgecrm-media-cleanup.log 2>&1
0  */4 * * * docker exec forgecrm-backend node scripts/syncTemplates.js         >> /var/log/forgecrm-template-sync.log 2>&1
0  2  * * *  docker exec forgecrm-backend node scripts/syncTemplateAnalytics.js >> /var/log/forgecrm-analytics-sync.log 2>&1
0  4  * * *  docker exec forgecrm-backend node scripts/syncMediaResync.js       >> /var/log/forgecrm-media-resync.log 2>&1
```

Without these, you'll still get inbound webhooks + manual sends + manual refresh, but: media disk grows forever, template status drifts from Meta's truth, and analytics doesn't update.

## 8. Initial app setup (after first deploy)

1. **Log in** to `https://crm.<yourdomain>` with the seeded admin (`admin@forgemind.space`, overridable via `ADMIN_EMAIL`). The password is whatever you set in `ADMIN_PASSWORD`; if left unset, a random one was generated and printed once in the backend logs on first boot — log in and **change it immediately** via Admin Settings → Team.
2. **Admin Settings → WhatsApp Accounts → Add** — paste:
   - Display Phone Number (digits only — see normalization rule below)
   - Phone Number ID (from Meta's WABA dashboard)
   - WABA ID
   - Meta App ID
   - Access Token (Meta System User token; encrypted at rest with AES-256-GCM)
3. **Configure the Meta webhook** in Meta Business Suite → WhatsApp → Configuration:
   - Callback URL: `https://crm.<yourdomain>/api/webhook/whatsapp`
   - Verify token: must match `META_WEBHOOK_VERIFY_TOKEN`
   - Subscribe to: `messages` (covers messages + statuses + echoes + template events)
4. **Test the wiring** — Admin Settings → Webhooks → "Send Test Webhook" with the "Incoming text message" template. A row should appear in the audit log with `processed` status, records_extracted=1.
5. **(Optional) Enable Template Insights** in Meta Business Suite → WhatsApp Accounts → Insights → Enable. Without this, the Analytics drawer's "Refresh from Meta" returns subcode 4182004 (the UI shows a banner explaining the fix).

## 9. Backup strategy

Daily `pg_dump` of `forgecrm-db` is non-negotiable — it contains the encrypted Meta access tokens, chat history, contacts, templates, automations, and webhook audit log. Production uses `backup-postgres.sh` (2-day retention, cron-driven). For a new host, do at minimum:

```bash
0 4 * * * docker exec forgecrm-db pg_dump -U postgres postgres | gzip > /srv/backups/forgecrm-$(date +\%Y\%m\%d).sql.gz
# + sync /srv/backups off-host (rsync, S3, Backblaze, whatever)
```

## 10. Universal rules (deviation = bugs)

- **Phone numbers are digits-only everywhere.** Backend normalizes on insert (`normalizePhone()` in `routes/webhook.js`); display sites never prepend `+`. Mixing formats causes duplicate chat threads.
- **Meta access tokens never leave the encrypted column unencrypted.** Decrypt only at use-time inside `getAccountWithToken()`; never log decrypted tokens.
- **JWT secret and webhook verify token are separate env vars.** Reusing one for both leaks the verify token in any JWT-related debug path.
- **`webhook.js` returns 200 even on parser failure** — Meta retries non-200 responses, which amplifies bugs. Failures are captured in `webhook_events.processing_error` instead.
- **Per-project docker-compose files are forbidden.** Merge ForgeChat's 5 services into the host's shared compose. (Stems from the same Traefik/network sharing constraint that affects all Forge projects.)
- **Plain PostgreSQL only.** The app needs no Supabase services, roles, or RLS — a stock `postgres:15` container with the `coexistence` schema is sufficient.

## 11. Verifying a fresh deployment end-to-end

After §6 + §8, send a real WhatsApp message to the configured business number. Within ~3 seconds you should see:

1. A new row in **Admin Settings → Webhooks** with `MESSAGES · TEXT · processed · <your message body>`
2. A new chat in **Chats** under the right BDA, with the message bubble rendered
3. Reply from the chat composer — outbound bubble appears optimistically, then gets the WhatsApp delivered-tick when Meta echoes the status
4. The status webhook arrives at the Webhooks tab as `STATUSES · DELIVERED · …`

If all four happen, every layer is working: Meta integration, parser, audit log, chat_history insert, automation engine, BullMQ send queue, status callback, and the chat UI.

---

For day-to-day operations and architecture details, see [`README.md`](./README.md). For the comprehensive low-level design, see [`LLD.md`](./LLD.md).
