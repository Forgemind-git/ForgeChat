#!/usr/bin/env bash
#
# ForgeChat one-command installer — macOS & Linux.
#
# Collapses the manual README steps into a single interactive run:
#   generates secrets, writes backend/.env, builds the images, starts the
#   database, applies every migration, and brings the app up.
#
# Safe to re-run: it never overwrites an existing backend/.env, so your
# secrets are preserved. Delete backend/.env first if you want fresh ones.
#
#   Local (this computer):   bash install.sh
#   Server (your domain):    bash install.sh    # then choose "2) Server"
#
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\033[1;36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. Prerequisites ────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  if [ "$(uname -s)" = "Linux" ]; then
    say "Docker not found — installing it via get.docker.com (needs sudo)…"
    curl -fsSL https://get.docker.com | sh
  else
    die "Docker Desktop isn't installed. Get it from https://www.docker.com/products/docker-desktop/ , start it, then re-run this script."
  fi
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 isn't available. Update Docker, then re-run."
command -v openssl  >/dev/null 2>&1 || die "openssl is required but not found."
docker info >/dev/null 2>&1 || die "Docker isn't running. Start Docker (Desktop), then re-run."

# ── 1. Mode ─────────────────────────────────────────────────────────────────
say "ForgeChat installer"
echo "  1) Local   — run on this computer at http://localhost (testing & demos)"
echo "  2) Server  — production with your own domain + automatic HTTPS (24/7)"
read -rp "Choose [1/2]: " choice
case "$choice" in
  1) MODE=local  ;;
  2) MODE=server ;;
  *) die "Please enter 1 or 2." ;;
esac

# ── 2. Inputs ───────────────────────────────────────────────────────────────
if [ "$MODE" = server ]; then
  read -rp "Your domain (e.g. chat.yourbusiness.com): " DOMAIN
  [ -n "${DOMAIN:-}" ] || die "A domain is required for server mode."
  CORS="https://$DOMAIN"
  default_email="you@$DOMAIN"
  default_pw=""
else
  CORS="http://localhost"
  default_email="admin@forgechat.local"
  default_pw="Admin@123456"
fi

read -rp "Admin email [$default_email]: " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-$default_email}"
read -rsp "Admin password${default_pw:+ [$default_pw]}: " ADMIN_PASSWORD; echo
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$default_pw}"
[ -n "$ADMIN_PASSWORD" ] || die "An admin password is required."

# ── 3. docker-compose.yml + Caddyfile ───────────────────────────────────────
[ -f docker-compose.yml ] || cp docker-compose.sample.yml docker-compose.yml
if [ "$MODE" = server ]; then
  # sed -i.bak works on both GNU (Linux) and BSD (macOS) sed
  sed -i.bak "s/forgechat\.example\.com/$DOMAIN/g" Caddyfile && rm -f Caddyfile.bak
  ok "Caddyfile pointed at $DOMAIN"
else
  # Local mode never starts Caddy, so nothing maps host port 80 — the frontend's
  # internal nginx (port 80) is unreachable from the host. Inject a "80:80"
  # mapping on the forgecrm-frontend service so http://localhost works out of
  # the box. Idempotent: only inject if forgecrm-frontend doesn't already have
  # that port mapping inside its own block (the sample file has "80:80" under
  # the unrelated caddy service, so a file-wide grep would false-positive).
  has_port=$(awk '
    /^  forgecrm-frontend:[[:space:]]*$/ { in_block=1; next }
    /^  [a-z][a-z0-9_-]*:[[:space:]]*$/ { in_block=0 }
    in_block && /^[[:space:]]+- "80:80"[[:space:]]*$/ { print "yes"; exit }
  ' docker-compose.yml)
  if [ "$has_port" != "yes" ]; then
    awk '
      /^  forgecrm-frontend:[[:space:]]*$/ && !done {
        print
        print "    ports:"
        print "      - \"80:80\""
        done = 1
        next
      }
      { print }
    ' docker-compose.yml > docker-compose.yml.tmp && mv docker-compose.yml.tmp docker-compose.yml
    ok "Mapped frontend on host port 80 (local mode)"
  fi
fi

# ── 4. Secrets → backend/.env (never overwrite) ─────────────────────────────
VERIFY=""
if [ -f backend/.env ]; then
  warn "backend/.env already exists — keeping it (delete it first to regenerate secrets)."
else
  PGPASS=$(openssl rand -hex 24)
  JWT=$(openssl rand -hex 32)
  ENCKEY=$(openssl rand -hex 32)
  VERIFY=$(openssl rand -hex 16)
  cat > backend/.env <<EOF
NODE_ENV=production
PORT=3011
POSTGRES_PASSWORD=${PGPASS}
DATABASE_URL=postgresql://postgres:${PGPASS}@forgecrm-db:5432/postgres
POSTGRES_SSL=false
REDIS_URL=redis://redis:6379
JWT_SECRET=${JWT}
FORGECRM_ENCRYPTION_KEY=${ENCKEY}
CORS_ORIGIN=${CORS}
META_API_VERSION=v21.0
META_WEBHOOK_VERIFY_TOKEN=${VERIFY}
MEDIA_DIR=/app/media
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
EOF
  chmod 600 backend/.env
  ok "Wrote backend/.env"
fi

# ── 5. Build + database + migrations ────────────────────────────────────────
say "Building images (first run takes a few minutes)…"
docker compose build

say "Starting database + Redis…"
docker compose up -d forgecrm-db redis
printf "Waiting for the database to be ready"
until [ "$(docker inspect -f '{{.State.Health.Status}}' forgecrm-db 2>/dev/null || true)" = "healthy" ]; do
  printf '.'; sleep 2
done
printf '\n'

say "Creating the schema and applying all migrations…"
docker compose exec -T forgecrm-db psql -U postgres -d postgres >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS coexistence;
CREATE TABLE IF NOT EXISTS coexistence.forgecrm_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL
for f in $(ls db/migrations/*.sql | sort); do
  docker compose exec -T forgecrm-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f" >/dev/null
done
ok "Database ready."

# ── 6. Start the app ────────────────────────────────────────────────────────
if [ "$MODE" = server ]; then
  docker compose up -d forgecrm-backend forgecrm-frontend caddy
  URL="https://$DOMAIN"
else
  docker compose up -d forgecrm-backend forgecrm-frontend
  URL="http://localhost"
fi

echo
ok "ForgeChat is up!"
echo "  Open:   $URL"
echo "  Login:  $ADMIN_EMAIL"
[ -n "$VERIFY" ] && echo "  Webhook verify token: $VERIFY   (save this — you'll need it when connecting WhatsApp)"
if [ "$MODE" = local ]; then
  echo
  echo "To let WhatsApp reach this computer, open a Cloudflare Tunnel (no account needed):"
  echo "  cloudflared tunnel --url http://localhost:80"
  echo "then point CORS_ORIGIN + the Meta webhook at the https://…trycloudflare.com URL it prints."
fi
