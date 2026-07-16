# wacrm — WhatsApp & Instagram CRM

> Self-hosted WhatsApp & Instagram CRM — shared inbox, pipelines,
> broadcasts, and no-code automations.



[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)

## What you get out of the box

- **Shared inbox** on the official WhatsApp Business API and
  Instagram Messaging API — multiple agents working one number/account,
  per-conversation assignment, status, and notes.
- **Contacts + tags + custom fields**, CSV import, deduplication.
- **Sales pipelines** (Kanban) with deals linked to conversations.
- **Broadcasts** with Meta-approved templates, delivery + read
  tracking, per-recipient variable substitution.
- **No-code automations** — triggers on inbound messages, new
  contacts, keywords, time-based schedules, or tag/pipeline events;
  conditional branches, waits, tags, webhooks. Visual builder.
- **Time-based automations with targeting** — send scheduled messages
  to contacts filtered by tags, pipeline stage, or deal status.
  Cron-driven dispatch with dedup; optional `?now=HH:mm` for manual
  testing.
- **AI reply assistant** — bring your own OpenAI or Anthropic key
  (stored encrypted; no per-seat AI fee, your data stays yours).
  One-click AI-drafted replies in the inbox, plus an optional
  auto-reply bot with a per-conversation cap and clean human handoff.
- **Real-time dashboard** — response times, daily volume, pipeline
  value, cross-module activity feed.
- **Team accounts** — invite teammates by link, role-based access
  (owner / admin / agent / viewer), ownership transfer. Every install
  is account-scoped, so one shared inbox can be staffed by a whole
  team. Solo use stays single-user with zero setup.
- **Account management** — email, password, avatar, global sign-out.
- **Public REST API** (`/api/v1`) with scoped, revocable API keys —
  build your own automations on top of your CRM. See
  [docs/public-api.md](./docs/public-api.md).

## Why fork this?

This is a **template**, not a product. Forking means you get:

- **Full ownership** — your code, your Supabase project, your domain,
  your data. No SaaS lock-in, no seat pricing, no trust dance.
- **Full customisation** — add the fields your team needs, remove the
  modules you don't, redesign anything. The stack is boring on
  purpose (Next.js + Supabase + Tailwind) so the learning curve is
  short.
- **Flexible deployment** — runs on any VPS with Docker, on a
  dedicated server, or locally. Docker Swarm deploy with automatic
  SSL (Traefik) takes minutes.
  ([See below ↓](#-deploy-on-docker-swarm))
- **Real security primitives** — token encryption (AES-256-GCM), RLS
  on every table, HMAC-verified webhooks, CSP, rate limiting, CI
  typecheck/build on every PR.

Not a framework. Not an SDK. A concrete, working CRM you can stand up
in an afternoon and make yours.

## Quick start

```bash
git clone https://github.com/douglaswbc/wacrm.git
cd wacrm
npm install
cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm run dev
```

Open <http://localhost:3000>. You'll be redirected to `/login` (or
`/dashboard` if already signed in).

## 🐳 Deploy on Docker Swarm

wacrm is designed to run on **any VPS with Docker** — single node
Swarm mode with Traefik as reverse proxy handles SSL automatically.

### Prerequisites

- A VPS running Ubuntu/Debian with Docker
- Docker Swarm initialised (`docker swarm init`)
- Traefik running in Swarm with Let's Encrypt configured
- A domain pointing to your VPS IP

### Setup

```bash
# Clone the repository
cd /opt
git clone https://github.com/douglaswbc/wacrm
cd wacrm

# Create environment file — see .env.local.example for all vars
cp .env.local.example .env.local
nano .env.local

# Build the Docker image
docker build -t wacrm:latest .

# Deploy to Swarm
docker stack deploy -c wacrm.yaml wacrm
```

### Environment variables

Required variables — configure in `.env.local` before building:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key (bypasses RLS) |
| `ENCRYPTION_KEY` | 64-char hex for token encryption (`crypto.randomBytes(32).toString('hex')`) |
| `AUTOMATION_CRON_SECRET` | Shared secret protecting `/api/automations/cron` (required for wait steps and time-based triggers) |
| `META_APP_SECRET` | Meta App Secret for WhatsApp webhook verification |
| `INSTAGRAM_APP_SECRET` | Meta App Secret for Instagram webhook verification (separate app) |
| `NEXT_PUBLIC_SITE_URL` | Public URL of your CRM (`https://crm.seudominio.com`) |

### Supabase Auth URL configuration

After deploying, configure these URLs in your **Supabase Dashboard → Authentication → URL Configuration**:

| Setting | Value |
|---|---|
| **Site URL** | `https://crm.seudominio.com` |
| **Redirect URLs** | `https://crm.seudominio.com/auth/callback` (password reset) |
| | `https://crm.seudominio.com/join/*` (invite email confirmation) |

Without these, password reset emails and invite confirmation links will not work.

### Traefik configuration

The included `wacrm.yaml` expects Traefik running with these labels.
Adjust the domain and certresolver to match your setup:

```yaml
labels:
  - traefik.http.routers.wacrm.rule=Host(`crm.seudominio.com`)
  - traefik.http.routers.wacrm.entrypoints=websecure
  - traefik.http.routers.wacrm.tls.certresolver=letsencryptresolver
  - traefik.http.services.wacrm.loadbalancer.server.port=3000
```

### Updating

```bash
cd /opt/wacrm
git pull
docker build -t wacrm:latest .
docker stack deploy -c wacrm.yaml wacrm
```

### Automation cron

Time-based automations and wait steps depend on the cron endpoint being
called every ~5 minutes. Set `AUTOMATION_CRON_SECRET` in `.env.local`,
install cron on the VPS if not already present, then register the job:

```bash
# Install cron if needed (Debian/Ubuntu)
apt update && apt install -y cron
systemctl enable --now cron

# Register the job
echo "*/5 * * * * curl -s -H 'x-cron-secret: YOUR_SECRET' https://your-domain.com/api/automations/cron >> /var/log/wacrm-cron.log 2>&1" | crontab -
```

Use `?now=HH:mm` for manual testing (bypasses schedule check and dedup).

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Data** — Supabase (Postgres + Auth + Storage + RLS).
- **WhatsApp** — Meta Cloud API (official WhatsApp Business API) and
  RyzeAPI (self-hosted WhatsApp gateway).
- **Instagram** — Instagram Graph API for messaging, comments, and
  post-based automations. Supports long-lived token auto-refresh.

## Contributing

Bug reports and security issues are welcome. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) and
[`.github/SECURITY.md`](./.github/SECURITY.md).

## License

[MIT](./LICENSE). Fork it, brand it, host it.
