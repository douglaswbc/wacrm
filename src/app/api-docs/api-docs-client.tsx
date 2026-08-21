'use client';

import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Lang } from './translations';
import t from './translations';
import { CopyButton } from './copy-button';
import {
  endpoints,
  statusCodes,
  scopeRows,
  webhookEvents,
  channelProviderTable,
  authSteps,
  paginationExample,
  successEnvelope,
  errorEnvelope,
  deliveryPayload,
  webhookManageSteps,
  verifyExample,
} from './content';

const LANG_OPTIONS: { value: Lang; label: string; flag: string }[] = [
  { value: 'pt', label: 'Português', flag: '🇧🇷' },
  { value: 'es', label: 'Español', flag: '🇪🇸' },
  { value: 'en', label: 'English', flag: '🇺🇸' },
];

type NavId =
  | 'auth'
  | 'scopes'
  | 'envelope'
  | 'rate-limits'
  | 'pagination'
  | 'webhooks'
  | 'roadmap'
  | `endpoint-${number}`;

interface NavEntry {
  id: NavId;
  labelKey: string;
  method?: string;
  path?: string;
}

const introNav: NavEntry[] = [
  { id: 'auth', labelKey: 'authTitle' },
  { id: 'scopes', labelKey: 'scopesTitle' },
  { id: 'envelope', labelKey: 'envelopeTitle' },
  { id: 'rate-limits', labelKey: 'rateLimitTitle' },
  { id: 'pagination', labelKey: 'paginationTitle' },
  { id: 'webhooks', labelKey: 'webhooksTitle' },
  { id: 'roadmap', labelKey: 'roadmapTitle' },
];

/** Sidebar endpoint grouping — order defines display order. */
const ENDPOINT_GROUPS: { labelKey: string; test: (path: string) => boolean }[] = [
  { labelKey: 'groupMessages', test: (p) => /^\/api\/v1\/(me$|messages$|instagram\/messages$)/.test(p) },
  { labelKey: 'groupConversations', test: (p) => p.startsWith('/api/v1/conversations') },
  { labelKey: 'groupBroadcasts', test: (p) => p.startsWith('/api/v1/broadcasts') },
  { labelKey: 'groupContacts', test: (p) => p.startsWith('/api/v1/contacts') },
  { labelKey: 'groupPipelinesDeals', test: (p) => /^\/api\/v1\/(pipelines|stages|deals)/.test(p) },
  { labelKey: 'groupMediaLibrary', test: (p) => p.startsWith('/api/v1/media-library') },
  { labelKey: 'groupGroups', test: (p) => p.startsWith('/api/v1/groups') },
  { labelKey: 'groupTeam', test: (p) => /^\/api\/v1\/(account|members)/.test(p) },
];

function methodColor(m: string): string {
  if (m === 'GET') return 'text-green-600 dark:text-green-400';
  if (m === 'POST') return 'text-blue-600 dark:text-blue-400';
  if (m.includes('PATCH') || m.includes('PUT')) return 'text-orange-600 dark:text-orange-400';
  if (m.includes('DELETE')) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

function CodeBlock({ content, copyLabel, copiedLabel }: { content: string; copyLabel?: string; copiedLabel?: string }) {
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-4 text-sm leading-relaxed">
        <code className="text-foreground">{content}</code>
      </pre>
      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
        <CopyButton content={content} label={copyLabel} copiedLabel={copiedLabel} />
      </div>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-2.5 text-left font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
              {row.map((cell, ci) => (
                <td key={ci} className={`px-4 py-2.5 ${ci === 0 ? 'font-mono text-foreground' : 'text-muted-foreground'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function methodBadge(m: string, small?: boolean) {
  const cls = small ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-block shrink-0 rounded-md font-bold ${cls} ${
      m === 'GET' ? 'bg-green-500/15 text-green-600 dark:text-green-400' :
      m === 'POST' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' :
      m.includes('PATCH') || m.includes('PUT') ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400' :
      m.includes('DELETE') ? 'bg-red-500/15 text-red-600 dark:text-red-400' :
      'bg-muted text-muted-foreground'
    }`}>
      {m}
    </span>
  );
}

function EndpointView({ ep, lang, copyLabel, copiedLabel }: { ep: typeof endpoints[number]; lang: Lang; copyLabel: string; copiedLabel: string }) {
  const desc = ep.description[lang] || ep.description.en;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {ep.method.split(' / ').map((m) => (
          <span key={m}>{methodBadge(m)}</span>
        ))}
        <code className="text-lg font-semibold text-foreground">{ep.path}</code>
      </div>

      {ep.scopes.length > 0 && (
        <p className="mb-3 text-sm text-muted-foreground">
          Scope: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{ep.scopes.join(', ')}</code>
        </p>
      )}

      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{desc}</p>

      {ep.details && ep.details.length > 0 && (
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {ep.details.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}

      {ep.notes && ep.notes.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          {ep.notes.map((n, i) => <p key={i}>{n}</p>)}
        </div>
      )}

      {ep.curl && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">curl</p>
          <CodeBlock content={ep.curl} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        </div>
      )}

      {ep.json && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Response</p>
          <CodeBlock content={ep.json} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        </div>
      )}
    </div>
  );
}

export function ApiDocsClient() {
  const [lang, setLang] = useState<Lang>('pt');
  const [activeNav, setActiveNav] = useState<NavId>('auth');
  const [search, setSearch] = useState('');
  const mainRef = useRef<HTMLElement>(null);
  const tr = t[lang];

  const endpointNav: NavEntry[] = useMemo(() =>
    endpoints.map((ep, i) => ({
      id: `endpoint-${i}` as NavId,
      labelKey: ep.path,
      method: ep.method.split(' / ')[0],
      path: ep.path,
    })),
  []);

  /** Sidebar groups filtered by the search query. */
  const groupedNav = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ENDPOINT_GROUPS.map((group) => ({
      labelKey: group.labelKey,
      items: endpointNav.filter(
        (item) =>
          group.test(item.path ?? '') &&
          (!q || (item.path ?? '').toLowerCase().includes(q)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [endpointNav, search]);

  function handleNav(id: NavId) {
    setActiveNav(id);
    mainRef.current?.scrollTo({ top: 0 });
  }

  function renderContent() {
    if (activeNav.startsWith('endpoint-')) {
      const idx = parseInt(activeNav.replace('endpoint-', ''), 10);
      const ep = endpoints[idx];
      if (!ep) return null;
      return (
        <EndpointView
          ep={ep}
          lang={lang}
          copyLabel={tr.copyLabel}
          copiedLabel={tr.copiedLabel}
        />
      );
    }

    switch (activeNav) {
      case 'auth':
        return (
          <div>
            <h2 className="mb-4 text-2xl font-bold text-foreground">{tr.authTitle}</h2>
            <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{tr.authDesc}</p>
            <div className="mb-3">
              <CodeBlock content="Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
            </div>
            <p className="mb-4 text-sm text-muted-foreground">{tr.authKeyDesc}</p>
            <h3 className="mb-2 text-lg font-semibold text-foreground">{tr.authCreatingTitle}</h3>
            <ol className="mb-4 list-inside list-decimal space-y-1 text-sm text-muted-foreground">
              {authSteps.map(([num, text]) => (
                <li key={num}>{text}</li>
              ))}
            </ol>
            <h3 className="mb-2 text-lg font-semibold text-foreground">{tr.authRevokingTitle}</h3>
            <p className="text-sm text-muted-foreground">{tr.authRevokingDesc}</p>
          </div>
        );

      case 'scopes':
        return (
          <div>
            <h2 className="mb-4 text-2xl font-bold text-foreground">{tr.scopesTitle}</h2>
            <p className="mb-3 text-sm text-muted-foreground">{tr.scopesDesc}</p>
            <Table headers={[tr.scopesHeaderScope, tr.scopesHeaderAllows]} rows={scopeRows} />
            <p className="mt-3 text-sm text-muted-foreground">{tr.scopesNoScopes}</p>
          </div>
        );

      case 'envelope':
        return (
          <div>
            <h2 className="mb-4 text-2xl font-bold text-foreground">{tr.envelopeTitle}</h2>
            <p className="mb-3 text-sm text-muted-foreground">{tr.envelopeDesc}</p>
            <div className="mb-3 space-y-2">
              <CodeBlock content={successEnvelope} copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
              <CodeBlock content={errorEnvelope} copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
            </div>
            <Table headers={['Status', tr.envelopeCode, tr.envelopeMeaning]} rows={statusCodes} />
          </div>
        );

      case 'rate-limits':
        return (
          <div>
            <h2 className="mb-4 text-2xl font-bold text-foreground">{tr.rateLimitTitle}</h2>
            <p className="mb-3 text-sm text-muted-foreground">{tr.rateLimitDesc}</p>
            <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Retry-After — seconds until the window resets</li>
              <li>X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset</li>
            </ul>
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              <p>{tr.rateLimitNote}</p>
            </div>
          </div>
        );

      case 'pagination':
        return (
          <div>
            <h2 className="mb-4 text-2xl font-bold text-foreground">{tr.paginationTitle}</h2>
            <p className="mb-3 text-sm text-muted-foreground">{tr.paginationDesc}</p>
            <CodeBlock content={paginationExample} copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
            <p className="mt-3 text-sm text-muted-foreground">{tr.paginationCursors}</p>
          </div>
        );

      case 'webhooks':
        return (
          <div>
            <h2 className="mb-4 text-2xl font-bold text-foreground">{tr.webhooksTitle}</h2>
            <p className="mb-3 text-sm text-muted-foreground">{tr.webhooksDesc}</p>
            <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
              <p>{tr.webhooksMigration}</p>
            </div>
            <h3 className="mb-3 text-lg font-semibold text-foreground">{tr.webhooksEventsTitle}</h3>
            <Table headers={[tr.webhooksEventsHeaderEvent, tr.webhooksEventsHeaderFires]} rows={webhookEvents} />
            <h3 className="mb-3 mt-6 text-lg font-semibold text-foreground">{tr.webhooksChannelFieldsTitle}</h3>
            <p className="mb-2 text-sm text-muted-foreground">{tr.webhooksChannelFieldsDesc}</p>
            <Table headers={['Field', 'Values', 'Description']} rows={channelProviderTable} />
            <h3 className="mb-3 mt-6 text-lg font-semibold text-foreground">{tr.webhooksManageTitle}</h3>
            <p className="mb-2 text-sm text-muted-foreground">All under scope webhooks:manage.</p>
            <div className="mb-6 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Method & Path</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {webhookManageSteps.map(([method, desc], i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-mono text-sm text-foreground">{method}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="mb-3 text-lg font-semibold text-foreground">{tr.webhooksDeliveryTitle}</h3>
            <p className="mb-2 text-sm text-muted-foreground">{tr.webhooksDeliveryDesc}</p>
            <CodeBlock content={deliveryPayload} copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
            <p className="mb-6 mt-2 text-sm text-muted-foreground">
              Headers: <code className="rounded bg-muted px-1 font-mono">X-Wacrm-Event</code>,{' '}
              <code className="rounded bg-muted px-1 font-mono">X-Wacrm-Webhook-Id</code>,{' '}
              <code className="rounded bg-muted px-1 font-mono">X-Wacrm-Signature</code>.
            </p>
            <h3 className="mb-3 text-lg font-semibold text-foreground">{tr.webhooksVerifyTitle}</h3>
            <p className="mb-2 text-sm text-muted-foreground">
              {'X-Wacrm-Signature: t=&lt;unix_seconds&gt;,v1=&lt;hex&gt; where v1 = HMAC-SHA256(secret, "${t}.${rawBody}"). Recompute over the raw request body and compare in constant time.'}
            </p>
            <CodeBlock content={verifyExample} copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
            <h3 className="mb-3 mt-6 text-lg font-semibold text-foreground">{tr.webhooksSemanticsTitle}</h3>
            <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{tr.webhooksSemanticsBestEffort}</p>
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              <p>{tr.webhooksSemanticsTargetRestrictions}</p>
            </div>
          </div>
        );

      case 'roadmap':
        return (
          <div>
            <h2 className="mb-4 text-2xl font-bold text-foreground">{tr.roadmapTitle}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{tr.roadmapDesc}</p>
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border bg-background px-4 py-3 sm:px-6">
        <h1 className="text-lg font-bold text-foreground sm:text-xl">{tr.pageTitle}</h1>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          className="h-8 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          aria-label={tr.languageLabel}
        >
          {LANG_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.flag} {opt.label}
            </option>
          ))}
        </select>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <nav className="hidden w-64 shrink-0 border-r border-border bg-card p-3 lg:block overflow-y-auto">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr.searchEndpoints}
              className="h-8 bg-muted pl-8 text-sm"
              aria-label={tr.searchEndpoints}
            />
          </div>

          <div className="mb-3">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Introduction
            </p>
            <ul className="mt-1 space-y-0.5">
              {introNav.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => handleNav(item.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                      activeNav === item.id
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {tr[item.labelKey as keyof typeof tr] as string}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {groupedNav.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">{tr.searchNoResults}</p>
          ) : (
            groupedNav.map((group) => (
              <div key={group.labelKey} className="mb-3 last:mb-0">
                <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {tr[group.labelKey as keyof typeof tr] as string}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => handleNav(item.id)}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                          activeNav === item.id
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        {item.method && (
                          <span className={`shrink-0 text-[10px] font-bold ${methodColor(item.method)}`}>
                            {item.method}
                          </span>
                        )}
                        <span className="truncate font-mono text-xs">{item.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </nav>

        {/* Mobile nav tabs */}
        <div className="flex flex-col lg:hidden">
          <select
            value={activeNav}
            onChange={(e) => handleNav(e.target.value as NavId)}
            className="mx-3 mt-3 h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          >
            <optgroup label="Introduction">
              {introNav.map((item) => (
                <option key={item.id} value={item.id}>
                  {tr[item.labelKey as keyof typeof tr] as string}
                </option>
              ))}
            </optgroup>
            <optgroup label={tr.endpointsTitle}>
              {endpointNav.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.method} {item.path}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Main content */}
        <main ref={mainRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
