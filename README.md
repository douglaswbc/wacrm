# wacrm — CRM para WhatsApp & Instagram

> CRM self-hosted para WhatsApp & Instagram — caixa de entrada
> compartilhada, pipelines, transmissões e automações no-code.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)

## O que vem pronto

- **Caixa de entrada compartilhada** na API oficial do WhatsApp Business e
  Instagram Messaging — múltiplos agentes atendendo um número/conta,
  atribuição por conversa, status e notas.
- **Contatos + tags + campos personalizados**, importação CSV, deduplicação.
- **Pipeline de vendas** (Kanban) com negócios vinculados a conversas.
- **Transmissões** com templates aprovados pela Meta, rastreamento de
  entrega + leitura, substituição de variáveis por destinatário.
- **Automações no-code** — gatilhos em mensagens recebidas, novos
  contatos, palavras-chave, agendamentos ou eventos de tag/pipeline;
  ramificações condicionais, esperas, tags, webhooks. Construtor visual.
- **Automações com agendamento e segmentação** — envie mensagens agendadas
  para contatos filtrados por tags, estágio do pipeline ou status do negócio.
  Disparo via cron com dedup; opcional `?now=HH:mm` para testes manuais.
- **Assistente de IA para respostas** — use sua própria chave OpenAI ou
  Anthropic (armazenada criptografada; sem taxa de IA por usuário, seus
  dados são seus). Respostas geradas por IA com um clique na caixa de
  entrada, além de um bot de resposta automática opcional com limite por
  conversa e transição limpa para atendimento humano.
- **Dashboard em tempo real** — tempos de resposta, volume diário, valor
  do pipeline, feed de atividades entre módulos.
- **Contas de equipe** — convide membros por link, acesso baseado em
  função (proprietário / admin / agente / visualizador), transferência
  de propriedade. Cada instalação tem escopo de conta, permitindo que uma
  caixa de entrada seja operada por toda a equipe. Uso solo permanece
  como usuário único sem configuração extra.
- **Gerenciamento de conta** — email, senha, avatar, logout global.
- **Calendário com Google Calendar** — conecte sua conta Google, crie e
  gerencie eventos diretamente no CRM. Eventos sincronizam em tempo real
  com o Google Calendar (criação, edição e exclusão bidirecional).
  Vincule eventos a contatos e negócios.
- **API REST pública** (`/api/v1`) com chaves de API com escopo e
  revogáveis — construa suas próprias automações em cima do seu CRM.
  Veja [docs/public-api.md](./docs/public-api.md).

## Por que self-host?

Auto-hospedar significa controle total:

- **Propriedade total** — seu código, seu projeto Supabase, seu domínio,
  seus dados. Sem lock-in de SaaS, sem precificação por usuário, sem
  compartilhar dados com terceiros.
- **Customização total** — adicione os campos que sua equipe precisa,
  remova os módulos que não usa, redesenhe qualquer coisa. A stack é
  intencionalmente simples (Next.js + Supabase + Tailwind) para que a
  curva de aprendizado seja curta.
- **Deploy flexível** — roda em qualquer VPS com Docker, em servidor
  dedicado ou localmente. Deploy com Docker Swarm e SSL automático
  (Traefik) leva minutos.
  ([Veja abaixo ↓](#-deploy-no-docker-swarm))
- **Segurança de verdade** — criptografia de tokens (AES-256-GCM), RLS
  em todas as tabelas, webhooks com verificação HMAC, CSP, rate limiting,
  CI com typecheck/build em cada PR.

Um CRM completo, pronto para produção, que você sobe em uma tarde
e torna seu.

## Início rápido

```bash
git clone https://github.com/douglaswbc/wacrm.git
cd wacrm
npm install
cp .env.local.example .env.local   # preencha credenciais Supabase + Meta
npm run dev
```

Abra <http://localhost:3000>. Você será redirecionado para `/login`
(ou `/dashboard` se já estiver autenticado).

## 🐳 Deploy no Docker Swarm

O wacrm foi projetado para rodar em **qualquer VPS com Docker** — Docker
Swarm em nó único com Traefik como proxy reverso gerencia o SSL
automaticamente.

### Instalando o Docker

Se sua VPS ainda não tem Docker, execute estes comandos (Ubuntu/Debian):

```bash
# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Adicionar seu usuário ao grupo docker (evita usar sudo)
sudo usermod -aG docker $USER

# Instalar Docker Compose (plugin)
sudo apt update && sudo apt install -y docker-compose-plugin

# Inicializar Docker Swarm
docker swarm init

# Reinicie a sessão para aplicar o grupo
exit
```

Após reconectar, o `docker` funciona sem `sudo` e o Swarm está ativo.

### Pré-requisitos

- Uma VPS rodando Ubuntu/Debian com Docker e Swarm ativos (veja acima)
- Traefik rodando no Swarm com Let's Encrypt configurado
- Um domínio apontando para o IP da sua VPS

### Configuração

```bash
# Clone o repositório
cd /opt
git clone https://github.com/douglaswbc/wacrm
cd wacrm

# Compile a imagem Docker
docker build -t wacrm:latest .

# Copie o arquivo de stack de exemplo e edite com seu domínio e secrets
cp example.wacrm.yaml wacrm.yaml
nano wacrm.yaml

# Faça o deploy no Swarm
docker stack deploy -c wacrm.yaml wacrm
```

> **Nota:** `.env.local` é apenas para **desenvolvimento local**
> (`npm run dev`). No Docker Swarm, todas as variáveis de ambiente são
> definidas diretamente no `wacrm.yaml` em `services.wacrm.environment`.
> Veja `example.wacrm.yaml` para a lista completa.

### Variáveis de ambiente

Todas as variáveis usadas pela aplicação — referência tanto para
`.env.local` (dev) quanto `wacrm.yaml` (Docker Swarm):

| Variável | Descrição |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anon/pública do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service_role do Supabase (bypassa RLS) |
| `ENCRYPTION_KEY` | Hex de 64 chars para criptografia de tokens (`crypto.randomBytes(32).toString('hex')`) |
| `AUTOMATION_CRON_SECRET` | Secret protegendo `/api/automations/cron` (obrigatório para wait steps e automações com agendamento) |
| `META_APP_SECRET` | Meta App Secret para verificação do webhook do WhatsApp |
| `INSTAGRAM_APP_SECRET` | Meta App Secret para verificação do webhook do Instagram (app separado) |
| `NEXT_PUBLIC_SITE_URL` | URL pública do seu CRM (`https://crm.seudominio.com`) |
| `GOOGLE_CALENDAR_CLIENT_ID` | Google Cloud Console OAuth2 Client ID (integração com Google Calendar) |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Google Cloud Console OAuth2 Client Secret |
| `GOOGLE_CALENDAR_REDIRECT_URI` | URL de redirecionamento OAuth2 (`https://<domínio>/api/calendar/callback`) |
| `RYZEAPI_API_URL` | URL do servidor RyzeAPI (gateway WhatsApp auto-hospedado) |
| `RYZEAPI_ADMIN_TOKEN` | Token de admin do RyzeAPI |

### Configuração do Google Calendar

1. Acesse o [Google Cloud Console](https://console.cloud.google.com)
2. Crie um projeto → **APIs & Serviços** → **Ative a Calendar API**
3. **Credenciais** → **Criar ID do cliente OAuth2** → Aplicativo Web
4. Adicione a URI de redirecionamento: `https://<seu-domínio>/api/calendar/callback`
5. Copie o Client ID e Client Secret para suas variáveis de ambiente
6. Faça o deploy → vá em **Configurações → Google Calendar** no wacrm → **Conectar**

### Configuração de URL no Supabase Auth

Após o deploy, configure estas URLs no **Supabase Dashboard → Authentication → URL Configuration**:

| Configuração | Valor |
|---|---|
| **Site URL** | `https://crm.seudominio.com` |
| **Redirect URLs** | `https://crm.seudominio.com/auth/callback` (redefinição de senha) |
| | `https://crm.seudominio.com/join/*` (confirmação de email de convite) |

Sem essas configurações, emails de redefinição de senha e links de
confirmação de convite não funcionarão.

### Configuração do Traefik

O `wacrm.yaml` incluído espera o Traefik rodando com estas labels.
Ajuste o domínio e certresolver conforme sua configuração:

```yaml
labels:
  - traefik.http.routers.wacrm.rule=Host(`crm.seudominio.com`)
  - traefik.http.routers.wacrm.entrypoints=websecure
  - traefik.http.routers.wacrm.tls.certresolver=letsencryptresolver
  - traefik.http.services.wacrm.loadbalancer.server.port=3000
```

### Atualizando

```bash
cd /opt/wacrm
git pull

# Compare example.wacrm.yaml com seu wacrm.yaml — adicione novas env vars
diff example.wacrm.yaml wacrm.yaml

docker build -t wacrm:latest .
docker stack deploy -c wacrm.yaml wacrm
```

> **Nota:** Após `git pull`, sempre verifique o `example.wacrm.yaml` em
> busca de novas variáveis de ambiente adicionadas ao projeto. Seu
> `wacrm.yaml` não as recebe automaticamente. Compare com `diff` ou
> revise manualmente.

### Cron das automações

Automações com agendamento e wait steps dependem do endpoint cron ser
chamado a cada ~5 minutos. Defina `AUTOMATION_CRON_SECRET` no
`wacrm.yaml`, instale o cron na VPS se ainda não estiver presente e
registre o job:

```bash
# Instalar cron se necessário (Debian/Ubuntu)
apt update && apt install -y cron
systemctl enable --now cron

# Registrar o job
echo "*/5 * * * * curl -s -H 'x-cron-secret: SEU_SECRET' https://seu-dominio.com/api/automations/cron >> /var/log/wacrm-cron.log 2>&1" | crontab -
```

Use `?now=HH:mm` para testes manuais (ignora verificação de agendamento
e dedup).

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Dados** — Supabase (Postgres + Auth + Storage + RLS).
- **WhatsApp** — Meta Cloud API (API oficial do WhatsApp Business) e
  RyzeAPI (gateway WhatsApp auto-hospedado).
- **Instagram** — Instagram Graph API para mensagens, comentários e
  automações baseadas em posts. Suporta renovação automática de token
  de longa duração.
- **Calendário** — Google Calendar API com OAuth2 para sincronização
  bidirecional de eventos.

## Contribuindo

Relatos de bugs e problemas de segurança são bem-vindos. Veja
[`CONTRIBUTING.md`](./CONTRIBUTING.md) e
[`.github/SECURITY.md`](./.github/SECURITY.md).

## Licença

[MIT](./LICENSE)
