# ForgeChat

A full-stack WhatsApp CRM that receives messages from the Meta WhatsApp Cloud API, stores them in PostgreSQL, and surfaces them through a custom React chat interface with contact management, tags, custom fields, team members (BDAs), message templates, bulk broadcasts, a visual automation builder, and a webhook audit log.

**Self-hostable** — see [`DEPLOY-DIGITALOCEAN.md`](./DEPLOY-DIGITALOCEAN.md) for a single-host deployment guide.

---

## Architecture

```
Meta WhatsApp Cloud API
        │
        ▼ webhook
   ForgeChat Backend  ───►  PostgreSQL (coexistence schema)
   (Express + pg)          ├─ chat_history, contacts, tags, …
        │                  ├─ message_templates + revisions + analytics
        │                  ├─ whatsapp_accounts (multi-WABA, AES-256-GCM tokens)
        │                  ├─ chatbots + automation_executions
        │                  └─ webhook_events (audit log)
        │
        ├──► BullMQ on Redis  ──►  outbound send queue (60 msg/sec)
        │                          + media download queue (concurrency 2)
        │
        ▼
   ForgeChat Frontend
   (React 18 + Vite, inline styles, no Tailwind)
        │
        ▼
   Traefik (TLS) ──► browser
```

## Tech Stack

| Layer            | Technology                                                   |
|------------------|--------------------------------------------------------------|
| Database         | PostgreSQL (`coexistence` schema)                            |
| Backend          | Node.js 20 + Express 4 + `pg` (raw SQL, no ORM)              |
| Queues           | BullMQ on shared Redis (send + media-download)               |
| Frontend         | React 18 + Vite, inline styles, DM Sans / DM Mono            |
| Icons            | `lucide-react`                                               |
| Auth             | JWT in httpOnly cookies (`forgecrm_token`)                   |
| Encryption       | AES-256-GCM for stored Meta access tokens                    |
| Reverse proxy    | Traefik (Let's Encrypt, `mytlschallenge` resolver)           |
| Container build  | Docker Compose (shared `docker-compose.yml`)           |

## Features

- **Chats** — 3-pane WhatsApp-style inbox with per-BDA filtering, media rendering (image/video/audio/document with ffmpeg Ogg→MP3 fallback for Safari), 24h customer-service-window enforcement, optimistic-UI outbound sends, mic recording in the composer
- **Contacts** — CRUD with tags + custom field definitions per WABA
- **Message Templates** — full Meta lifecycle: real submit/sync/delete, PAUSED / DISABLED / REJECTED handling, quality score, COPY_CODE buttons, translations grouped by name, library browse + clone
- **Template Editing + History** — APPROVED templates editable via Meta's edit API, snapshot per change to `message_template_revisions`, 2-edits-per-24h rate limit, History side drawer with restore
- **Template Analytics** — daily Meta `template_analytics` cache, KPI tiles + SVG line chart + per-button click breakdown, daily refresh cron
- **Bulk Broadcasts** — 7 message types (template, text, link, image, video, audio, document), per-recipient send queue, live status rollup (SENDING / SENT / PARTIAL / FAILED), Media Library integration for media types, variable mapping per broadcast, aggregated activity log
- **Automation Builder** — visual flow editor (~3.9k lines), 33 block types, drag-to-connect handles, side-handle resource picker for AI Agent (model + tools); engine evaluates `keyword / anyMessage / newContact / messageRead / messageDelivered / messageSent` triggers synchronously on each webhook
- **Multi-WABA** — `whatsapp_accounts` table, encrypted access tokens, health tracking with topbar banner on `invalid_token`
- **Webhook History** — every inbound Meta/n8n payload audited with kind + subtype + extracted content preview + parser outcome; Send-Test-Webhook modal generates synthetic payloads of every common shape; replay button re-runs any historical payload through the handler
- **Media Library** — upload images/videos/audio/documents to Postgres once, sync per-WABA to Meta on demand (each WABA gets its own 28-day `media_id`), toggle Auto-resync to let a daily cron refresh expiring IDs ~24h before TTL

## Project layout

```
ForgeCRM/
├── backend/                # Express API on :3011 (Docker) / :3001 (dev)
│   ├── src/
│   │   ├── index.js                 # bootstrap, middleware, route mounting
│   │   ├── auth.js                  # JWT auth + user table mgmt
│   │   ├── db.js                    # pg Pool config
│   │   ├── engine/automationEngine.js
│   │   ├── integrations/
│   │   │   ├── metaSend.js          # text / template / media
│   │   │   ├── metaMedia.js         # download from Meta CDN
│   │   │   ├── metaTemplates.js     # submit / edit / sync / library / analytics
│   │   │   └── metaResumableUpload.js
│   │   ├── queue/{mediaQueue,sendQueue}.js
│   │   ├── services/
│   │   │   ├── messageSender.js
│   │   │   ├── mediaDownloader.js
│   │   │   ├── templateAnalytics.js
│   │   │   └── accountHealth.js
│   │   ├── util/crypto.js           # AES-256-GCM
│   │   └── routes/
│   │       ├── webhook.js           # Meta receiver + parser + audit logger
│   │       ├── webhookHistory.js    # /webhook-events listing + replay
│   │       ├── messages.js          # numbers, contacts, chat, send paths
│   │       ├── templates.js         # CRUD + submit/sync/edit/revisions/analytics
│   │       ├── broadcasts.js        # multi-type broadcasts + send/test + status rollup
│   │       ├── chatbots.js          # automations + executions
│   │       ├── whatsappAccounts.js  # multi-WABA + encrypted tokens
│   │       ├── mediaLibrary.js      # Postgres object storage + Meta sync
│   │       ├── webhookHistory.js    # webhook audit log
│   │       └── media.js             # auth-proxied /api/media/:msgId
│   └── scripts/             # cron jobs (template sync, analytics, media cleanup, webhook cleanup)
├── frontend/                # React + Vite, served by nginx in prod
│   └── src/
│       ├── App.jsx
│       ├── api.js                   # fetch wrapper for every endpoint
│       ├── hooks/useHashRoute.js    # survives reload
│       ├── components/              # ChatsPage, ChatWindow, MessageBubble, AutomationBuilderView, …
│       └── pages/                   # TemplateBuilderPage, BulkMessagePage, AdminSettingsPage, …
└── db/migrations/           # numbered SQL files (001 → 044)
```

## Running locally

```bash
# Backend
cd backend
cp .env.example .env       # fill in DB url, JWT secret, encryption key, Meta verify token
npm install
npm run dev                # nodemon on :3001

# Frontend (Vite proxies /api + /uploads to backend)
cd frontend
npm install
npm run dev                # :5173
```

## Deploying

For a **fresh host**, follow [`DEPLOY.md`](./DEPLOY.md) — it covers the required containers, persistent volumes, env vars, DNS/TLS, migrations, bootstrap order, cron jobs, and end-to-end verification.

For **rolling updates** on the existing production VPS:

```bash
cd /root
docker compose build forgecrm-backend forgecrm-frontend
docker compose up -d --force-recreate forgecrm-backend forgecrm-frontend
```

Traefik labels handle TLS + path routing. The frontend nginx config proxies `/api` and `/uploads` to the backend on port 3011.

## Database migrations

Numbered SQL files in `db/migrations/` are applied manually against the Postgres container:

```bash
docker exec -i forgecrm-postgres psql -U postgres -d postgres < db/migrations/0NN_xxx.sql
```

Latest applied: `026_broadcast_message_type.sql`.

## Cron jobs (host crontab)

```
0  3  * * *  docker exec forgecrm-backend node scripts/cleanupMedia.js
0  */4 * * * docker exec forgecrm-backend node scripts/syncTemplates.js
0  2  * * *  docker exec forgecrm-backend node scripts/syncTemplateAnalytics.js
0  4  * * *  docker exec forgecrm-backend node scripts/syncMediaResync.js
```

## Security

> Found a vulnerability? Please report it privately — see [`SECURITY.md`](./SECURITY.md). Do **not** open a public issue.

- **Never commit** `.env` or `backend/.env` — both gitignored
- Meta access tokens are encrypted at rest with AES-256-GCM (`backend/src/util/crypto.js`); the key lives in `FORGECRM_ENCRYPTION_KEY` env var
- JWT tokens use httpOnly, sameSite-strict cookies
- Webhook verify token is dedicated (`FORGECRM_META_WEBHOOK_VERIFY_TOKEN`), kept separate from the JWT signing secret
- All SQL uses parameterized queries (`pg` Pool, no ORM, no string interpolation)
- helmet + rate limiter (600 req/min/user) on the API surface
- Phone numbers normalized to digits-only on insert (`normalizePhone()` in `routes/webhook.js`) to avoid duplicate chat threads from `+91…` vs `91…`

## Contributing

Contributions are welcome! Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
development setup, coding conventions, Conventional Commits, and the DCO sign-off
requirement, and abide by our [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). See
[`CHANGELOG.md`](./CHANGELOG.md) for the release history,
[`VERSIONING.md`](./VERSIONING.md) for the versioning & upgrade policy, and
[`AUTHORS.md`](./AUTHORS.md) for the people behind ForgeChat.

## License

ForgeChat is [fair-code](https://faircode.io) distributed under the
[**Sustainable Use License**](./LICENSE.md).

- ✅ Source available — view, modify, and use for your own internal business, non-commercial, or personal purposes.
- ✅ Redistribute free of charge for non-commercial purposes.
- ❌ No commercial resale or hosting as a paid service without permission.

Copyright © 2026 Forgemind Techhub LLP. See [`LICENSE.md`](./LICENSE.md) for full terms.

## Trademarks

"Forgemind", "ForgeChat", and the other Forge\* marks and logos are trademarks of Forgemind. See [`TRADEMARK.md`](./TRADEMARK.md) for the brand usage policy.
