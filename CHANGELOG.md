# Changelog

All notable changes to ForgeChat are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-05-25

Initial public release of ForgeChat — a full-stack WhatsApp CRM built on the
Meta WhatsApp Cloud API.

### Added
- **Chats** — 3-pane WhatsApp-style inbox with per-BDA filtering, media
  rendering (image/video/audio/document, ffmpeg Ogg→MP3 fallback for Safari),
  24-hour customer-service-window enforcement, optimistic-UI outbound sends, and
  in-composer mic recording.
- **Contacts** — CRUD with tags and per-WABA custom field definitions.
- **Pipelines (Deals Kanban)** — sales pipeline board with role-based access.
- **Message Templates** — full Meta lifecycle (submit / sync / edit / delete),
  status handling (PAUSED / DISABLED / REJECTED), quality score, COPY_CODE
  buttons, translations, and library browse + clone.
- **Template editing & history** — edit APPROVED templates via Meta's edit API,
  per-change snapshots to `message_template_revisions`, 2-edits-per-24h limit,
  and a History drawer with restore.
- **Template analytics** — daily Meta `template_analytics` cache, KPI tiles, SVG
  line chart, per-button click breakdown, and a daily refresh cron.
- **Bulk broadcasts** — 7 message types (template, text, link, image, video,
  audio, document), per-recipient send queue, live status rollup, Media Library
  integration, and per-broadcast variable mapping.
- **Automation builder** — visual flow editor with 33 block types, drag-to-
  connect handles and a synchronous trigger engine
  (keyword / anyMessage / newContact / messageRead / messageDelivered /
  messageSent).
- **Multi-WABA** — `whatsapp_accounts` with AES-256-GCM encrypted access tokens
  and health tracking with an `invalid_token` topbar banner.
- **Webhook history** — auditing of every inbound payload with parser outcome,
  a synthetic Send-Test-Webhook modal, and replay of historical payloads.
- **Media Library** — upload media to PostgreSQL once and sync per-WABA to Meta
  on demand, with optional daily auto-resync of expiring media IDs.
- **Outbound delivery** — BullMQ on Redis with a 60 msg/sec send queue and a
  concurrency-2 media-download queue.
- **CI/CD pipelines** — test/build/migrations gatekeeper, dependency **license
  check**, full-history **secret scanning** (gitleaks), and **Docker image
  publishing** to GHCR on release (`forgechat-backend`, `forgechat-frontend`).
- **Project governance & docs** — `LICENSE.md` (Sustainable Use License),
  `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `TRADEMARK.md`,
  `AUTHORS.md`, `VERSIONING.md`, and GitHub issue/PR templates.
- `docker-compose.sample.yml` deployment template, one-command installers
  (`install.sh` / `install.ps1`), and `.dockerignore` files.

### Security
- JWT authentication in httpOnly, SameSite-strict cookies (`forgecrm_token`).
- Meta access tokens encrypted at rest with AES-256-GCM.
- Dedicated webhook verify token, separate from the JWT signing secret.
- The first-run admin is no longer seeded with a hardcoded default password. It
  is taken from `ADMIN_PASSWORD`, or a random password is generated and printed
  once on first boot.
- All database access via parameterized `pg` queries (no ORM, no string
  interpolation).
- `helmet` and a 600 req/min/user rate limiter on the API surface.

[Unreleased]: https://github.com/Forgemind-git/ForgeChat/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Forgemind-git/ForgeChat/releases/tag/v1.0.0
