# Database

## Overview

O banco é PostgreSQL hospedado no Supabase. A autenticação usa `auth.users` do
Supabase Auth. O schema da aplicação está centralizado em
`supabase/schema.sql` e usa UUIDs, chaves estrangeiras, funções SQL e Row Level
Security (RLS).

## Schema

As tabelas se organizam pelos seguintes domínios:

### Contas e acesso

`accounts`, `profiles`, `super_admins`, `member_presence` e
`account_invitations` representam contas, perfis, membros, presença e convites.
`accounts` é a unidade de isolamento da aplicação e referencia o proprietário
em `auth.users`.

### CRM e atendimento

`contacts`, `tags`, `contact_tags`, `custom_fields`, `contact_custom_values` e
`contact_notes` armazenam contatos e seus metadados. `conversations`,
`messages` e `message_reactions` representam o histórico de atendimento.

### Canais e campanhas

`whatsapp_config`, `message_templates`, `instagram_config`, `ryzeapi_config`,
`zernio_connections` e `evolution_config` guardam configurações por conta.
`broadcasts` e `broadcast_recipients` modelam transmissões e seus destinatários.

### Vendas e automação

`pipelines`, `pipeline_stages` e `deals` formam o pipeline de vendas.
`automations`, `automation_steps`, `automation_logs` e
`automation_pending_executions` suportam automações. `flows`, `flow_nodes`,
`flow_runs` e `flow_run_events` suportam os fluxos conversacionais.

### Recursos complementares

`notifications`, `api_keys`, `webhook_endpoints`, `ai_configs`, `ai_tools`,
`ai_usage` e `ai_activity_logs` suportam notificações, API, webhooks e IA.
`media_tags`, `media_assets` e `media_asset_tags` representam a biblioteca de
mídia. `calendar_connections`, `account_calendars` e `calendar_events` tratam
o calendário. `meta_capi_configs` e `meta_capi_events` atendem à integração
Meta Conversions API. `conversation_labels_def` e `conversation_labels` mantêm
etiquetas de conversas.

## Relationships

- A maior parte das entidades possui `account_id` com referência a `accounts`;
  este é o limite principal de tenancy.
- Um contato possui tags por meio de `contact_tags`, campos personalizados por
  `contact_custom_values`, notas e conversas.
- Uma conversa possui mensagens; uma mensagem pode responder a outra mensagem
  e pode ter reações.
- Um pipeline possui estágios; um negócio referencia pipeline, estágio, contato
  e, opcionalmente, uma conversa e um perfil responsável.
- Uma automação possui passos, logs e execuções pendentes. Um fluxo possui nós,
  execuções e eventos de execução.
- Um broadcast possui destinatários; ativos de mídia recebem tags por meio de
  `media_asset_tags`.
- Eventos de calendário pertencem a uma conta e podem se vincular a contato e
  negócio.

## Migrations

Não há diretório de migrations separado no repositório. O schema consolidado,
incluindo criação de tabelas, alterações, funções, índices, RLS e policies,
fica em `supabase/schema.sql`. Os arquivos auxiliares em `supabase/.temp/` são
artefatos de ambiente do Supabase, não migrations versionadas.

## Security

O schema habilita RLS nas tabelas da aplicação. As policies usam funções de
membresia por conta, como `is_account_member`, para limitar leituras e mutações
por papel (por exemplo, agente ou administrador). Chaves estrangeiras e
deleções em cascata preservam a integridade referencial. O acesso privilegiado
server-side usa a variável `SUPABASE_SERVICE_ROLE_KEY`; ela não deve ser usada
em código cliente.
