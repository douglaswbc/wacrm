# Architecture

## Overview

wacrm é um CRM self-hosted para WhatsApp e Instagram. A aplicação é uma
aplicação Next.js 16 com App Router, React e TypeScript. O frontend, as rotas
de API e a renderização server-side vivem no mesmo projeto; o estado
persistente fica no Supabase.

## Application Structure

- `src/app/`: páginas, layouts, grupos de rotas e Route Handlers.
- `src/components/`: componentes reutilizáveis de UI e componentes por domínio.
- `src/lib/`: serviços, regras de negócio, clientes de integrações e utilitários.
- `src/types/`: tipos compartilhados.
- `src/hooks/`: hooks React.
- `supabase/schema.sql`: schema, funções, políticas e dados auxiliares do banco.
- `workflows/`: fluxos JSON de exemplo para automações externas.

## Frontend

O frontend utiliza o App Router em `src/app/`. As áreas de autenticação ficam
em `src/app/(auth)/`; as áreas autenticadas do CRM ficam em
`src/app/(dashboard)/`; há ainda rotas para callback de autenticação, convites,
landing page e documentação da API. Os componentes são organizados por domínio
em `src/components/` (por exemplo, `inbox`, `contacts`, `pipelines`,
`automations` e `calendar`) e componentes de base em `src/components/ui/`.

## Backend

Os Route Handlers estão em `src/app/api/`. Eles incluem endpoints internos para
conta, IA, automações, calendário, mensageria, mídia, integrações e webhooks,
além da API REST pública em `src/app/api/v1/`.

Não foram identificadas Server Actions no diretório `src/app/`. A lógica dos
endpoints é concentrada em módulos de `src/lib/`, como `auth`, `automations`,
`flows`, `calendar`, `webhooks`, `whatsapp` e `api/v1`.

## Business Logic

`src/lib/` agrupa a lógica por contexto de domínio: autenticação e contas,
contatos, caixa de entrada, negócios, automações, fluxos, broadcasts, calendário,
IA, chaves de API e integrações de mensageria. Os clientes Supabase estão em
`src/lib/supabase/`; os serviços que precisam operar sem sessão de usuário usam
clientes administrativos específicos em alguns módulos.

## Authentication

A autenticação é fornecida pelo Supabase Auth. O projeto usa os clientes SSR e
browser do Supabase em `src/lib/supabase/`, com callbacks em
`src/app/auth/callback/`. A autorização no banco é complementada por RLS e por
papéis de membro por conta, manipulados em `src/lib/auth/`.

## Data Flow

```text
UI em src/app e src/components
        ↓
Route Handlers em src/app/api (ou consultas server-side)
        ↓
Serviços e regras em src/lib
        ↓
Supabase / serviços externos
```

Webhooks externos entram em endpoints sob `src/app/api/` e são validados e
normalizados pelos módulos de integração antes de persistirem ou dispararem
automações.

## Important Architectural Decisions

- O projeto adota o App Router do Next.js e mantém UI, rotas de API e serviços
  no mesmo repositório.
- A organização do código é predominantemente orientada por domínio em
  `src/lib/` e `src/components/`.
- O Supabase é usado para banco, autenticação e armazenamento; o schema mantém
  políticas RLS para isolamento por conta.
- Há uma API pública versionada em `/api/v1`, separada das rotas internas.
- Integrações de mensageria e webhooks possuem módulos próprios para preservar
  suas particularidades de protocolo e assinatura.
