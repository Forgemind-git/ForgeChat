# Security Policy

Forgemind Techhub LLP takes the security of ForgeChat seriously. ForgeChat
handles WhatsApp Business conversations, contact data, and encrypted Meta access
tokens, so we appreciate the work of security researchers and the wider
community in keeping it safe. Thank you for helping protect ForgeChat and its
users.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
pull requests, or discussions.**

Instead, report them privately by email to:

> **security@forgemind.in** — subject line: `SECURITY: <short summary>`

To help us triage quickly, please include as much of the following as you can:

- A description of the vulnerability and its potential impact.
- Step-by-step instructions to reproduce it.
- The affected version, commit hash, or deployment URL.
- Any proof-of-concept code, requests, or screenshots.
- Whether the issue is already publicly known or being exploited.

If you would like to encrypt your report or exchange further details securely,
say so in your initial email and we will arrange a secure channel.

## Our Commitment

When you report a vulnerability in good faith, we commit to the following
timeline:

| Stage | Target |
|-------|--------|
| Acknowledge receipt of your report | within **3 business days** |
| Initial triage and severity assessment | within **7 days** |
| Coordinated public disclosure (after a fix is available) | within **90 days** |

We will keep you informed of our progress, let you know once the issue is
resolved, and credit you in the disclosure if you wish (and consent to being
named).

## Supported Versions

ForgeChat is delivered as a continuously updated application. Security fixes are
applied to the latest released version and the `main` branch only.

| Version | Supported |
|---------|-----------|
| Latest `main` / latest `1.0.x` | ✅ |
| Older / unreleased revisions | ❌ |

If you self-host, always run the latest version to receive security fixes.

## Scope

**In scope** — vulnerabilities in the ForgeChat code maintained in this
repository, for example:

- Authentication / authorization flaws (JWT handling, the `forgecrm_token`
  cookie, BDA access scoping).
- Injection (SQL, command, template) and cross-site scripting.
- Insecure handling of Meta access tokens or the AES-256-GCM encryption layer.
- Webhook verification bypass or forged-payload handling
  (`routes/webhook.js`).
- Server-side request forgery, insecure file upload / media handling, or
  path traversal.
- Sensitive data exposure through API endpoints.

**Out of scope** — including, but not limited to:

- Third-party services and dependencies: the Meta WhatsApp Cloud API,
  Traefik, PostgreSQL, Redis, BullMQ, and Docker images (report those to their
  respective maintainers).
- Vulnerabilities that exist only because of a self-hoster's misconfiguration
  (e.g. weak `JWT` secret, committed `.env`, missing TLS, exposed database
  port).
- Denial-of-service, volumetric, or rate-limit-exhaustion attacks.
- Social engineering, phishing, or physical attacks against Forgemind staff or
  infrastructure.
- Reports from automated scanners without a demonstrated, exploitable impact.

## Safe Harbor

We consider security research and vulnerability disclosure conducted in good
faith under this policy to be authorized. We will not pursue or support legal
action against you for such research, provided that you:

- Make a good-faith effort to avoid privacy violations, data destruction, and
  service interruption.
- Only interact with accounts and data you own or have explicit permission to
  test — do not access, modify, or exfiltrate other users' data.
- Give us a reasonable opportunity to remediate before any public disclosure.
- Do not exploit the vulnerability beyond the minimum necessary to demonstrate
  it.

## Security Guidance for Self-Hosters

If you deploy ForgeChat yourself, you are responsible for the security of your
instance. Key practices (see the **Security** section of the
[`README.md`](./README.md) for details):

- Never commit `.env` files; keep `FORGECRM_ENCRYPTION_KEY`, the JWT signing
  secret, and the Meta webhook verify token secret and unique.
- Rotate the AES-256-GCM encryption key and Meta access tokens periodically.
- Serve only over TLS and never expose the PostgreSQL or Redis ports publicly.
- Keep the application, dependencies, and base Docker images up to date.

---

*This policy is governed by the version in the default branch of this
repository and may be updated at any time. © 2026 Forgemind Techhub LLP.*
