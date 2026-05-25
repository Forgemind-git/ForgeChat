<#
  ForgeChat one-command installer — Windows (local / testing).

  Collapses the manual README steps into a single run: generates secrets,
  writes backend\.env, builds the images, starts the database, applies every
  migration, and brings the app up at http://localhost.

  Safe to re-run: it never overwrites an existing backend\.env, so your
  secrets are preserved. Delete backend\.env first to regenerate them.

  Run in PowerShell, from inside the forgechat folder:
      .\install.ps1

  (For a real 24/7 deployment with a domain, use a Linux server + install.sh.)
#>
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Say($m) { Write-Host $m -ForegroundColor Cyan }
function OK($m)  { Write-Host "$([char]0x2713) $m" -ForegroundColor Green }
function Warn($m){ Write-Host "! $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "$([char]0x2717) $m" -ForegroundColor Red; exit 1 }

# ── 0. Prerequisites ────────────────────────────────────────────────────────
try { docker version *> $null } catch {
  Die "Docker Desktop isn't installed or isn't running. Get it from https://www.docker.com/products/docker-desktop/ , start it (wait for 'Engine running'), then re-run this script."
}
try { docker compose version *> $null } catch { Die "Docker Compose v2 isn't available. Update Docker Desktop, then re-run." }

Say "ForgeChat installer (Windows - local mode, http://localhost)"

# ── 1. Inputs ───────────────────────────────────────────────────────────────
$ADMIN_EMAIL = Read-Host "Admin email [admin@forgechat.local]"
if (-not $ADMIN_EMAIL) { $ADMIN_EMAIL = 'admin@forgechat.local' }
$pwSecure = Read-Host "Admin password [Admin@123456]" -AsSecureString
$ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $pwSecure).Password
if (-not $ADMIN_PASSWORD) { $ADMIN_PASSWORD = 'Admin@123456' }

# ── 2. docker-compose.yml ───────────────────────────────────────────────────
if (-not (Test-Path docker-compose.yml)) { Copy-Item docker-compose.sample.yml docker-compose.yml }

# ── 3. Secrets -> backend\.env (never overwrite) ────────────────────────────
$VERIFY = $null
if (Test-Path "backend\.env") {
  Warn "backend\.env already exists - keeping it (delete it first to regenerate secrets)."
} else {
  $rand = { param($n) -join ((48..57 + 65..90 + 97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }
  $PGPASS = & $rand 32; $JWT = & $rand 64; $ENCKEY = & $rand 64; $VERIFY = & $rand 32
  @"
NODE_ENV=production
PORT=3011
POSTGRES_PASSWORD=$PGPASS
DATABASE_URL=postgresql://postgres:$PGPASS@forgecrm-db:5432/postgres
POSTGRES_SSL=false
REDIS_URL=redis://redis:6379
JWT_SECRET=$JWT
FORGECRM_ENCRYPTION_KEY=$ENCKEY
CORS_ORIGIN=http://localhost
META_API_VERSION=v21.0
META_WEBHOOK_VERIFY_TOKEN=$VERIFY
MEDIA_DIR=/app/media
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
"@ | Out-File -FilePath "backend\.env" -Encoding utf8
  OK "Wrote backend\.env"
}

# ── 4. Build + database + migrations ────────────────────────────────────────
Say "Building images (first run takes a few minutes)..."
docker compose build
if ($LASTEXITCODE -ne 0) { Die "docker compose build failed." }

Say "Starting database + Redis..."
docker compose up -d forgecrm-db redis
Write-Host -NoNewline "Waiting for the database to be ready"
do {
  Start-Sleep -Seconds 2
  Write-Host -NoNewline "."
  $health = (docker inspect -f '{{.State.Health.Status}}' forgecrm-db 2>$null)
} until ($health -eq 'healthy')
Write-Host ""

Say "Creating the schema and applying all migrations..."
@"
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
"@ | docker exec -i forgecrm-db psql -U postgres -d postgres | Out-Null
Get-ChildItem "db\migrations\*.sql" | Sort-Object Name | ForEach-Object {
  Get-Content $_.FullName | docker exec -i forgecrm-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 | Out-Null
}
OK "Database ready."

# ── 5. Start the app ────────────────────────────────────────────────────────
docker compose up -d forgecrm-backend forgecrm-frontend

Write-Host ""
OK "ForgeChat is up!"
Write-Host "  Open:   http://localhost"
Write-Host "  Login:  $ADMIN_EMAIL"
if ($VERIFY) { Write-Host "  Webhook verify token: $VERIFY   (save this - you'll need it when connecting WhatsApp)" }
Write-Host ""
Write-Host "To let WhatsApp reach this PC, open a Cloudflare Tunnel (no account needed):"
Write-Host "  winget install --id Cloudflare.cloudflared"
Write-Host "  cloudflared tunnel --url http://localhost:80"
Write-Host "then point CORS_ORIGIN + the Meta webhook at the https://...trycloudflare.com URL it prints."
