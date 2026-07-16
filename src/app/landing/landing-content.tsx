'use client'

import {
  MessageCircle,
  Users,
  Kanban,
  Send,
  Workflow,
  Bot,
  Sparkles,
  Shield,
  Globe,
  BarChart3,
  Code,
  Image,
  Bell,
  ArrowRight,
  Check,
  Zap,
} from 'lucide-react'
import Link from 'next/link'

const stats = [
  { value: 'Multi-agente', label: 'Inbox compartilhada' },
  { value: 'Kanban', label: 'Pipeline de vendas' },
  { value: 'No-Code', label: 'Automações visuais' },
  { value: 'IA integrada', label: 'OpenAI & Anthropic' },
]

const features = [
  {
    icon: MessageCircle,
    title: 'Inbox Compartilhada',
    subtitle: 'Múltiplos agentes atendendo o mesmo número com atribuição inteligente.',
    bullets: [
      'Múltiplos agentes em um único número WhatsApp',
      'Atribuição de conversas por agente',
      'Notas internas visíveis para toda equipe',
      'Tempo real via WebSocket (Supabase Realtime)',
      'Reações, respostas com quote, gravação de áudio',
      'Status: aberto, pendente, fechado',
    ],
  },
  {
    icon: Users,
    title: 'Contatos Inteligentes',
    subtitle: 'Gerencie sua base de contatos com tags, campos personalizados e importação em massa.',
    bullets: [
      'Tags coloridas para segmentação',
      'Campos personalizados ilimitados',
      'Importação CSV com deduplicação automática',
      'Notas internas por contato',
      'Busca e filtros avançados',
      'Vinculação com conversas, negócios e notas',
    ],
  },
  {
    icon: Kanban,
    title: 'Pipeline de Vendas',
    subtitle: 'Visual Kanban com drag-and-drop para gerenciar seus negócios do início ao fechamento.',
    bullets: [
      'Kanban drag-and-drop intuitivo',
      'Múltiplos pipelines configuráveis',
      'Etapas personalizadas com cores',
      'Analytics: contagem e valor por etapa',
      'Negócios vinculados a contatos e conversas',
      'Pipeline padrão incluso: Lead → Won',
    ],
  },
  {
    icon: Send,
    title: 'Broadcasts',
    subtitle: 'Disparos em massa de mensagens WhatsApp com templates e tracking completo.',
    bullets: [
      'Wizard de 4 passos: template → audiência → personalizar → enviar',
      'Templates aprovados pelo Meta (WhatsApp Cloud API)',
      'Tracking: enviado, entregue, lido, respondido, falha',
      'Variáveis personalizadas por destinatário',
      'Suporte a Meta Cloud API e RyzeAPI',
      'Barra de progresso em tempo real durante envio',
    ],
  },
  {
    icon: Workflow,
    title: 'Automações No-Code',
    subtitle: 'Workflows visuais com triggers, steps, branching e IA — sem escrever código.',
    bullets: [
      'Gatilhos: nova mensagem, primeira mensagem, palavra-chave, tag, horário',
      'Ações: enviar mensagem, adicionar tag, atribuir, criar negócio',
      'Branching com If/Else (campo, tag, conteúdo, horário)',
      'Steps de IA: condição, resposta automática, extração de dados',
      'Wait steps com resume automático via cron',
      'Templates prontos: boas-vindas, ausência, qualificação, follow-up',
    ],
  },
  {
    icon: Bot,
    title: 'Chatbot Visual (Flows)',
    subtitle: 'Construtor node-based para criar conversas automatizadas com branching e IA.',
    bullets: [
      'Canvas visual com nós arrastáveis (@xyflow)',
      'Nós: mensagem, botões, lista, mídia, input, condição, IA',
      'Handoff automático para agente humano',
      'Extração de dados estruturados via IA',
      'Interpolação de variáveis ({{vars.X}})',
      'Histórico de execuções e sweep de runs stale',
    ],
  },
  {
    icon: Sparkles,
    title: 'AI Assistant',
    subtitle: 'IA integrada para sugerir respostas, auto-responder e classificar mensagens.',
    bullets: [
      'Botão ✨ no inbox: sugere resposta com contexto da conversa',
      'Auto-reply bot para mensagens não atribuídas',
      'BYOK: traga sua chave OpenAI ou Anthropic',
      'Contexto de negócio configurável (persona/prompt)',
      'Botão "Testar chave" para validar antes de salvar',
      'Chaves criptografadas AES-256-GCM em repouso',
    ],
  },
  {
    icon: Code,
    title: 'API REST + Webhooks',
    subtitle: 'API pública documentada para integrar o CRM com seus sistemas externos.',
    bullets: [
      'API REST com autenticação por API Key',
      'Endpoints: mensagens, contatos, conversas, negócios, broadcasts',
      'Webhooks de saída assinados com HMAC-SHA256',
      'Rate limiting por chave',
      'Scopes granulares (send, read, write, manage)',
      'Paginação baseada em cursor',
    ],
  },
  {
    icon: Shield,
    title: 'Times & Segurança',
    subtitle: 'Multi-tenant com papéis, convites e criptografia de ponta a ponta.',
    bullets: [
      'Papéis: owner, admin, agent, viewer — cada um com permissões claras',
      'Convite de membros por link (sem e-mail necessário)',
      'Transferência de propriedade da conta',
      'RLS (Row-Level Security) em todas as tabelas',
      'Criptografia AES-256-GCM para tokens sensíveis',
      'Presença em tempo real (online/ausente/offline)',
    ],
  },
  {
    icon: Globe,
    title: 'Integrações',
    subtitle: 'Conecte WhatsApp, Instagram, OpenAI, Anthropic e mais.',
    bullets: [
      'WhatsApp Cloud API (Meta) — oficial',
      'RyzeAPI — gateway WhatsApp auto-hospedado alternativo',
      'Instagram — automação de comentários → DM',
      'OpenAI — Chat Completions API',
      'Anthropic — Messages API',
      'Supabase — Auth, PostgreSQL, Storage, Realtime',
    ],
  },
  {
    icon: BarChart3,
    title: 'Dashboard & Analytics',
    subtitle: 'Visão completa do seu negócio com métricas, gráficos e feed de atividades.',
    bullets: [
      'Cards de métricas: conversas ativas, novos contatos, negócios, mensagens',
      'Gráfico de conversas (7/30/90 dias)',
      'Gráfico de pizza: valor de negócios por etapa',
      'Tempo médio de resposta por dia',
      'Feed de atividades em tempo real',
      'Barra de ações rápidas',
    ],
  },
  {
    icon: Image,
    title: 'Media Library',
    subtitle: 'Biblioteca de mídia com upload, tags, busca e envio direto para contatos.',
    bullets: [
      'Upload de imagens, vídeos e documentos',
      'Tags coloridas para organização',
      'Busca e filtro por tipo (imagem/vídeo/documento)',
      'Envio direto para contatos da biblioteca',
      'Integrado com inbox, flows e broadcasts',
      'Armazenamento no Supabase Storage',
    ],
  },
]

const integrations = [
  { name: 'WhatsApp Cloud API', description: 'API oficial do Meta' },
  { name: 'Instagram', description: 'Automação de comentários' },
  { name: 'OpenAI', description: 'GPT-4, GPT-4o, o3-mini' },
  { name: 'Anthropic', description: 'Claude 3.5, Claude 3 Opus' },
  { name: 'RyzeAPI', description: 'Gateway WhatsApp próprio' },
  { name: 'Supabase', description: 'Auth, DB, Storage, Realtime' },
]

const extraFeatures = [
  { icon: Bell, title: 'Notificações em tempo real', desc: 'Alertas de atribuição de conversas com navegação direta.' },
  { icon: Zap, title: '3 idiomas', desc: 'Português (PT-BR), Inglês e Espanhol com troca instantânea.' },
  { icon: Shield, title: 'Infraestrutura própria', desc: 'Docker + Traefik com SSL automático. Deploy em minutos no seu VPS.' },
]

export function LandingContent() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ======== HERO ======== */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/15 via-primary/5 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,var(--color-primary)_0%,transparent_60%)] opacity-20" />

        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-24 sm:pt-32 lg:pt-40">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Plataforma Profissional
            </div>

            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              CRM para WhatsApp{' '}
              <span className="bg-gradient-to-r from-primary via-primary to-primary-hover bg-clip-text text-transparent">
                multi-canal
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Caixa de entrada compartilhada, pipeline de vendas, automações no-code,
              chatbot visual com IA, broadcasts em massa e API REST. Privacidade total —
              seus dados, seu domínio, seu controle.
            </p>

            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/signup"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary-hover hover:shadow-primary/35 sm:w-auto"
              >
                Comece Agora
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#features"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-8 py-3.5 text-sm font-semibold transition-all hover:bg-accent sm:w-auto"
              >
                Ver Funcionalidades
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ======== STATS BAR ======== */}
      <section className="border-y border-border bg-card/50">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-bold text-primary sm:text-3xl">{s.value}</div>
                <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======== FEATURES ======== */}
      <section id="features" className="py-20 lg:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Tudo que você precisa em um só lugar
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Da primeira mensagem ao negócio fechado — todas as ferramentas integradas
              e prontas para usar.
            </p>
          </div>

          <div className="space-y-32">
            {features.map((f, i) => {
              const Icon = f.icon
              const isEven = i % 2 === 0

              return (
                <div
                  key={f.title}
                  className={`flex flex-col items-center gap-12 lg:flex-row ${isEven ? '' : 'lg:flex-row-reverse'}`}
                >
                  {/* Icon / visual */}
                  <div className="flex-shrink-0 lg:w-1/2">
                    <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent shadow-lg shadow-primary/5 sm:h-56 sm:w-56">
                      <div className="rounded-xl border border-primary/20 bg-card p-5 shadow-md">
                        <Icon className="h-10 w-10 text-primary sm:h-12 sm:w-12" />
                      </div>
                    </div>
                  </div>

                  {/* Text */}
                  <div className="lg:w-1/2">
                    <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">{f.title}</h3>
                    <p className="mt-3 text-lg text-muted-foreground">{f.subtitle}</p>
                    <ul className="mt-6 space-y-3">
                      {f.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-3">
                          <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                          <span className="text-sm sm:text-base">{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ======== EXTRA FEATURES GRID ======== */}
      <section className="border-t border-border bg-card/30 py-20 lg:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              E muito mais
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Detalhes que fazem a diferença no dia a dia da sua equipe.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {extraFeatures.map((ef) => {
              const EIcon = ef.icon
              return (
                <div
                  key={ef.title}
                  className="rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/30 hover:shadow-md"
                >
                  <div className="mb-4 inline-flex rounded-lg bg-primary/10 p-2.5">
                    <EIcon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">{ef.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{ef.desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ======== INTEGRATIONS ======== */}
      <section className="py-20 lg:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Conecte as ferramentas que você já usa
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Integrações nativas com os principais serviços de mensageria e IA.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {integrations.map((integration) => (
              <div
                key={integration.name}
                className="group rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/30 hover:shadow-md"
              >
                <div className="mb-2 inline-flex rounded-md bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  Integração nativa
                </div>
                <h3 className="mt-3 text-lg font-semibold">{integration.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{integration.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======== INFRASTRUCTURE HIGHLIGHT ======== */}
      <section className="relative overflow-hidden border-y border-border bg-card/30">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/5" />

        <div className="relative mx-auto max-w-6xl px-4 py-20 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm text-primary">
              <Shield className="h-3.5 w-3.5" />
              Infraestrutura Própria
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Seu domínio.{' '}
              <span className="bg-gradient-to-r from-primary to-primary-hover bg-clip-text text-transparent">
                Seus dados.
              </span>{' '}
              Suas regras.
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              O wacrm roda na sua infraestrutura — VPS, cloud ou on-premise.
              Nada de SaaS, nada de vendor lock-in, nada de compartilhar dados
              com terceiros. Docker + Traefik com SSL automático, Supabase como
              backend. Você tem controle total.
            </p>

            <div className="mt-10 grid gap-6 sm:grid-cols-3">
              {[
                { title: 'Código proprietário', desc: 'Personalizado para o seu negócio. Adapte como quiser.' },
                { title: 'Dados soberanos', desc: 'Tudo no seu projeto Supabase. Criptografia em repouso.' },
                { title: 'Deploy flexível', desc: 'Docker Swarm + Traefik. Ou onde preferir.' },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-xl border border-border bg-card p-5 text-center"
                >
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ======== FINAL CTA ======== */}
      <section className="py-20 lg:py-28">
        <div className="mx-auto max-w-4xl px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Pronto para transformar seu atendimento?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Comece gratuitamente. Crie sua conta, conecte seu WhatsApp e
            tenha seu CRM rodando ainda hoje.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/signup"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary-hover hover:shadow-primary/35 sm:w-auto"
            >
              Criar Conta Gratuita
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ======== FOOTER ======== */}
      <footer className="border-t border-border py-10">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex flex-col items-center justify-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <MessageCircle className="h-4 w-4 text-primary" />
              <span className="font-semibold text-foreground">wacrm</span>
              <span>— CRM multi-canal para WhatsApp & Instagram</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
