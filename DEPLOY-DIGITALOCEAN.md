# Deploy ForgeChat to a DigitalOcean Droplet (Ubuntu) — `forgechat.example.com`

End-to-end guide to run ForgeChat on a fresh DigitalOcean Ubuntu droplet using Docker
Compose + Caddy (automatic HTTPS). Stack: **PostgreSQL + Redis + backend + frontend(nginx)
+ Caddy**. No Supabase, no MinIO — media is stored in Postgres.

> Repo: `https://github.com/Forgemind-git/Forge-Chat` (branch `main`). If your code lives in
> a different repo (e.g. a personal fork), substitute that URL everywhere below.

---

## 0. Prerequisites

- A DigitalOcean account.
- The domain `example.com` with access to its DNS records.
- ~10 minutes.

**Droplet size:** the frontend build (Vite) + npm installs are memory-hungry. Use **2 GB RAM
or larger** ($12/mo "Basic"). A 1 GB droplet works only if you add swap (Step 3.5).

---

## 1. Create the droplet

1. DigitalOcean → **Create → Droplets**.
2. **Region:** closest to your users. **Image:** Ubuntu 24.04 (LTS) x64.
3. **Size:** Basic → Regular → **2 GB / 1 CPU** (or bigger).
4. **Authentication:** SSH key (recommended) or password.
5. **Hostname:** `forgechat`. Create.
6. Copy the droplet's **public IPv4** (e.g. `203.0.113.10`).

---

## 2. Point DNS at the droplet

In whatever manages DNS for `example.com` (DigitalOcean → Networking → Domains, or your
registrar), add an **A record**:

| Type | Host/Name | Value (points to) | TTL |
|------|-----------|-------------------|-----|
| A | `forgechat` | `<droplet-ipv4>` | 3600 (or default) |

This makes `forgechat.example.com` resolve to the droplet. Verify from your laptop:

```bash
dig +short forgechat.example.com      # should print the droplet IP
```

> Wait until this returns the droplet IP before Step 8 — Caddy needs DNS resolving to issue
> the TLS certificate.

---

## 3. First login + base server setup

SSH in as root:

```bash
ssh root@<droplet-ipv4>
```

Update the system and create a non-root sudo user:

```bash
apt update && apt -y upgrade
adduser deploy                       # set a password when prompted
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # copy SSH key (if you used one)
```

### 3.5 (Only on a 1 GB droplet) add swap so the build doesn't OOM

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### Firewall

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Now reconnect as the `deploy` user for the rest:

```bash
exit
ssh deploy@<droplet-ipv4>
```

---

## 4. Install Docker + Docker Compose

```bash
# Official Docker install
curl -fsSL https://get.docker.com | sudo sh

# Run docker without sudo (log out/in after, or run `newgrp docker`)
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

---

## 5. Get the code

If the repo is **public**:

```bash
cd ~
git clone https://github.com/Forgemind-git/Forge-Chat.git forgechat
cd forgechat
```

If the repo is **private**, create a GitHub Personal Access Token (classic, scope `repo`) and:

```bash
cd ~
git clone https://<YOUR_GH_USERNAME>:<YOUR_PAT>@github.com/Forgemind-git/Forge-Chat.git forgechat
cd forgechat
cp docker-compose.sample.yml docker-compose.yml   # your real, gitignored compose
```

> The repo ships `docker-compose.sample.yml` (and `Caddyfile`); the real
> `docker-compose.yml` is gitignored, so copy it from the sample as shown above.
> If your clone lacks these files, use the contents in **Appendix A**.

---

## 6. Create the environment file (`backend/.env`)

Generate strong secrets and write the env file in one go (run from the repo root):

```bash
PGPASS=$(openssl rand -hex 24)
JWT=$(openssl rand -hex 32)
ENCKEY=$(openssl rand -hex 32)
VERIFY=$(openssl rand -hex 16)

cat > backend/.env <<EOF
NODE_ENV=production
PORT=3011

# Database (Postgres container on the compose network)
POSTGRES_PASSWORD=${PGPASS}
DATABASE_URL=postgresql://postgres:${PGPASS}@forgecrm-db:5432/postgres
POSTGRES_SSL=false

# Redis (BullMQ)
REDIS_URL=redis://redis:6379

# Auth + token encryption (keep these secret; rotating them logs everyone out /
# makes stored Meta tokens unreadable)
JWT_SECRET=${JWT}
FORGECRM_ENCRYPTION_KEY=${ENCKEY}

# Web
CORS_ORIGIN=https://forgechat.example.com

# Meta WhatsApp
META_API_VERSION=v21.0
META_WEBHOOK_VERIFY_TOKEN=${VERIFY}

# Disk path for downloaded chat media (matches the compose volume)
MEDIA_DIR=/app/media
EOF

chmod 600 backend/.env
echo "Webhook verify token (save it for Meta): ${VERIFY}"
```

> `backend/.env` is gitignored — it never goes to GitHub. Keep a copy of the secrets somewhere
> safe.

---

## 7. Build images + start the data layer

```bash
# Build all images (first build downloads base images + compiles the frontend)
docker compose build

# Start Postgres + Redis only, and wait for the DB to be healthy
docker compose up -d forgecrm-db redis
until [ "$(docker inspect -f '{{.State.Health.Status}}' forgecrm-db)" = healthy ]; do
  echo "waiting for postgres..."; sleep 2; done
echo "postgres healthy"
```

---

## 8. Create the schema + apply migrations

ForgeChat keeps its data in a `coexistence` schema. The backend creates the base
`forgecrm_users` table on boot; migration 031 expects it to exist first, so we create it
before applying migrations:

```bash
# 1) schema + base users table
docker compose exec -T forgecrm-db psql -U postgres -d postgres <<'SQL'
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

# 2) apply every migration in numeric order
for f in $(ls db/migrations/*.sql | sort); do
  echo ">> applying $f"
  docker compose exec -T forgecrm-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f" \
    || { echo "MIGRATION FAILED: $f"; break; }
done
echo "migrations done"
```

(You can re-run this block safely — every migration is idempotent.)

---

## 9. Start the app + reverse proxy

```bash
docker compose up -d forgecrm-backend forgecrm-frontend caddy
docker compose ps          # all five should be Up (db/redis "healthy")
```

Caddy now requests a Let's Encrypt certificate for `forgechat.example.com` (needs DNS +
ports 80/443, both already set). Watch it succeed:

```bash
docker compose logs -f caddy        # look for "certificate obtained successfully"; Ctrl-C to exit
```

---

## 10. Verify

```bash
# Backend health (through Caddy → frontend nginx → backend)
curl -fsS https://forgechat.example.com/api/health      # -> {"ok":true}

# Backend logs should show it booted + workers started
docker compose logs forgecrm-backend | tail -n 20
```

Then open **https://forgechat.example.com** in a browser and log in with the seeded admin:

- **Email:** `admin@forgemind.space` (override with `ADMIN_EMAIL`)
- **Password:** whatever you set in `ADMIN_PASSWORD`. If you left it unset, a random password was generated and printed once on first boot — find it with `docker compose logs forgecrm-backend | grep '\[auth\]'`, then change it via Admin Settings → Team.

---

## 11. First-run app setup

1. **Change the admin password / create users** — Settings → **Users** (you can add Sales
   users; admins assign chats to them).
2. **Connect WhatsApp** — Settings → **WhatsApp Accounts → Add**: paste your Display Phone
   Number, Phone Number ID, WABA ID, Meta App ID, and a Meta access token (stored encrypted).
3. **Configure the Meta webhook** (Meta Business Suite → WhatsApp → Configuration):
   - **Callback URL:** `https://forgechat.example.com/api/webhook/whatsapp`
   - **Verify token:** the `META_WEBHOOK_VERIFY_TOKEN` printed in Step 6.
   - Subscribe to **messages**.

---

## 12. Updating / redeploying (after pushing new code to GitHub)

```bash
cd ~/forgechat
git pull
docker compose build forgecrm-backend forgecrm-frontend
docker compose up -d forgecrm-backend forgecrm-frontend
# If you pushed new SQL files, apply them:
for f in $(ls db/migrations/*.sql | sort); do
  docker compose exec -T forgecrm-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f" >/dev/null 2>&1
done
```

---

## 13. Backups (do this!)

The Postgres volume holds everything, including AES-encrypted Meta tokens. Add a daily dump:

```bash
mkdir -p ~/backups
crontab -e
# add this line (3 AM daily, 7-day retention):
0 3 * * * docker exec forgecrm-db pg_dump -U postgres postgres | gzip > ~/backups/forgechat-$(date +\%Y\%m\%d).sql.gz && find ~/backups -name '*.sql.gz' -mtime +7 -delete
```

Restore (into a fresh DB) if ever needed:

```bash
gunzip -c ~/backups/forgechat-YYYYMMDD.sql.gz | docker exec -i forgecrm-db psql -U postgres -d postgres
```

---

## 14. Troubleshooting

| Symptom | Fix |
|---|---|
| Caddy can't get a cert | DNS not pointing to the droplet yet (`dig +short forgechat.example.com`), or ports 80/443 blocked (`sudo ufw status`). Fix, then `docker compose restart caddy`. |
| `502`/blank page | Backend not up: `docker compose logs forgecrm-backend`. Often a bad `DATABASE_URL` (must match `POSTGRES_PASSWORD`) or migrations not applied. |
| Login fails / "Invalid credentials" | Migrations applied + backend booted? The admin is seeded on first backend boot. Check `docker compose logs forgecrm-backend | grep admin`. |
| Build killed / OOM | Add swap (Step 3.5) or use a 2 GB droplet. |
| Frontend build can't reach API | Not needed at build time — the SPA calls `/api` relative to its own origin; Caddy + nginx route it. |
| Changed `.env` | `docker compose up -d` (recreates affected containers). For DB password changes you must recreate the `pgdata` volume or `ALTER USER`. |

---

## Appendix A — create `docker-compose.yml` + `Caddyfile` on the server

If your clone doesn't already include these, create them at the repo root. (They're the same
files committed in the repo; copy from there.) `docker-compose.yml` defines the five services
(db, redis, backend, frontend, caddy) and `Caddyfile` contains:

```
forgechat.example.com {
    reverse_proxy forgecrm-frontend:80
}
```

---

## Architecture recap

```
Browser ──HTTPS──► Caddy (:443, auto-TLS)
                      │
                      ▼
            forgecrm-frontend (nginx :80)
              ├─ serves the React SPA
              └─ proxies /api, /api/events, /uploads, /l/ ──► forgecrm-backend (:3011)
                                                                  ├─ Postgres (forgecrm-db:5432, coexistence schema)
                                                                  └─ Redis (redis:6379, BullMQ queues)
```
