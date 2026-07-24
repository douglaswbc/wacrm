"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useLanguage } from '@/hooks/use-language'
import { formatCurrency } from '@/lib/currency'
import {
  MessageSquare,
  UserPlus,
  DollarSign,
  Send,
  AlertTriangle,
  TrendingUp,
  Clock,
  Target,
} from 'lucide-react'

import {
  loadActivity,
  loadConversationsSeries,
  loadExtendedMetrics,
  loadPipelineDonut,
  loadResponseTime,
  loadSystemStatus,
} from '@/lib/dashboard/queries'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  ExtendedMetrics,
  PipelineDonutData,
  ResponseTimeSummary,
  SystemStatus,
} from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { SystemStatusBar } from '@/components/dashboard/system-status'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'

type RangeDays = 7 | 30 | 90

export default function DashboardPage() {
  const { defaultCurrency } = useAuth()
  const { t } = useLanguage()

  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [systemStatusLoading, setSystemStatusLoading] = useState(true)

  const [metrics, setMetrics] = useState<ExtendedMetrics | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [range, setRange] = useState<RangeDays>(30)
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(true)

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    void loadSystemStatus(db)
      .then((s) => setSystemStatus(s))
      .catch((err) => console.error('[dashboard] system status failed:', err))
      .finally(() => setSystemStatusLoading(false))

    void loadExtendedMetrics(db, defaultCurrency)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    void loadConversationsSeries(db, 30)
      .then((s) => setSeries((prev) => ({ ...prev, 30: s })))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false))

    void loadPipelineDonut(db)
      .then((p) => setPipeline(p))
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false))

    void loadResponseTime(db)
      .then((r) => setResponseTime(r))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false))

    void loadActivity(db, 50)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false))
  }, [defaultCurrency])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      if (series[r] !== null) return
      setSeriesLoading(true)
      const db = createClient()
      loadConversationsSeries(db, r)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false))
    },
    [series],
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('dashboard.title')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('dashboard.subtitle')}
          </p>
        </div>
        <QuickActions compact />
      </div>

      {/* System status */}
      <SystemStatusBar status={systemStatus} loading={systemStatusLoading} />

      {/* Metric cards — 2 rows of 4 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('dashboard.activeConversations')}
              value={metrics.activeConversations.current.toLocaleString()}
              icon={MessageSquare}
              delta={{
                sign: metrics.activeConversations.previous,
                label: deltaLabel(metrics.activeConversations.previous, t('dashboard.vsYesterday'), t('dashboard.noChange')),
              }}
            />
            <MetricCard
              title={t('dashboard.newContactsToday')}
              value={metrics.newContactsToday.current.toLocaleString()}
              icon={UserPlus}
              delta={{
                sign: metrics.newContactsToday.current - metrics.newContactsToday.previous,
                label: deltaLabel(
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                  t('dashboard.vsYesterday'),
                  t('dashboard.noChange'),
                ),
              }}
            />
            <MetricCard
              title={t('dashboard.openDealsValue')}
              value={formatCurrency(metrics.openDealsValue, defaultCurrency)}
              icon={DollarSign}
              subtitle={`${metrics.openDealsCount} open deal${metrics.openDealsCount === 1 ? '' : 's'}`}
            />
            <MetricCard
              title={t('dashboard.messagesSentToday')}
              value={metrics.messagesSentToday.current.toLocaleString()}
              icon={Send}
              delta={{
                sign: metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                label: deltaLabel(
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                  t('dashboard.vsYesterday'),
                  t('dashboard.noChange'),
                ),
              }}
            />
            {/* Row 2 — new metrics */}
            <MetricCard
              title="Não atribuídas"
              value={metrics.unassignedConversations.toLocaleString()}
              icon={AlertTriangle}
              subtitle={metrics.unassignedConversations > 0 ? 'Precisam de agente' : 'Todas atribuídas'}
            />
            <MetricCard
              title="Ganhos este mês"
              value={formatCurrency(metrics.wonDealsThisMonth.value, defaultCurrency)}
              icon={TrendingUp}
              subtitle={`${metrics.wonDealsThisMonth.count} deal${metrics.wonDealsThisMonth.count !== 1 ? 's' : ''} fechado${metrics.wonDealsThisMonth.count !== 1 ? 's' : ''}`}
            />
            <MetricCard
              title="Tempo de resposta"
              value={responseTime?.thisWeekAvg != null ? `${Math.round(responseTime.thisWeekAvg)}m` : '—'}
              icon={Clock}
              subtitle={
                responseTime?.thisWeekAvg != null && responseTime?.lastWeekAvg != null
                  ? deltaLabel(
                      Math.round(responseTime.lastWeekAvg - responseTime.thisWeekAvg),
                      'vs semana passada',
                      'Igual',
                    )
                  : 'Sem dados'
              }
            />
            <MetricCard
              title="Leads qualificados"
              value={metrics.leadsQualifiedToday.toLocaleString()}
              icon={Target}
              subtitle="Hoje com tags"
            />
          </>
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-3">
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            range={range}
            onRangeChange={handleRangeChange}
          />
        </div>
        <div className="h-full lg:col-span-2">
          <PipelineDonut
            data={pipeline}
            loading={pipelineLoading}
            currency={defaultCurrency}
          />
        </div>
      </div>

      {/* Response time */}
      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

      {/* Activity feed */}
      <ActivityFeed items={activity} loading={activityLoading} />
    </div>
  )
}

function deltaLabel(delta: number, suffix: string, noChange: string): string {
  if (delta === 0) return `${noChange} ${suffix}`
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${suffix}`
}
