# Versioning & Upgrade Policy

ForgeChat follows [Semantic Versioning](https://semver.org/). This page is the
contract self-hosters rely on to upgrade safely.

## What each version bump means

| Change | Example | Promise to users |
|--------|---------|------------------|
| **Patch** | `1.4.0 → 1.4.1` | Bug fixes only. Always safe to upgrade. |
| **Minor** | `1.4.0 → 1.5.0` | New features, backward-compatible. Safe to upgrade. |
| **Major** | `1.x → 2.0.0` | Contains breaking changes. Read the upgrade notes first. |

## Principles

- **Database migrations move forward only.**
  Migrations are numbered, ordered SQL files in `db/migrations/` and are
  idempotent (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). A user
  upgrading from an older version must have their PostgreSQL data migrated
  cleanly with no manual steps. Never drop or rename a column without a
  transition period.

- **Deprecate before you remove.**
  When renaming an environment variable or changing an API response, keep the
  old form working for one or two releases with a deprecation warning, then
  remove it only in a major version. Give people a window to adapt.

- **Every release gets a CHANGELOG entry.**
  Record what changed in [`CHANGELOG.md`](./CHANGELOG.md). Any release with
  breaking changes must include explicit, written upgrade steps (how to go from
  v1 to v2).

- **Let CI enforce it.**
  The Test & Lint workflow applies every migration against a fresh PostgreSQL on
  each PR, so schema breakage is caught before release. (A dedicated old→new
  upgrade-path test is planned as a follow-up.)

## Releases & images

Each release is tagged `vX.Y.Z` and publishes pre-built, versioned images to
GHCR via the [Publish Docker Images](./.github/workflows/docker-publish.yml)
workflow:

```
ghcr.io/forgemind-git/forge-chat-backend:<version>
ghcr.io/forgemind-git/forge-chat-frontend:<version>
```

Pin to a specific version in production and review the CHANGELOG before
upgrading across a major version.
