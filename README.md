<p align="center">
  <img src="frontend/public/forgemind-logo.gif" alt="ForgeChat Logo" width="180"/>
</p>

<h1 align="center">ForgeChat</h1>
<p align="center">
  <strong>Your own WhatsApp Business inbox & CRM — running on your own server</strong>
</p>

<p align="center">
  <a href="#-what-is-forgechat">What is it?</a> •
  <a href="#-what-you-can-do">Features</a> •
  <a href="#-deploy-it-yourself">Deploy</a> •
  <a href="#-connect-your-whatsapp">Connect WhatsApp</a> •
  <a href="#-everyday-use">Use it</a> •
  <a href="#-help--troubleshooting">Help</a> •
  <a href="#-community">Community</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue.svg" alt="Version"/>
  <img src="https://img.shields.io/badge/license-Sustainable%20Use-green.svg" alt="License"/>
  <img src="https://img.shields.io/badge/fair--code-%E2%9C%93-brightgreen.svg" alt="fair-code"/>
  <img src="https://img.shields.io/badge/setup-no%20coding%20needed-success.svg" alt="No coding needed"/>
  <img src="https://img.shields.io/badge/docker-ready-2496ED.svg" alt="Docker"/>
</p>

---

## 🤔 What is ForgeChat?

**ForgeChat** is a free WhatsApp Business inbox and CRM that **you host yourself**. Instead of paying a monthly fee to a SaaS company that keeps all your customer chats on *their* servers, you run ForgeChat on your own server — so **you own your data and your customer conversations**.

It connects to the **WhatsApp Cloud API** (part of the **WhatsApp Business Platform**, hosted by Meta) — the documented, ToS-compliant way to send and receive WhatsApp business messages — and gives your whole team a clean, chat-style screen to:

- 💬 **Reply to customers** from a shared team inbox
- 🗂️ **Keep a customer database** with tags, notes, and custom fields
- 📣 **Send bulk broadcasts** to many customers at once
- 🤖 **Build auto-replies** with a drag-and-drop builder (no coding)
- 📋 **Track deals** on a sales pipeline board

> **You don't need to be a programmer to set this up.** This guide walks you through every step — you mostly just copy and paste. It takes about **15–20 minutes**.

---

## 📸 What it looks like

| Team Inbox | Auto-reply Builder |
| :---: | :---: |
| ![Chats](docs/ui-screenshots/11-chats-conversation.png) | ![Automations](docs/ui-screenshots/04-automation-builder.png) |
| **Message Templates** | **Customer Database** |
| ![Templates](docs/ui-screenshots/08-template-builder-form.png) | ![Contacts](docs/ui-screenshots/12-contacts.png) |
| **Bulk Broadcasts** | **Settings** |
| ![Bulk](docs/ui-screenshots/13-bulk-message.png) | ![Admin](docs/ui-screenshots/15-admin-general.png) |

---

## ✨ What you can do

### 💬 Chat with customers
- A **shared team inbox** that looks just like WhatsApp
- Send and receive **text, photos, videos, voice notes, and documents**
- **Record voice notes** right inside the chat box
- React with emojis, reply to specific messages, and star important ones
- ForgeChat reminds you about WhatsApp's **24-hour reply rule** and suggests a template when needed

### 🗂️ Manage customers
- A full **contact list** with names and phone numbers
- Organize people with **color-coded tags and categories**
- Add your own **custom fields** (e.g. city, order number, plan)
- **Import contacts** from an Excel/CSV spreadsheet
- Track sales opportunities on a **deals pipeline (Kanban board)**

### 📣 Reach people at scale
- Build approved **WhatsApp message templates** with a live phone preview
- Send **bulk broadcasts** (templates, text, links, images, video, audio, documents)
- Watch **live delivery status** for every recipient
- See **template performance** with charts and click stats

### 🤖 Automate replies
- A **drag-and-drop builder** for auto-replies — no coding
- Trigger flows on **keywords**, **any new message**, **new contacts**, and delivery/read events
- Every automation run is **logged** so you can see exactly what happened

### 🔐 Keep it secure & organized
- **Team accounts** with roles — admins control who sees what
- Assign specific chats to specific team members
- Secure login, encrypted WhatsApp tokens, and protected access throughout

---

## 🚀 Deploy it yourself

Three ways to run ForgeChat — pick one:

| # | Install on | Best for | Guide |
| --- | --- | --- | --- |
| 1 | 🪟 **Windows** | Trying it on your own PC | [Open ↓](#install-on-windows) |
| 2 | 🍎 **macOS** | Trying it on your own Mac | [Open ↓](#install-on-mac) |
| 3 | 🖥️ **Server** | Real 24/7 use with your own domain | [Open ↓](#run-on-server) |

> **Windows** and **Mac** run on your own computer with Docker Desktop + a free Cloudflare Tunnel — great for testing and demos. The **Server** option is for real production use, online 24/7. Each option's steps below end with how to log in.

⚡ **Prefer one command?** After you've installed Docker and downloaded ForgeChat (the "Install the tools" + "Download" steps inside your platform below), you can skip the rest of the manual setup and run the installer instead — it generates secrets, builds everything, applies all migrations, and starts the app:

- 🍎 **macOS** / 🐧 **Linux server:** `bash install.sh`
- 🪟 **Windows** (PowerShell): `.\install.ps1`

It's safe to re-run — it never overwrites an existing `backend/.env`.

<a id="install-on-windows"></a>
<details>
<summary><strong>🪟 Install on Windows</strong></summary>

<br/>

**1. Install the tools**

- **Git for Windows** — <https://git-scm.com/download/win> (click *Next* through the installer).
- **Docker Desktop** — <https://www.docker.com/products/docker-desktop/> (keep **WSL 2** ticked, restart your PC, then open Docker Desktop and wait for **"Engine running"**).

**2. Download ForgeChat** — open **PowerShell** and run:

```powershell
cd $env:USERPROFILE\Desktop
git clone https://github.com/Forgemind-git/ForgeChat.git forgechat
cd forgechat
```

**3. Run the installer** — it generates secrets, builds everything, applies all migrations, and starts the app:

```powershell
.\install.ps1
```

When it finishes, open **<http://localhost>** and log in with the email/password it asked for (defaults: `admin@forgechat.local` / `Admin@123456`). **Save the webhook verify token** it prints — you'll need it below.

**4. Make it reachable by WhatsApp (Cloudflare Tunnel)** — Meta needs a public URL to deliver messages. Cloudflare Tunnel gives you a free temporary HTTPS URL with **no sign-up**:

```powershell
# one-time: install cloudflared
winget install --id Cloudflare.cloudflared

# open a NEW PowerShell window and start the tunnel — keep this window open
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:80
```

It prints a public address like `https://some-random-words.trycloudflare.com`. Then, in another PowerShell window:

1. Point ForgeChat at that address (use your real URL) and restart the backend:
   ```powershell
   (Get-Content backend\.env) -replace 'CORS_ORIGIN=.*', 'CORS_ORIGIN=https://some-random-words.trycloudflare.com' | Set-Content backend\.env
   docker compose restart forgecrm-backend
   ```
2. Follow **[Connect your WhatsApp](#-connect-your-whatsapp)** below, but use the Cloudflare address as the **Callback URL** (`https://some-random-words.trycloudflare.com/api/webhook/whatsapp`) with the verify token from step 3.

> ℹ️ The quick-tunnel URL changes each time you restart cloudflared — update `CORS_ORIGIN` and the Meta webhook URL whenever it does, and don't close the cloudflared window while testing.

</details>

<a id="install-on-mac"></a>
<details>
<summary><strong>🍎 Install on Mac</strong></summary>

<br/>

**1. Install the tools**

- **Docker Desktop** — <https://www.docker.com/products/docker-desktop/> (pick the **Apple Silicon** or **Intel** build to match your Mac, open it, and wait for **"Engine running"**).
- **Git** — already ships with macOS. The first `git` command may prompt you to install the developer tools — click **Install**, or run `xcode-select --install`.

**2. Download ForgeChat** — open **Terminal** and run:

```bash
cd ~/Desktop
git clone https://github.com/Forgemind-git/ForgeChat.git forgechat
cd forgechat
```

**3. Run the installer** — choose **local** when it asks; it generates secrets, builds everything, applies all migrations, and starts the app:

```bash
bash install.sh
```

When it finishes, open **<http://localhost>** and log in with the email/password it asked for (defaults: `admin@forgechat.local` / `Admin@123456`). **Save the webhook verify token** it prints — you'll need it below.

**4. Make it reachable by WhatsApp (Cloudflare Tunnel)** — Meta needs a public URL to deliver messages. Cloudflare Tunnel gives you a free temporary HTTPS URL with **no sign-up**:

```bash
# install cloudflared (needs Homebrew — https://brew.sh)
brew install cloudflared

# start the tunnel — keep this Terminal window open
cloudflared tunnel --url http://localhost:80
```

It prints a public address like `https://some-random-words.trycloudflare.com`. Then, in another Terminal tab:

1. Point ForgeChat at that address (use your real URL) and restart the backend:
   ```bash
   sed -i '' 's|CORS_ORIGIN=.*|CORS_ORIGIN=https://some-random-words.trycloudflare.com|' backend/.env
   docker compose restart forgecrm-backend
   ```
2. Follow **[Connect your WhatsApp](#-connect-your-whatsapp)** below, but use the Cloudflare address as the **Callback URL** (`https://some-random-words.trycloudflare.com/api/webhook/whatsapp`) with the verify token from step 3.

> ℹ️ The quick-tunnel URL changes each time you restart cloudflared — update `CORS_ORIGIN` and the Meta webhook URL whenever it does, and keep the cloudflared window open while testing.

</details>

<a id="run-on-server"></a>
<details>
<summary><strong>🖥️ Run on a server (production, 24/7)</strong></summary>

<br/>

> 🌐 **The production path** — your own server and domain, online 24/7, with automatic HTTPS.
>
> 💡 **Prefer a click-by-click version with pictures?** Follow **[DEPLOY-DIGITALOCEAN.md](./DEPLOY-DIGITALOCEAN.md)** instead — it's the same process with more detail. The steps below are the short version.

### ✅ What you'll need first

| You need | Roughly | What it's for |
| --- | --- | --- |
| A **server** (a small cloud computer you rent) | ~$12 / month | Where ForgeChat runs, 24/7 |
| A **domain name** (like `chat.yourbusiness.com`) | ~$10 / year | The web address you'll open in the browser |
| A **WhatsApp Business Account** (managed in Meta Business Suite) | Free | To send/receive real WhatsApp messages |
| About **15–20 minutes** | — | To follow these steps |

You'll be copy-pasting commands into your server. **You won't write any code.**

---

### Step 1 — Rent a server

Create a server (also called a "VPS" or "droplet") at a provider like **[DigitalOcean](https://www.digitalocean.com/)**, Hetzner, or any cloud host.

- **Operating system:** Ubuntu 24.04 (LTS)
- **Size:** **4 GB of RAM** recommended (2 GB works, but building the frontend is memory-hungry and can run out)

When it's ready, copy the server's **public IP address** (it looks like `203.0.113.10`).

### Step 2 — Point your domain at the server

In your domain provider's DNS settings, add an **"A record"**:

| Type | Name | Value |
| --- | --- | --- |
| A | `chat` (or whatever subdomain you want) | your server's IP address |

This makes `chat.yourbusiness.com` lead to your server. (DNS can take a few minutes to update.)

### Step 3 — Connect to your server and install Docker

Open a terminal on your computer and connect to your server (replace with your IP):

```bash
ssh root@YOUR_SERVER_IP
```

Open the firewall so visitors can reach the app over the web (SSH, HTTP, HTTPS):

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

Then install **Docker** (the software that runs ForgeChat) by pasting this:

```bash
curl -fsSL https://get.docker.com | sh

# (optional) run Docker without typing "sudo" every time
usermod -aG docker $USER && newgrp docker
```

### Step 4 — Download ForgeChat

```bash
git clone https://github.com/Forgemind-git/ForgeChat.git forgechat
cd forgechat
cp docker-compose.sample.yml docker-compose.yml
```

### Step 5 — Set your domain

Tell ForgeChat your web address (replace with your real domain):

```bash
sed -i 's/forgechat.example.com/chat.yourbusiness.com/' Caddyfile
```

### Step 6 — Create your secret settings

This creates secure passwords automatically and saves your settings. **Replace `chat.yourbusiness.com` with your real domain** before pasting:

```bash
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
CORS_ORIGIN=https://chat.yourbusiness.com
META_API_VERSION=v21.0
META_WEBHOOK_VERIFY_TOKEN=${VERIFY}
MEDIA_DIR=/app/media
ADMIN_EMAIL=you@yourbusiness.com
ADMIN_PASSWORD=choose-a-strong-password
EOF

echo "SAVE THIS — your WhatsApp verify token: ${VERIFY}"
```

> 📝 Write down the **verify token** it prints — you'll need it when connecting WhatsApp. Also remember the `ADMIN_EMAIL` and `ADMIN_PASSWORD` you set — that's your login.

### Step 7 — Build and start everything

Paste this block. It builds the app, starts the database, loads the tables, then starts the app and the secure web address:

```bash
# Build the app (this takes a few minutes the first time)
docker compose build

# Start the database + wait until it's ready
docker compose up -d forgecrm-db redis
until [ "$(docker inspect -f '{{.State.Health.Status}}' forgecrm-db)" = healthy ]; do
  echo "waiting for database..."; sleep 2; done

# Create the database tables
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
for f in $(ls db/migrations/*.sql | sort); do
  docker compose exec -T forgecrm-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f";
done

# Start the app + secure web address
docker compose up -d forgecrm-backend forgecrm-frontend caddy
```

### Step 8 — Open it! 🎉

In your browser, go to **`https://chat.yourbusiness.com`** and log in with the email and password you set in Step 6.

> The first time you visit, the secure padlock (HTTPS) is set up automatically. If you see a certificate warning, wait a minute and refresh — your domain's DNS may still be updating.

</details>

---

## 📱 Connect your WhatsApp

To send and receive real messages, link your **WhatsApp Business Account** (one-time setup):

1. **Log in** to ForgeChat → click **Settings** → **WhatsApp Accounts** → **Add**.
2. Paste your details from the [Meta Business dashboard](https://business.facebook.com/): **Display Phone Number**, **Phone Number ID**, **WABA ID**, **Meta App ID**, and a **Meta access token**. (ForgeChat stores the token encrypted.)
3. In the **Meta dashboard** (WhatsApp → Configuration), set up the webhook so Meta sends incoming messages to ForgeChat:
   - **Callback URL:** `https://chat.yourbusiness.com/api/webhook/whatsapp`
   - **Verify token:** the verify token you saved in Step 6
   - **Subscribe to these webhook fields** (under *WhatsApp Business Account*):
     - `messages` — incoming messages + delivery/read statuses *(required)*
     - `message_template_status_update` — template approved / rejected / paused by Meta
     - `message_template_quality_update` — template quality rating changes (GREEN / YELLOW / RED)
     - `message_template_components_update` — edits to an approved template's content
     - `template_category_update` — Meta re-categorises a template
     - `template_correct_category_detection` — Meta's suggested correct category
     - `smb_message_echoes` — copies of messages your team sends from the WhatsApp app, so they also appear in ForgeChat (coexistence)

That's it — incoming WhatsApp messages will now appear in your inbox.

**Verify it works:** in ForgeChat go to **Settings → Webhooks → Send Test Webhook** (the row should show *processed*). Then send a real WhatsApp message from your phone to the business number — it should appear in **Chats** within seconds, and your reply from ForgeChat should arrive back on your phone (with a *delivered* status under Settings → Webhooks).

> ℹ️ You can explore the whole app (inbox, contacts, automations, templates) **before** connecting WhatsApp — you just won't send/receive real messages until this step is done.

---

## 🧭 Everyday use

| You want to… | Go to… |
| --- | --- |
| Reply to customers | **Chats** |
| Add or edit customers, tags, custom fields | **Contacts** |
| Create approved WhatsApp templates | **Template Builder** |
| Send a message to many people at once | **Bulk Message** |
| Set up automatic replies | **Automations** |
| Track sales/deals | **Pipelines** |
| Add team members & control access | **Settings → Users** |

---

## 🔄 Keeping it running

**Update to the latest version** (run on your server, inside the `forgechat` folder):

```bash
git pull
docker compose build forgecrm-backend forgecrm-frontend
docker compose up -d forgecrm-backend forgecrm-frontend
```

**Back up your data** (highly recommended — set up a daily automatic backup):

```bash
mkdir -p ~/backups
crontab -e
# add this line to back up every day at 3 AM and keep 7 days:
0 3 * * * docker exec forgecrm-db pg_dump -U postgres postgres | gzip > ~/backups/forgechat-$(date +\%Y\%m\%d).sql.gz && find ~/backups -name '*.sql.gz' -mtime +7 -delete
```

---

## 🆘 Help & Troubleshooting

| Problem | What to do |
| --- | --- |
| **The page won't load / shows a security warning** | Your domain may not point to the server yet. Double-check the DNS "A record" (Step 2), wait a few minutes, then refresh. |
| **"502" error or blank screen** | The app may still be starting. Wait a minute, then check: `docker compose logs forgecrm-backend`. |
| **Can't log in** | Use the exact `ADMIN_EMAIL` / `ADMIN_PASSWORD` from Step 6. If you forgot the password, you can reset it via Settings → Users (or re-run setup). |
| **Setup got "Killed" / "out of memory" while building** | The build ran out of RAM. Use **2 GB+**, or add swap and rebuild: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`. |
| **Messages aren't arriving** | Re-check the **webhook** in the Meta dashboard. Subscribe to `messages`, and make sure the **Callback URL ends with `/api/webhook/whatsapp`** and the **Verify token matches your `.env` exactly** (no extra spaces). |
| **Changed `.env` but nothing updated** | Restart the backend so it picks up the new values: `docker compose restart forgecrm-backend`. |
| **HTTPS certificate won't issue (server)** | DNS isn't pointing at the server yet. Check with `dig +short chat.yourbusiness.com` (should return your server IP), then `docker compose restart caddy`. |
| **Docker Desktop won't start (Windows)** | Open PowerShell as Administrator, run `wsl --install`, then restart your PC — Docker needs WSL 2. |
| **Cloudflare Tunnel shows "502" (Windows)** | The backend is still starting. Wait ~30 seconds, then refresh the Cloudflare URL. |
| **Is my data safe?** | Yes — everything lives on *your* server. WhatsApp tokens are encrypted, and access is protected by login. Just keep your backups (above). |

Still stuck? Open an issue on [GitHub](https://github.com/Forgemind-git/ForgeChat/issues) and we'll help.

---

## 💬 Community

Got a question, want help, or want to share what you've built? Join our WhatsApp community:

**🟢 [Join the ForgeChat WhatsApp community](https://chat.whatsapp.com/CKa8QSOWBF0EfRnp6EaliK)**

Other self-hosters hang out there, you can get help with setup or Meta WhatsApp Cloud API issues, and you'll hear about new releases first.

---

## 🔒 Security

- Everything runs on **your** server — your data never leaves it.
- WhatsApp access tokens are **encrypted** at rest (AES-256-GCM).
- Login uses secure httpOnly cookies; passwords are hashed with bcrypt.
- Incoming webhooks are verified with Meta's signature so fake messages are rejected.
- The API is protected with rate limiting, security headers, and parameterized database queries.

Found a security issue? Please report it privately — see **[SECURITY.md](./SECURITY.md)**. Don't open a public issue.

---

## 🤝 Contributing

Contributions are welcome! See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for setup and conventions, and the **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)**. Release history is in **[CHANGELOG.md](./CHANGELOG.md)**.

---

## 📄 License

ForgeChat is [**fair-code**](https://faircode.io) distributed under the **[Sustainable Use License](./LICENSE.md)**.

- ✅ Use it for your own business, personal, or non-commercial purposes.
- ✅ Share it free of charge for non-commercial purposes.
- ❌ No reselling or paid hosting as a service without permission.

Copyright © 2026 **Forgemind Techhub LLP**. **Forgemind AI** is a trademark of Forgemind Techhub LLP — see **[TRADEMARK.md](./TRADEMARK.md)**.

> **WhatsApp** is a trademark of WhatsApp LLC. **Meta** is a trademark of Meta Platforms, Inc. ForgeChat is an independent application that connects to the WhatsApp Cloud API (hosted by Meta), and is **not** affiliated with, endorsed by, sponsored by, or otherwise officially connected to Meta Platforms, Inc. or WhatsApp LLC.

---

<div align="center">

**ForgeChat** — own your Chat Viewer.

</div>
