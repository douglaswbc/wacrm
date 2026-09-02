# Integrations

## Overview

O projeto integra Supabase, Meta/WhatsApp Cloud API, Instagram, Zernio,
RyzeAPI, Evolution API, Google Calendar, provedores de IA (OpenAI, Anthropic e
Groq), Redis e webhooks HTTP de saída.

## Supabase

### Purpose

Fornece PostgreSQL, autenticação, storage e controles RLS.

### Location

`src/lib/supabase/`, `src/lib/auth/`, `src/lib/storage/` e
`supabase/schema.sql`.

### Environment Variables

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e
`SUPABASE_SERVICE_ROLE_KEY`.

### Flow

Clientes browser e server acessam o Supabase; endpoints e serviços usam a
sessão do usuário ou, quando necessário, um cliente server-side privilegiado.

## Meta, WhatsApp Cloud API e Instagram

### Purpose

Envia e recebe mensagens, gerencia templates e suporta eventos de WhatsApp e
Instagram.

### Location

`src/lib/whatsapp/`, `src/lib/instagram/`, `src/lib/meta/`,
`src/app/api/whatsapp/`, `src/app/api/instagram/` e
`src/app/api/account/meta-capi-config/`.

### Environment Variables

`META_APP_ID`, `META_APP_SECRET`, `INSTAGRAM_APP_SECRET` e
`WHATSAPP_TEMPLATES_DRY_RUN`.

### Flow

Os handlers de API chamam os clientes de integração, que normalizam eventos e
persistem dados de CRM ou executam automações. Credenciais específicas de conta
são armazenadas no banco de forma protegida pela aplicação.

### Webhooks

- `/api/whatsapp/webhook`: recebe eventos do WhatsApp e valida assinatura.
- `/api/instagram/webhook`: recebe eventos do Instagram.

## Zernio

### Purpose

Conecta contas sociais para WhatsApp Cloud e Instagram.

### Location

`src/lib/zernio/` e `src/app/api/zernio/`.

### Environment Variables

`ZERNIO_API_KEY` e `ZERNIO_WEBHOOK_SECRET`.

### Flow

As rotas de configuração, mídia e posts usam o cliente Zernio; eventos de
entrada chegam ao endpoint de webhook e são verificados quando um secret está
configurado.

### Webhooks

- `/api/zernio/webhook`: recebe eventos enviados pelo Zernio.

## RyzeAPI e Evolution API

### Purpose

Oferecem alternativas auto-hospedadas de gateway para WhatsApp.

### Location

`src/lib/ryzeapi/`, `src/lib/evolution/`, `src/app/api/ryzeapi/` e
`src/app/api/evolution/`.

### Environment Variables

`RYZEAPI_API_URL`, `RYZEAPI_ADMIN_TOKEN`, `EVOLUTION_API_URL` e
`EVOLUTION_API_KEY`.

### Flow

Os clientes chamam os gateways para configuração e operações de mensageria;
os eventos recebidos passam pelos handlers de webhook correspondentes.

### Webhooks

- `/api/ryzeapi/webhook`: recebe eventos do RyzeAPI.
- `/api/evolution/webhook`: recebe eventos do Evolution API.

## Google Calendar

### Purpose

Autentica usuários com OAuth2 e sincroniza eventos de calendário.

### Location

`src/lib/calendar/` e `src/app/api/calendar/`.

### Environment Variables

`GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` e
`GOOGLE_CALENDAR_REDIRECT_URI`.

### Flow

O endpoint de conexão inicia OAuth2; o callback persiste a conexão e os
serviços de calendário sincronizam eventos com o Google Calendar.

### Webhooks

Não foi identificado um endpoint de webhook do Google Calendar; a integração
usa rotas de conexão, callback e eventos.

## Provedores de IA

### Purpose

Geram rascunhos, respostas automáticas e transcrição/análise de mídia.

### Location

`src/lib/ai/` e `src/app/api/ai/`.

### Environment Variables

`AI_REQUEST_TIMEOUT_MS`, `AI_CONTEXT_MESSAGE_LIMIT` e `AI_DEBOUNCE_MS`.

### Flow

As configurações e chaves dos provedores são gerenciadas por conta. Os módulos
de provedores em `src/lib/ai/providers/` e `src/lib/ai/transcribe/` executam as
chamadas; não há chave global de provedor listada no arquivo de ambiente.

## Redis

### Purpose

Agrupa mensagens recebidas antes de acionar respostas automáticas de IA.

### Location

`src/lib/redis/` e `src/lib/ai/debounce-processor.ts`.

### Environment Variables

`REDIS_URL`, `AI_DEBOUNCE_MS` e `AI_SHORT_MEMORY_TTL_SECONDS`.

### Flow

Quando configurado, Redis mantém o buffer de debounce e uma memória operacional
efêmera por conversa (por padrão, 72 horas). Essa memória guarda somente estado
de execução, como mídia já enviada, última consulta de disponibilidade e evento
criado; o histórico durável continua no Supabase. Sem Redis, o processamento de
resposta de IA é imediato.

## Outgoing Webhooks

### Purpose

Entrega eventos do CRM a URLs configuradas pelos usuários.

### Location

`src/lib/webhooks/`, `src/app/api/webhooks/` e
`src/app/api/v1/webhooks/`.

### Flow

Endpoints são armazenados no banco, eventos são montados e assinados pelos
serviços, e a entrega aplica validações de SSRF antes da chamada HTTP.

### Webhooks

- `/api/webhooks/test`: testa uma configuração de endpoint.
- `/api/webhooks/[id]`: administra um endpoint interno.
- `/api/v1/webhooks` e `/api/v1/webhooks/[id]`: expõem endpoints da API pública.
