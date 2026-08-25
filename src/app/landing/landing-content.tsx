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
import { useLanguage } from '@/hooks/use-language'

type FeatureSlug =
  | 'inbox'
  | 'contacts'
  | 'pipeline'
  | 'broadcasts'
  | 'automations'
  | 'flows'
  | 'ai'
  | 'api'
  | 'team'
  | 'integrations'
  | 'analytics'
  | 'media'

const stats = [
  { valueKey: 'landing.stats.multiAgent.value', labelKey: 'landing.stats.multiAgent.label' },
  { valueKey: 'landing.stats.kanban.value', labelKey: 'landing.stats.kanban.label' },
  { valueKey: 'landing.stats.noCode.value', labelKey: 'landing.stats.noCode.label' },
  { valueKey: 'landing.stats.ai.value', labelKey: 'landing.stats.ai.label' },
]

const features: { slug: FeatureSlug; icon: typeof MessageCircle }[] = [
  { slug: 'inbox', icon: MessageCircle },
  { slug: 'contacts', icon: Users },
  { slug: 'pipeline', icon: Kanban },
  { slug: 'broadcasts', icon: Send },
  { slug: 'automations', icon: Workflow },
  { slug: 'flows', icon: Bot },
  { slug: 'ai', icon: Sparkles },
  { slug: 'api', icon: Code },
  { slug: 'team', icon: Shield },
  { slug: 'integrations', icon: Globe },
  { slug: 'analytics', icon: BarChart3 },
  { slug: 'media', icon: Image },
]

const integrations = [
  { name: 'WhatsApp Cloud API', descKey: 'landing.integrations.whatsapp.desc' },
  { name: 'Instagram', descKey: 'landing.integrations.instagram.desc' },
  { name: 'OpenAI', descKey: 'landing.integrations.openai.desc' },
  { name: 'Anthropic', descKey: 'landing.integrations.anthropic.desc' },
  { name: 'RyzeAPI', descKey: 'landing.integrations.ryzeapi.desc' },
  { name: 'Supabase', descKey: 'landing.integrations.supabase.desc' },
]

const extraFeatures = [
  { icon: Bell, titleKey: 'landing.extra.notifications.title', descKey: 'landing.extra.notifications.desc' },
  { icon: Zap, titleKey: 'landing.extra.languages.title', descKey: 'landing.extra.languages.desc' },
  { icon: Shield, titleKey: 'landing.extra.infra.title', descKey: 'landing.extra.infra.desc' },
]

const infraItems = [
  { titleKey: 'landing.infra.proprietary.title', descKey: 'landing.infra.proprietary.desc' },
  { titleKey: 'landing.infra.sovereign.title', descKey: 'landing.infra.sovereign.desc' },
  { titleKey: 'landing.infra.flexible.title', descKey: 'landing.infra.flexible.desc' },
]

export function LandingContent() {
  const { t } = useLanguage()

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
              {t('landing.hero.badge')}
            </div>

            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              {t('landing.hero.title')}{' '}
              <span className="bg-gradient-to-r from-primary via-primary to-primary-hover bg-clip-text text-transparent">
                {t('landing.hero.titleAccent')}
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              {t('landing.hero.subtitle')}
            </p>

            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/signup"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary-hover hover:shadow-primary/35 sm:w-auto"
              >
                {t('landing.hero.ctaPrimary')}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#features"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-8 py-3.5 text-sm font-semibold transition-all hover:bg-accent sm:w-auto"
              >
                {t('landing.hero.ctaSecondary')}
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
              <div key={s.labelKey} className="text-center">
                <div className="text-2xl font-bold text-primary sm:text-3xl">{t(s.valueKey)}</div>
                <div className="mt-1 text-sm text-muted-foreground">{t(s.labelKey)}</div>
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
              {t('landing.features.title')}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              {t('landing.features.subtitle')}
            </p>
          </div>

          <div className="space-y-32">
            {features.map((f, i) => {
              const Icon = f.icon
              const base = `landing.features.${f.slug}`
              const title = t(`${base}.title`)
              const subtitle = t(`${base}.subtitle`)
              const bullets = [1, 2, 3, 4, 5, 6].map((n) => t(`${base}.b${n}`))
              const isEven = i % 2 === 0

              return (
                <div
                  key={f.slug}
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
                    <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h3>
                    <p className="mt-3 text-lg text-muted-foreground">{subtitle}</p>
                    <ul className="mt-6 space-y-3">
                      {bullets.map((b) => (
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
              {t('landing.extra.title')}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              {t('landing.extra.subtitle')}
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {extraFeatures.map((ef) => {
              const EIcon = ef.icon
              return (
                <div
                  key={ef.titleKey}
                  className="rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/30 hover:shadow-md"
                >
                  <div className="mb-4 inline-flex rounded-lg bg-primary/10 p-2.5">
                    <EIcon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">{t(ef.titleKey)}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{t(ef.descKey)}</p>
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
              {t('landing.integrations.title')}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              {t('landing.integrations.subtitle')}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {integrations.map((integration) => (
              <div
                key={integration.name}
                className="group rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/30 hover:shadow-md"
              >
                <div className="mb-2 inline-flex rounded-md bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {t('landing.integrations.badge')}
                </div>
                <h3 className="mt-3 text-lg font-semibold">{integration.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(integration.descKey)}</p>
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
              {t('landing.infra.badge')}
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t('landing.infra.titleDomain')}{' '}
              <span className="bg-gradient-to-r from-primary to-primary-hover bg-clip-text text-transparent">
                {t('landing.infra.titleData')}
              </span>{' '}
              {t('landing.infra.titleRules')}
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              {t('landing.infra.description')}
            </p>

            <div className="mt-10 grid gap-6 sm:grid-cols-3">
              {infraItems.map((item) => (
                <div
                  key={item.titleKey}
                  className="rounded-xl border border-border bg-card p-5 text-center"
                >
                  <h3 className="font-semibold">{t(item.titleKey)}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{t(item.descKey)}</p>
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
            {t('landing.finalCta.title')}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            {t('landing.finalCta.subtitle')}
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/signup"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary-hover hover:shadow-primary/35 sm:w-auto"
            >
              {t('landing.finalCta.button')}
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
              <span>— {t('landing.footer.tagline')}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
