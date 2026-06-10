# Changelog

All notable changes to ForgeChat are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-06-10

### Added
- **Google Sheets `upsert` for agents** — an agent finds a contact's existing
  row by a key column (e.g. phone number) and updates only the columns you name,
  or adds a new row if none exists. No duplicate rows and no row-number/column
  tracking — the reliable way to keep one evolving row per contact.
- **CRM write-back tools** — an agent can act on its own conversation's contact
  inside ForgeChat: save the name, add tags, and set custom fields (gated by an
  "Update CRM" toggle on the agent).
- **Human handoff** — an `escalate_to_human` tool, configurable handoff keywords,
  and round-robin assignment to a chosen set of team members. Handing off pauses
  the bot for that conversation; a take-over toggle in the chat header lets a
  teammate take over or return the chat to the bot.
- **Auto-summary on close** — when a conversation goes idle, the agent writes a
  final summary to the sheet/CRM, so a row reflects the whole chat.
- **"New conversations only" trigger** — an agent engages a contact only on
  their first-ever message and never joins conversations that already existed.
- **MCP agent-builder server** (stdio + remote HTTP) — build and configure
  agents by chatting with Claude, including `read_sheet_values` and the Sheets
  `upsert` op over MCP.

## [1.1.0] - 2026-06-04

### Added
- **AI agents that reply for you** — connect an AI model and an agent answers
  customers automatically. Shape it with a plain-English system prompt,
  conversation context, and tools; trigger on keyword / any-message / new
  contact; and let it send media back to the customer.
- **AI model connectors** — OpenAI and Anthropic (Claude) providers, managed in
  **Settings → AI Models**; the automation builder can target an agent as a block.
- **Google integration (Sheets & Drive)** — an agent can look up rows in Google
  Sheets and use Drive files. Google **Client ID / Secret / redirect are entered
  in Settings → Integrations** and stored encrypted in the database — no env files.
- **Voice-note understanding** — incoming WhatsApp audio is transcribed and
  answered like any text message.
- **WhatsApp-style template rendering** — chat and broadcast previews now render
  approved templates the way WhatsApp shows them, including `{{1}}` variable
  substitution and image headers.
- **Custom-text variables in broadcasts** — map per-recipient custom text into
  template variables when sending a bulk broadcast.
- A bundled **`docker-compose.yml`** (plus a `docker-compose.prod.yml` overlay) so
  a fresh clone runs with a single `docker compose up -d`, plus clearer macOS /
  Docker Desktop setup notes in the README.

### Changed
- **Brand-language pass for Meta / WhatsApp guidelines:** dropped "official … /
  unofficial hack" framing in README, reworded the login splash to no longer
  read as if ForgeChat *is* the WhatsApp Business Platform, switched API/account
  naming to the documented "WhatsApp Cloud API" and "WhatsApp Business Account",
  scoped trademark ownership in `TRADEMARK.md` to **Forgemind AI** only and
  added a third-party trademarks section acknowledging Meta / WhatsApp marks,
  and added an affiliation disclaimer to the README footer.

## [1.0.1] - 2026-05-24

### Added
- Pipelines (Deals Kanban) module with role-based access.
- CI/CD pipelines: test/build/migrations gatekeeper, dependency **license check**,
  full-history **secret scanning** (gitleaks), and **Docker image publishing** to
  GHCR on release (`forge-chat-backend`, `forge-chat-frontend`).
- Project governance & docs: `LICENSE.md` (Sustainable Use License), `SECURITY.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `TRADEMARK.md`, `AUTHORS.md`,
  `VERSIONING.md`, and GitHub issue/PR templates.
- `docker-compose.sample.yml` deployment template and `.dockerignore` files.

### Changed
- Bumped CI actions `checkout`/`setup-node` to v5.

### Fixed
- Migrations now build a fresh database from scratch — added the missing
  `forgecrm_users` base migration that later migrations depend on.

### Security
- The first-run admin is no longer seeded with a hardcoded default password. It
  is taken from `ADMIN_PASSWORD`, or a random password is generated and printed
  once on first boot.

## [1.0.0] - 2026-05-23

Initial release of ForgeChat — a full-stack WhatsApp CRM built on the Meta
WhatsApp Cloud API.

### Added
- **Chats** — 3-pane WhatsApp-style inbox with per-BDA filtering, media
  rendering (image/video/audio/document, ffmpeg Ogg→MP3 fallback for Safari),
  24-hour customer-service-window enforcement, optimistic-UI outbound sends, and
  in-composer mic recording.
- **Contacts** — CRUD with tags and per-WABA custom field definitions.
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
  connect handles, AI Agent resource picker, and a synchronous trigger engine
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

### Security
- JWT authentication in httpOnly, SameSite-strict cookies (`forgecrm_token`).
- Meta access tokens encrypted at rest with AES-256-GCM.
- Dedicated webhook verify token, separate from the JWT signing secret.
- All database access via parameterized `pg` queries (no ORM, no string
  interpolation).
- `helmet` and a 600 req/min/user rate limiter on the API surface.

[Unreleased]: https://github.com/Forgemind-git/ForgeChat/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Forgemind-git/ForgeChat/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/Forgemind-git/ForgeChat/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Forgemind-git/ForgeChat/releases/tag/v1.0.0
