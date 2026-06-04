#!/usr/bin/env bash
#
# ForgeChat - one-command server installer.
#
# Deploys ForgeChat on a public server with automatic HTTPS (Let's Encrypt via
# the bundled Caddy). It only asks for your domain; everything else - secrets,
# database, migrations, certificate - is handled automatically on first boot.
#
# Run it from inside the cloned repo:
#   ./install.sh                      # interactive: prompts for your domain
#   ./install.sh chat.example.com     # non-interactive (domain as an argument)
#   DOMAIN=chat.example.com ./install.sh
#
# Requirements: a server with a public IP, ports 80 + 443 free, and a domain
# whose DNS A record points at this server. (For a local/laptop run without a
# domain, use `docker compose up -d` instead - see the README.)
#
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

# -- pretty output ------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$(printf '\033[1m'); RED=$(printf '\033[31m'); GRN=$(printf '\033[32m')
  YLW=$(printf '\033[33m'); CYN=$(printf '\033[36m'); RST=$(printf '\033[0m')
else
  BOLD=""; RED=""; GRN=""; YLW=""; CYN=""; RST=""
fi
ok()   { printf '%s\xe2\x9c\x93%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$RST" "$*"; }
die()  { printf '%s%s%s\n' "$RED" "$*" "$RST" >&2; exit 1; }
ask_continue() {
  printf '%s [y/N]: ' "$1"
  read -r _r
  case "$_r" in y|Y|yes|YES) return 0 ;; *) die "Aborted." ;; esac
}

printf '%sForgeChat server installer%s\n' "$BOLD" "$RST"
printf -- '------------------------------------------------------------\n'

# -- 1. prerequisites ---------------------------------------------------------
command -v docker >/dev/null 2>&1 \
  || die "Docker isn't installed. Install it first:  curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 \
  || die "Docker Compose v2 isn't available. Update Docker, then re-run."
if [ ! -f docker-compose.yml ] || [ ! -f docker-compose.prod.yml ]; then
  die "Run this from the cloned ForgeChat directory (compose files not found here)."
fi
ok "Docker and Compose detected"

# Is our stack already running? (a re-run, e.g. to renew/update) - so we don't
# false-alarm on "ports in use" when the busy proxy is our own Caddy.
ALREADY_UP=""
if "${COMPOSE[@]}" ps --services --filter status=running 2>/dev/null | grep -q '^caddy$'; then
  ALREADY_UP=1
fi

# -- 2. domain ----------------------------------------------------------------
DOMAIN="${1:-${DOMAIN:-}}"
if [ -z "$DOMAIN" ]; then
  printf '\n'
  printf 'Enter the domain this ForgeChat will be reached at.\n'
  printf 'It must be a domain %syou own%s (e.g. chat.yourbusiness.com) whose DNS\n' "$BOLD" "$RST"
  printf '%sA record points at this server%s. Do not use someone else'"'"'s domain.\n' "$BOLD" "$RST"
  printf '%sDomain:%s ' "$CYN" "$RST"
  read -r DOMAIN
fi
# normalise: strip whitespace, scheme, and any trailing path
DOMAIN="$(printf '%s' "$DOMAIN" | tr -d '[:space:]')"
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
[ -n "$DOMAIN" ] || die "A domain is required for a server install."
case "$DOMAIN" in
  *.*) : ;;
  *)   die "\"$DOMAIN\" doesn't look like a domain (need something like chat.example.com)." ;;
esac
ok "Domain: $DOMAIN"

# -- 3. pre-flight: ports 80/443 free -----------------------------------------
if [ -z "$ALREADY_UP" ] && command -v ss >/dev/null 2>&1; then
  busy=""
  ss -ltn 2>/dev/null | grep -qE ':80($| )'  && busy="80"
  ss -ltn 2>/dev/null | grep -qE ':443($| )' && busy="${busy:+$busy and }443"
  if [ -n "$busy" ]; then
    warn "Something is already using port $busy on this server."
    warn "ForgeChat's HTTPS proxy needs 80 and 443 free - another web server or"
    warn "reverse proxy is probably running. Stop it, or use a clean server."
    ask_continue "Continue anyway?"
  else
    ok "Ports 80 and 443 are free"
  fi
fi

# -- 4. pre-flight: does the domain point at this server? ---------------------
# The #1 cause of a failed HTTPS setup is the DNS A record not pointing here yet
# - Let's Encrypt then can't verify the domain and no certificate is issued.
myip="$(curl -fsS --max-time 6 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 6 https://ifconfig.me 2>/dev/null || true)"
domip="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1; exit}')"
if [ -n "$myip" ] && [ "$domip" = "$myip" ]; then
  ok "$DOMAIN points at this server ($myip)"
elif [ -n "$myip" ] && [ -n "$domip" ]; then
  warn "$DOMAIN currently resolves to $domip, but this server is $myip."
  warn "Add/fix the DNS A record:  $DOMAIN  ->  $myip   (then HTTPS can be issued)."
  ask_continue "Continue anyway (the certificate will fail until DNS is fixed)?"
elif [ -n "$myip" ]; then
  warn "$DOMAIN doesn't resolve yet."
  warn "Add a DNS A record:  $DOMAIN  ->  $myip   (then HTTPS can be issued)."
  ask_continue "Continue anyway (the certificate will fail until DNS is fixed)?"
fi

# -- 5. deploy ----------------------------------------------------------------
printf '\n%sStarting ForgeChat for %s%s - building images (first run takes a few minutes)...\n' "$BOLD" "$DOMAIN" "$RST"
DOMAIN="$DOMAIN" "${COMPOSE[@]}" up -d --build

# -- 6. wait for HTTPS, then summarise ----------------------------------------
url="https://$DOMAIN"
printf '\nWaiting for the HTTPS certificate (Caddy + Let'"'"'s Encrypt)...\n'
ready=""
for _ in $(seq 1 30); do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || true)"
  case "$code" in 200|30[0-9]) ready=1; break ;; esac
  sleep 4
done

printf -- '------------------------------------------------------------\n'
if [ -n "$ready" ]; then
  ok "ForgeChat is live at ${BOLD}${url}${RST}"
else
  warn "Containers are up, but $url didn't answer yet."
  warn "If you just pointed DNS, give the certificate a minute, then reload."
  warn "Watch the proxy logs:  ${COMPOSE[*]} logs -f caddy"
fi
cat <<EOF

Next steps:
  1. Open ${BOLD}${url}${RST} and create your admin account.
  2. Connect WhatsApp in Settings (see the README, "Connect your WhatsApp").

Manage it later from this folder:
  ${COMPOSE[*]} ps          # status
  ${COMPOSE[*]} logs -f     # logs
  ${COMPOSE[*]} down        # stop
EOF
