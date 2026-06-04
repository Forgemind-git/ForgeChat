# ForgeChat — Deployment Guide

ForgeChat ships with a ready-to-run `docker-compose.yml`. For the normal install,
follow the **Deploy** section of [`README.md`](./README.md):

```bash
git clone https://github.com/Forgemind-git/ForgeChat.git && cd ForgeChat

# Server with a domain + automatic HTTPS (required for WhatsApp) — recommended:
./install.sh                               # asks for your domain, checks DNS/ports, deploys

# …or run it yourself without the installer:
DOMAIN=chat.example.com docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# …or just locally on this machine (no domain, no WhatsApp):
docker compose up -d                       # http://localhost:8080
```

The backend **auto-generates its secrets** (JWT + encryption key, persisted in the
`secrets` volume) and **applies all database migrations on boot** — there is no
manual secret generation or `psql` migration step. You create the admin account in
the browser on first visit. This page captures the operational details a maintainer
may still want.

---

## 1. Services

| Service | Image | Purpose |
|---|---|---|
| `forgecrm-db` | `postgres:15` | All data in the `coexistence` schema (no host port) |
| `redis` | `redis:7-alpine` | BullMQ send + media-download queues |
| `forgecrm-backend` | built from `backend/Dockerfile` (context = repo root) | Express API + workers + boot migration runner |
| `forgecrm-frontend` | built from `frontend/Dockerfile` (`nginx` after `vite build`) | React SPA; proxies `/api`, `/uploads`, `/l/` to the backend |
| `caddy` *(prod overlay only)* | `caddy:2` | Automatic Let's Encrypt TLS, driven by `$DOMAIN` |

The backend image is built with the **repo root** as the build context (so
`db/migrations/` is copied into the image for the boot runner) — see
`docker-compose.yml` (`build: { context: ., dockerfile: backend/Dockerfile }`).

## 2. Volumes (persistent state)

| Volume | Mount | Purpose | Backup priority |
|---|---|---|---|
| `pgdata` | `forgecrm-db:/var/lib/postgresql/data` | **All CRM data** incl. AES-encrypted Meta tokens | **Critical** — back up daily |
| `secrets` | `forgecrm-backend:/app/data` | **Auto-generated JWT + encryption key** (`instance.json`) | **Critical** — losing it makes encrypted WhatsApp tokens unreadable |
| `media` | `forgecrm-backend:/app/media` | Downloaded WhatsApp media | Medium |
| `uploads` | `forgecrm-backend:/app/uploads` | Uploaded files / profile pictures | Low |
| `redisdata` | `redis:/data` | Queue state | Medium |
| `caddy_data` / `caddy_config` *(prod)* | `caddy:/data`, `/config` | TLS certs | Low (regenerable) |

## 3. Configuration

**Nothing is required.** Secrets are auto-generated; the bundled Postgres/Redis are
wired by the compose file. To override anything, create a root `.env` next to
`docker-compose.yml` (optional, auto-loaded) — see [`backend/.env.example`](backend/.env.example):

- `POSTGRES_PASSWORD` — bundled DB password (changing it later needs `docker compose down -v`)
- `HTTP_PORT` — host port for the UI (default `8080`)
- `JWT_SECRET` / `FORGECRM_ENCRYPTION_KEY` — pin specific values instead of the auto-generated ones (don't change the encryption key after data is encrypted)
- `ADMIN_EMAIL` + `ADMIN_PASSWORD` — headless admin seed (skips the setup wizard)
- `META_APP_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_*` — optional feature keys
- WhatsApp accounts themselves are connected in the UI (Settings → WhatsApp), not via env.

## 4. Database

Migrations run automatically on every boot: the runner (`backend/src/db/migrate.js`)
applies any `db/migrations/*.sql` not yet recorded in `coexistence.schema_migrations`,
each in its own transaction. New migrations must keep the zero-padded `NNN_` naming.
`ensureTables()` then seeds the admin only if `ADMIN_PASSWORD` is set; otherwise the
first-run wizard handles it.

## 5. Host cron jobs (optional maintenance)

```cron
0  3  * * *  cd /path/to/ForgeChat && docker compose exec -T forgecrm-backend node scripts/cleanupMedia.js
0  */4 * * * cd /path/to/ForgeChat && docker compose exec -T forgecrm-backend node scripts/syncTemplates.js
0  2  * * *  cd /path/to/ForgeChat && docker compose exec -T forgecrm-backend node scripts/syncTemplateAnalytics.js
```

Without these you still get inbound webhooks + sends, but media disk grows, template
status drifts from Meta, and analytics doesn't refresh.

## 6. Backups

Daily `pg_dump` of `forgecrm-db` is non-negotiable (it holds encrypted Meta tokens,
chats, contacts, templates, automations). Also keep the `secrets` volume — it holds
the key that decrypts those tokens.

```bash
0 4 * * * cd /path/to/ForgeChat && docker compose exec -T forgecrm-db pg_dump -U postgres postgres | gzip > /srv/backups/forgechat-$(date +\%Y\%m\%d).sql.gz
# + sync /srv/backups off-host
```

## 7. Verifying a fresh deployment

```bash
docker compose ps                                  # all services Up/healthy
docker compose logs forgecrm-backend | tail        # "[migrate] applied …", "Backend running on port 3011"
curl -fsS http://localhost:8080/api/auth/status    # → {"setupRequired":true} before setup
```

Then open the UI, create the admin, connect WhatsApp (README → "Connect your WhatsApp"),
and send a real message to the business number — it should appear in **Chats** within seconds.

## Universal rules (deviation = bugs)

- **Phone numbers are digits-only everywhere** (`normalizePhone()` in `routes/webhook.js`); display never prepends `+`. Mixing formats causes duplicate threads.
- **Meta access tokens never leave the encrypted column unencrypted.** Decrypt only at use-time; never log decrypted tokens.
- **JWT secret and the webhook verify token are separate.** The verify token is per-account in the DB (entered in the UI).
- **`webhook.js` returns 200 even on parser failure** — non-200 makes Meta retry and amplify bugs. Failures are recorded in `webhook_events.processing_error`.
- **Plain PostgreSQL only** — no Supabase services, roles, or RLS; a stock `postgres:15` with the `coexistence` schema is sufficient.

---

For day-to-day use see [`README.md`](./README.md). For low-level design see [`LLD.md`](./LLD.md).
