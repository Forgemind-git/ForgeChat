# ForgeCRM OSS — Session Handoff (Simplification Effort)

> **Read this first when resuming.** It records a multi-task session that simplified ForgeCRM OSS,
> module by module, into a **single-owner, stripped-down WhatsApp CRM**. Date: **2026-05-22**.
> Login: `admin@forgemind.space` / your `ADMIN_PASSWORD` (or the password printed in the backend logs on first boot). App: backend `:3001`, frontend `:5173`.

## TL;DR — what this session did

Transformed the CRM from a multi-user, multi-WABA, feature-rich product into a lean **single-owner,
single-WhatsApp-account** tool. Each task followed the user's pattern: *Keep X / Remove Y /
Requirements*. Work was **non-destructive to data** (DB rows/tables/columns preserved; only UI +
routes + logic removed). Every task ended with a build + backend-boot + functional verification.

## Working conventions established this session

- **Non-destructive:** never drop tables/columns or delete records. Remove UI, routes, and logic only.
  Data for removed features is left in place (preserved/viewable).
- **Layered enforcement** when "limiting" something: frontend UX restriction + backend hard guard +
  runtime tolerance + (if needed) one-time migration.
- **Verify every task:** `cd frontend && npm run build`; restart backend (`node src/index.js`) and
  hit `/health` + a functional API check via PowerShell `Invoke-WebRequest`.
- **Dead-code detector** (recreate as `frontend/find-dead.cjs`, run, then delete it): finds unused
  imports + cross-file-unreferenced top-level declarations. NOTE the regex must count `...spread` and
  `obj.member` as usage (lookbehind `(?<![\w$])`, NOT `(?<![\w$.])`) or it false-positives style spreads.
- **Vite build does NOT catch undefined identifiers** (no symbol resolution) — only unresolved
  imports. So removing a *used* component fails at runtime, not build. Verify declaration removals by
  reference-count, not just by building.
- **Parked code** = code for a disabled feature that's still reachable-in-principle (e.g. automation
  node-type panels, engine handlers). The user chose to LEAVE parked code in place ("Safe: only
  provably-unreferenced"). Do not rip it out unless asked.

## Modules changed (in order) — each verified working

1. **Home / Dashboard** — single-user scope; removed team **leaderboard**. (Conversation-volume
   **trend** chart removed from UI earlier; its backend query was later removed in the Categories task.)
   Files: `backend/src/routes/dashboard.js`, `frontend/src/pages/HomePage.jsx`.

2. **Chats** — **polling refresh only**. Removed real-time push (SSE), reactions, quote-reply, starred.
   Deleted `backend/src/events.js` + `backend/src/routes/events.js` + `frontend/src/hooks/useServerEvents.js`;
   cleaned `messages.js`, `sendQueue.js`, `metaSend.js`, `index.js`, ChatWindow/MessageBubble/ContactList/NumberSidebar.

3. **Contacts** — kept list / view / save / apply tags. Removed custom fields, contact assignment,
   ownership, team ownership, **and roles** ("everyone sees all"). `permissions.js` stubbed to allow-all;
   `contactFields.js` made read-only (GET only); Admin Settings **Fields tab** removed.

4. **Message Templates** — kept create / submit-to-Meta / approval status / live phone preview.
   Removed analytics, revision history, template library, version tracking. Preserved Meta API integration.

5. **Media** — kept upload / preview / use. **Per-account ownership** (media belongs to the connected
   account). Removed shared libraries + multi-account access. Migration **039_media_account_owner.sql**.

6. **Bulk Messaging** — kept broadcast / template send / plain-text send / per-recipient logs.
   Removed variable mapping, dynamic placeholders, scheduling, media-header campaigns, advanced builder.
   Migration **040_broadcast_logs_fields.sql** (added `wa_message_id`,`error_message`; widened status CHECK).

7. **Automations** — **Keyword Trigger + Send Message only**, linear flows. Removed branching,
   conditions, delays, multi-step, all other node types. Enforcement is layered:
   - `backend/src/routes/chatbots.js` → `sanitizeToLinear(config)` collapses any saved config to
     trigger→message→message on POST/PUT (exported for reuse).
   - `backend/src/engine/automationEngine.js` → `NODE_HANDLERS` = `{ trigger, message }`; `walkFrom`
     follows the `default` edge linearly and logs `skipped` for unknown node types; `evaluateTriggers`
     fires keyword triggers only; `resumeAutomation` resumes at the default-edge child.
   - `backend/scripts/migrateLinearAutomations.js` (one-time; ran 0/0 locally).
   - `frontend/src/components/AutomationBuilderView.jsx` → palette reduced to 2 blocks; trigger
     dropdown locked to keyword.
   - **Dead engine handlers** (`executeConditionNode/Delay/Action/Handoff/AI/API/Subflow`) left in
     place as parked code per user choice.

8. **Admin Tags** — kept Create/Edit/Delete (tags require a category, so categories stay).
   No functional change. Did an **app-wide dead-code sweep**: removed unused imports across ~11 files,
   dead declarations (`fmtN`,`Chip`,`PreviewBubble`,`PreviewQR`,`DIRECT_MSG_MAP`,`isImageMime`,
   `TIME_RANGES`,`PlaceholderTab`,`formatDateForInput`), the orphaned `ConfirmDialog.jsx`, and the
   backend `ALERTABLE_TYPES` const.

9. **Admin Categories** — kept Create/Edit/Delete, no functional change. Removed the one remaining
   unused removed-module reference: the `trend` daily-aggregation query + response key in `dashboard.js`.

10. **WhatsApp Accounts** — **exactly one account**. Backend `whatsappAccounts.js`: POST returns **409**
    if one already exists; lone account forced `is_default=true`; DELETE refuses to remove the last
    account (switch numbers by **editing**). Admin tab kept as an **editable single-account view**
    (no Add when ≥1, no Delete, no default/switch UI — but token/details still editable). Per-feature
    account pickers **hidden, auto-use the one account** (Templates, WA Links, Automations send-from +
    listen-on filter). MediaLibrary already guarded; Broadcasts has no picker (resolves server-side).

11. **Authentication & access** — **single owner login + JWT kept**; removed roles, permissions, teams,
    multi-user, invitations. `backend/src/auth.js`: session = `{id,username,email,displayName,isActive}`,
    JWT payload = `{id,username,displayName}`. Deleted `routes/users.js` (multi-user + invitations +
    audit-log) and `routes/teamMembers.js` (teams); unmounted both in `index.js`. Frontend: removed
    Users + Team Members admin tabs (excised ~760 lines incl. `RoleBadge`/`ROLE_OPTIONS`/`UsersTab`/
    `TeamMembersTab`), dropped App.jsx page guard + Sidebar nav filter (owner sees all), removed role
    refs in Topbar/HomePage, trimmed `api.js` (`users`/`teamMembers`/`auditLog`), converted the
    broadcast "test recipient" team-member pickers (Contacts + Broadcasts) to **plain number inputs**.
    Visibility-scoping in `messages.js`/`dashboard.js`/`middleware/access.js`/`permissions.js` left
    **inert** (owner = admin via `isAdmin()`→true) per user choice.

## Current state / how to run (verified 2026-05-22)

```powershell
# Infra (Docker Desktop must be running)
docker compose -p forgecrm-local -f "local-infra/docker-compose.yml" up -d   # pg :5432, redis :6379, minio :9000
# Backend
cd "ForgeCRM OSS/backend"; node src/index.js          # http://localhost:3001 (/health -> {"ok":true})
# Frontend
cd "ForgeCRM OSS/frontend"; npm run dev                # http://localhost:5173
```
- Login `admin@forgemind.space` / `ADMIN_PASSWORD` (owner account, id=1 — preserved).
- Backend was running as a background process during the session; it stops when the shell ends — restart with the command above.

## Open threads / NOT done (pick up here)

- **Stale project memory:** `ForgeCRM OSS/CLAUDE.md`, `backend/CLAUDE.md`, `frontend/CLAUDE.md` still
  describe removed features (SSE/`events.js`/`useServerEvents`, Fields tab, Users/Team tabs, roles/RBAC,
  `templateAnalytics.js`, multi-account, automation node types). **Offered to refresh; user hasn't asked yet.**
- **Non-destructive DB leftovers** (data kept, logic gone): columns `forgecrm_users.role`,
  `forgecrm_users.permissions`, `contacts.assigned_user_id`; tables `user_wa_assignments`,
  `user_audit_log`, `broadcast_variable_mapping`, `message_reactions`, `contact_field_definitions`,
  `team_members`. No migration written to drop them (would be destructive) — do only if asked.
- **Parked code retained:** automation engine handlers + builder node-type panels (handoff/action/etc.),
  the dashboard/messages visibility-scoping (inert), the no-op "Delete account" placeholder in General settings.
- **No real Meta WABA** configured locally → live WhatsApp send/receive is inert until an account is added in Admin Settings → WhatsApp Accounts (now capped at one).

## Net effect
A single-owner CRM: one login, one WhatsApp account, linear keyword→message automations, template +
text broadcasts with per-recipient logs, contacts with tags, media scoped to the account, and a
single-user dashboard. Frontend bundle shrank from ~860 kB to ~826 kB over the cleanup passes.
