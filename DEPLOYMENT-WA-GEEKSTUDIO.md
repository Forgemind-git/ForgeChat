# ForgeChat POC — wa.geekstudio.dev

Fecha: 2026-06-01

## URL pública

- https://wa.geekstudio.dev

## Ruta de despliegue

- Repo/compose: `/home/alek/stack/forgechat-poc`
- Caddy global: `/home/alek/stack/caddy/Caddyfile`
- Cloudflare Tunnel config: `/etc/cloudflared/config.yml`

## Servicios

Docker Compose en `/home/alek/stack/forgechat-poc`:

- `forgecrm-db` — PostgreSQL 15
- `redis` / container `forgecrm-redis` — Redis
- `forgecrm-backend` — Node backend en puerto interno `3011`
- `forgecrm-frontend` — Nginx frontend, publicado localmente en `127.0.0.1:4017`

Ingress:

- Cloudflare DNS/tunnel: `wa.geekstudio.dev`
- cloudflared ingress: `wa.geekstudio.dev` → `http://localhost:8094`
- Caddy local listener `:8094` → `127.0.0.1:4017`
- ForgeChat frontend `/api/*` proxy interno → backend `forgecrm-backend:3011`

## Configuración ajustada

- `backend/.env`: `CORS_ORIGIN=https://wa.geekstudio.dev`
- `backend/.env`: `NODE_ENV=production`

Credenciales admin locales guardadas en:

- `/home/alek/stack/forgechat-poc/.forgechat-credentials`

No exponer ese archivo en chats ni commits.

## Verificación ejecutada

- `https://wa.geekstudio.dev/` respondió `HTTP/2 200` vía Cloudflare/Caddy.
- HTML público contiene: `ForgeChat — Inbox & CRM for WhatsApp Business`.
- Login admin por API respondió `HTTP 200`.
- `/api/auth/me` con cookie respondió `HTTP 200`.
- Sesión admin expone páginas visibles:
  - `home`
  - `chats`
  - `contacts`
  - `pipelines`
  - `bulk-message`
  - `template-builder`
  - `chatbot-builder`
  - `media-library`
  - `admin-settings:whatsapp-accounts`
  - `admin-settings:users`

## Pendiente para Meta WhatsApp Cloud API real

1. Crear/configurar Meta App y WhatsApp Business Account.
2. Configurar callback público:
   - `https://wa.geekstudio.dev/api/webhook/whatsapp`
3. Usar el verify token configurado en `META_WEBHOOK_VERIFY_TOKEN`.
4. Cargar/guardar `META_ACCESS_TOKEN` y datos de cuenta/número desde la UI o env según flujo de ForgeChat.
5. Probar handshake webhook de Meta.
6. Probar envío/recepción real con número de prueba antes de producción.
7. Evaluar licencia Sustainable Use License antes de adopción productiva/comercial amplia.
