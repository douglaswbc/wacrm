'use client'

import {
  type LucideIcon,
  Bot,
  CheckCircle2,
  PlugZap,
  Radio,
  BarChart3,
  Camera,
  XCircle,
} from 'lucide-react'
import type { SystemStatus } from '@/lib/dashboard/types'
import { useLanguage } from '@/hooks/use-language'

interface StatusPill {
  key: string
  icon: LucideIcon
  label: string
  ok: boolean
  detail: string
}

export function SystemStatusBar({
  status,
  loading,
}: {
  status: SystemStatus | null
  loading?: boolean
}) {
  const { t } = useLanguage()
  if (loading || !status) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex h-10 animate-pulse items-center gap-2 rounded-lg bg-muted px-3"
          />
        ))}
      </div>
    )
  }

  const connectedLabel = status.whatsappConnected
    ? t('dashboard.systemStatus.connected')
    : t('dashboard.systemStatus.disconnected')
  const pills: StatusPill[] = [
    {
      key: 'whatsapp',
      icon: PlugZap,
      label: 'WhatsApp',
      ok: status.whatsappConnected,
      detail: connectedLabel,
    },
    {
      key: 'instagram',
      icon: Camera,
      label: 'Instagram',
      ok: status.instagramConnected,
      detail:
        status.instagramConnected
          ? t('dashboard.systemStatus.connected')
          : t('dashboard.systemStatus.disconnected'),
    },
    {
      key: 'capi',
      icon: BarChart3,
      label: 'Meta CAPI',
      ok: status.capiConfigured,
      detail: status.capiConfigured
        ? t('dashboard.systemStatus.configured')
        : t('dashboard.systemStatus.notConfigured'),
    },
    {
      key: 'automations',
      icon: Bot,
      label: t('automations.title'),
      ok: status.activeAutomations > 0,
      detail:
        status.activeAutomations === 1
          ? t('dashboard.systemStatus.activeOne', status.activeAutomations)
          : t('dashboard.systemStatus.activeMany', status.activeAutomations),
    },
    {
      key: 'broadcasts',
      icon: Radio,
      label: t('broadcasts.title'),
      ok: true,
      detail:
        status.scheduledBroadcasts === 1
          ? t('dashboard.systemStatus.scheduledOne', status.scheduledBroadcasts)
          : t('dashboard.systemStatus.scheduledMany', status.scheduledBroadcasts),
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {pills.map((pill) => (
        <div
          key={pill.key}
          className="flex min-w-0 items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm"
        >
          <pill.icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium">{pill.label}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-xs">
            {pill.ok ? (
              <CheckCircle2 className="size-3 shrink-0 text-emerald-400" />
            ) : (
              <XCircle className="size-3 shrink-0 text-muted-foreground/60" />
            )}
            <span className={`hidden sm:inline ${pill.ok ? 'text-emerald-600' : 'text-muted-foreground'}`}>
              {pill.detail}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}
