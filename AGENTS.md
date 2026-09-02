<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Instructions

## Stack

- Framework: Next.js 16 (App Router) com React 19.
- Linguagem: TypeScript.
- Banco de dados e autenticação: Supabase (Postgres, Auth e Storage), com RLS.
- Client de banco: `@supabase/ssr` e `@supabase/supabase-js`; não há ORM identificado.
- UI: Tailwind CSS 4, shadcn/ui, Base UI, Lucide e Sonner.
- Ferramentas principais: ESLint, Prettier, Vitest, Docker e npm.

## Package Manager

O projeto usa npm (`package-lock.json`).

## Commands

Dev:
`npm run dev`

Build:
`npm run build`

Start:
`npm run start`

Typecheck:
`npm run typecheck`

Lint:
`npm run lint`

Tests:
`npm run test`

Formatting:
`npm run format` e `npm run format:check`

## Architecture

- Frontend e rotas: `src/app/`.
- API: `src/app/api/`, incluindo a API pública em `src/app/api/v1/`.
- Components: `src/components/`.
- Business logic e serviços: `src/lib/`.
- Banco: `supabase/schema.sql`; clients em `src/lib/supabase/`.
- Types: `src/types/` e tipos específicos próximos aos respectivos módulos em `src/lib/`.
- Integrações: módulos em `src/lib/whatsapp/`, `src/lib/instagram/`, `src/lib/zernio/`, `src/lib/ryzeapi/`, `src/lib/evolution/`, `src/lib/calendar/`, `src/lib/ai/`, `src/lib/redis/` e `src/lib/webhooks/`.

## Development Rules

- Preserve os padrões existentes do projeto.
- Reutilize componentes existentes antes de criar novos.
- Reutilize funções e serviços existentes.
- Não duplicar lógica existente.
- Não instalar dependências sem necessidade.
- Não alterar arquivos fora do escopo solicitado.
- Não realizar refatorações não solicitadas.
- Preferir alterações pequenas e localizadas.
- Manter compatibilidade com funcionalidades existentes.
- Evitar uso de `any` quando o projeto utiliza TypeScript.
- Seguir os padrões de nomenclatura existentes.
- Nunca expor secrets, tokens ou credenciais.
- Nunca inserir secrets diretamente no código.

## Before Coding

1. Identifique os arquivos relacionados.
2. Procure implementações semelhantes no projeto.
3. Entenda o padrão utilizado.
4. Determine a menor alteração necessária.
5. Evite explorar partes não relacionadas do repositório.

## After Coding

1. Revise o diff.
2. Execute typecheck, se disponível.
3. Execute lint, se disponível.
4. Execute testes relacionados, se disponíveis.
5. Corrija apenas erros relacionados à alteração realizada.

## Context Efficiency

- Não analisar o repositório inteiro sem necessidade.
- Começar pelos arquivos diretamente relacionados à tarefa.
- Expandir a investigação somente quando necessário.
- Evitar releitura desnecessária de arquivos.
- Não explicar código trivial em excesso.
- Ser conciso nos relatórios.
- Preferir executar validações a apenas sugeri-las.
- Não refatorar código não relacionado.
