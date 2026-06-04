# Contributing to ForgeChat

Thanks for your interest in improving ForgeChat — a full-stack WhatsApp CRM
built on the Meta WhatsApp Cloud API. This guide explains how to set up a local
environment, the conventions we follow, and how to get a change merged.

By participating in this project, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

---

## Table of Contents

1. [Ways to Contribute](#ways-to-contribute)
2. [Repository Structure](#repository-structure)
3. [Local Development Setup](#local-development-setup)
4. [Database Migrations](#database-migrations)
5. [Coding Conventions](#coding-conventions)
6. [Testing](#testing)
7. [Commit Messages](#commit-messages)
8. [Developer Certificate of Origin (DCO)](#developer-certificate-of-origin-dco)
9. [License of Contributions](#license-of-contributions)
10. [Branch & Pull Request Workflow](#branch--pull-request-workflow)
11. [Pull Request Checklist](#pull-request-checklist)
12. [Getting Help](#getting-help)

---

## Ways to Contribute

- **Report a bug** — open a [GitHub issue](https://github.com/Forgemind-git/ForgeChat/issues)
  with steps to reproduce, expected vs. actual behaviour, your environment
  (OS, Node version, browser), and logs or screenshots where relevant.
- **Propose a feature** — open an issue describing the problem you want solved
  **before** writing code, so we can agree on scope and approach. Large,
  unsolicited PRs are hard to review and may be declined.
- **Submit a fix or feature** — via a pull request, following the workflow below.
- **Improve docs** — corrections and clarifications to the README, `DEPLOY.md`,
  or this guide are very welcome.

> ⚠️ **Security issues are different.** Never open a public issue, PR, or
> discussion for a vulnerability. Follow the private process in
> [`SECURITY.md`](./SECURITY.md).

---

## Repository Structure

```
ForgeChat/
├── backend/              # Node.js 20 + Express 4 API (pg, BullMQ)
│   ├── src/
│   │   ├── index.js            # bootstrap, middleware, route mounting
│   │   ├── auth.js             # JWT auth + user management
│   │   ├── db.js               # pg Pool config
│   │   ├── engine/             # automation engine
│   │   ├── integrations/       # Meta send / media / templates
│   │   ├── queue/              # BullMQ send + media-download queues
│   │   ├── routes/             # webhook, messages, templates, broadcasts, …
│   │   ├── services/           # message sender, media downloader, …
│   │   └── util/crypto.js      # AES-256-GCM token encryption
│   ├── scripts/                # cron jobs (sync, analytics, cleanup)
│   └── .env.example            # backend configuration template
├── frontend/             # React 18 + Vite (inline styles, no Tailwind)
│   └── src/
│       ├── App.jsx
│       ├── api.js              # fetch wrapper for every endpoint
│       ├── components/         # ChatsPage, ChatWindow, AutomationBuilder, …
│       └── pages/              # TemplateBuilder, BulkMessage, AdminSettings, …
├── db/migrations/        # numbered SQL migration files (0NN_*.sql)
├── docs/                 # screenshots and supporting docs
└── docker-compose.sample.yml  # deployment template (copy to docker-compose.yml)
```

See [`README.md`](./README.md) for the architecture overview and
[`DEPLOY.md`](./DEPLOY.md) for production deployment.

---

## Local Development Setup

### Prerequisites

- **Node.js 20.x** and npm (the version the backend targets).
- **Docker** (for running PostgreSQL and Redis locally).
- **Git**.

### 1. Fork and clone

External contributors should **fork** the repository, then clone their fork and
add this repo as the `upstream` remote so you can keep your branch in sync:

```bash
git clone https://github.com/<your-username>/ForgeChat.git
cd ForgeChat
git remote add upstream https://github.com/Forgemind-git/ForgeChat.git
```

### 2. Start PostgreSQL and Redis

ForgeChat needs PostgreSQL 15 and Redis. The quickest way to get both with
published ports for a natively-run backend:

```bash
docker run -d --name forgechat-dev-db \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
  -p 5432:5432 postgres:15

docker run -d --name forgechat-dev-redis -p 6379:6379 redis:7-alpine
```

> The repository's `docker-compose.sample.yml` is the **production** stack and
> does not publish the database port, so prefer the commands above for local
> development.

### 3. Configure and run the backend

```bash
cd backend
cp .env.example .env
npm install
```

Edit `.env`. At minimum the backend requires:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | e.g. `postgres://postgres:postgres@localhost:5432/postgres` |
| `JWT_SECRET` | any long random string for signing auth tokens |
| `FORGECRM_ENCRYPTION_KEY` | random passphrase for AES-256-GCM token encryption (SHA-256'd to a 32-byte key) |
| `REDIS_URL` | e.g. `redis://localhost:6379` (required for BullMQ queues) |
| `PORT` | `3001` for local dev |
| `CORS_ORIGIN` | `http://localhost:5173` (the Vite dev server) |

WhatsApp send/receive features additionally need `META_ACCESS_TOKEN`,
`META_API_VERSION`, and `META_WEBHOOK_VERIFY_TOKEN`. You can work on most of the
UI and API without these — leave them unset until you need live Meta calls.
`backend/.env.example` documents every supported variable, including optional
queue/rate tuning.

Apply the database migrations (see the next section), then start the API:

```bash
npm run dev               # nodemon on the PORT you set (e.g. :3001)
```

### 4. Run the frontend

```bash
cd frontend
npm install
npm run dev               # Vite on :5173, proxies /api + /uploads to the backend
```

Open <http://localhost:5173>.

---

## Database Migrations

Schema changes live as **numbered SQL files** in `db/migrations/`
(`0NN_short_description.sql`).

- **Never edit a migration that has already been applied / merged** — add a new,
  higher-numbered file instead.
- Apply migrations in order against your local database:

```bash
for f in db/migrations/*.sql; do
  psql "postgres://postgres:postgres@localhost:5432/postgres" -f "$f"
done
```

Include any new migration in the same PR as the code that depends on it, and
mention it in your PR description.

---

## Coding Conventions

Match the style of the surrounding code. The established patterns are:

- **Frontend** — React 18 + Vite with **inline styles** (no Tailwind, no CSS
  frameworks), DM Sans / DM Mono fonts, and `lucide-react` for icons. Reuse the
  existing components in `frontend/src/components` rather than duplicating UI.
- **Backend** — Express 4 with the `pg` Pool and **raw, parameterized SQL**
  (no ORM, **no string interpolation** in queries — always use `$1, $2 …`
  placeholders).
- **Security** — never log or commit secrets; keep Meta tokens encrypted via the
  AES-256-GCM helper in `util/crypto.js`; use httpOnly cookies for auth;
  validate and normalize external input.
- **Scope** — keep each change tightly focused. Don't restyle or refactor
  unrelated code in the same PR; it makes review harder and risks regressions.
- Avoid leaving commented-out code, debug `console.log`s, or typos.

> There is no automated linter/formatter configured yet. Until one is added,
> please keep formatting consistent with nearby files.

---

## Testing

The **frontend** has unit tests (Vitest) and end-to-end tests (Playwright):

```bash
cd frontend
npm run test:unit         # Vitest unit tests
npm run test:e2e          # Playwright E2E
npm test                  # both
```

Please add or update tests for any frontend change, and make sure the suite
passes before opening a PR.

The **backend** does not yet have an automated test suite. For backend changes,
verify behaviour manually and describe how you tested it in the PR. The
in-app **Send-Test-Webhook** tool and the webhook replay feature are useful for
exercising the inbound message pipeline without a live Meta account. Adding
backend tests is itself a welcome contribution.

---

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short imperative subject
```

Common types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `perf`.
Use the same format for your **PR title**, since it becomes the squash-merge
commit message.

Examples:

```
feat(broadcasts): add audio message type
fix(webhook): handle missing contact name
docs(contributing): document local Redis setup
```

---

## Developer Certificate of Origin (DCO)

To certify that you wrote the contribution, or otherwise have the right to
submit it under the project's license, **sign off every commit**:

```bash
git commit -s -m "feat(scope): your change"
```

The `-s` flag appends a `Signed-off-by: Your Name <your@email>` line, indicating
you agree to the [Developer Certificate of Origin](https://developercertificate.org/).
PRs whose commits are not signed off cannot be merged.

---

## License of Contributions

ForgeChat is distributed under the [Sustainable Use License](./LICENSE.md). By
submitting a contribution, you agree that it is licensed under the same
Sustainable Use License (**inbound = outbound**). No separate copyright
assignment or CLA is required.

---

## Branch & Pull Request Workflow

1. **Sync** your fork's `main` with upstream before branching:
   ```bash
   git fetch upstream && git checkout main && git merge upstream/main
   ```
2. **Branch** off `main` with a descriptive name: `feat/<topic>`, `fix/<topic>`,
   or `docs/<topic>`.
3. **Commit** in small, logical, signed-off steps using Conventional Commits.
4. **Push** to your fork and **open a pull request** against
   `Forgemind-git/ForgeChat:main`. Fill in the description: what changed, why,
   how you tested it, and any related issue (`Closes #123`).
5. **Respond to review.** Please address requested changes or reply within
   **14 days** — stale PRs may be closed, but you're welcome to reopen them once
   you've made progress.
6. PRs are typically **squash-merged**, so the PR title becomes the commit
   message — keep it Conventional-Commit-formatted.

---

## Pull Request Checklist

Before requesting review, confirm:

- [ ] Branch is up to date with `upstream/main`.
- [ ] The change is focused on a single concern.
- [ ] Frontend tests pass (`npm test` in `frontend/`) and you added tests where
      relevant.
- [ ] Any schema change is a new numbered migration in `db/migrations/`.
- [ ] Commits follow Conventional Commits and are signed off (`-s`).
- [ ] Docs are updated if behaviour changed, including a `## [Unreleased]` entry
      in [`CHANGELOG.md`](./CHANGELOG.md).
- [ ] No secrets, `.env` files, or generated artifacts are committed.

---

## Getting Help

- Open a [GitHub issue](https://github.com/Forgemind-git/ForgeChat/issues) for
  questions, bugs, or feature discussion.
- New to the project? Look for issues labelled **good first issue**, and feel
  free to add yourself to [`AUTHORS.md`](./AUTHORS.md) in your first PR.

Thank you for contributing! 🙌
