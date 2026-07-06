'use client';

import { useState } from 'react';
import type { Lang } from './translations';
import t from './translations';
import { CopyButton } from './copy-button';
import {
  endpoints,
  statusCodes,
  scopeRows,
  webhookEvents,
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

interface SectionProps {
  title: string;
  children: React.ReactNode;
  id?: string;
}

function Section({ title, children, id }: SectionProps) {
  return (
    <section id={id} className="mb-10 scroll-mt-20">
      <h2 className="mb-4 text-2xl font-bold tracking-tight text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="mb-3 text-lg font-semibold text-foreground">{title}</h3>
      {children}
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

function EndpointCard({ ep, lang, copyLabel, copiedLabel }: { ep: typeof endpoints[number]; lang: Lang; copyLabel: string; copiedLabel: string }) {
  const desc = ep.description[lang] || ep.description.en;
  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {ep.method.split(' / ').map((m) => (
          <span
            key={m}
            className={`rounded-md px-2 py-0.5 text-xs font-bold ${
              m === 'GET' ? 'bg-green-500/15 text-green-600 dark:text-green-400' :
              m === 'POST' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' :
              m === 'PATCH' || m === 'PUT' ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400' :
              m === 'DELETE' ? 'bg-red-500/15 text-red-600 dark:text-red-400' :
              'bg-muted text-muted-foreground'
            }`}
          >
            {m}
          </span>
        ))}
        <code className="text-sm font-semibold text-foreground">{ep.path}</code>
      </div>

      {ep.scopes.length > 0 && (
        <p className="mb-2 text-xs text-muted-foreground">
          Scope: <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{ep.scopes.join(', ')}</code>
        </p>
      )}

      <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{desc}</p>

      {ep.details && ep.details.length > 0 && (
        <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {ep.details.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}

      {ep.notes && ep.notes.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          {ep.notes.map((n, i) => <p key={i}>{n}</p>)}
        </div>
      )}

      {ep.curl && (
        <div className="mb-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">curl</p>
          <CodeBlock content={ep.curl} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        </div>
      )}

      {ep.json && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Response</p>
          <CodeBlock content={ep.json} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        </div>
      )}
    </div>
  );
}

export function ApiDocsClient() {
  const [lang, setLang] = useState<Lang>('pt');
  const tr = t[lang];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Language selector */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{tr.pageTitle}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{tr.pageSubtitle}</p>
        </div>
        <div className="ml-6 shrink-0">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            aria-label={tr.languageLabel}
          >
            {LANG_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.flag} {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Authentication */}
      <Section title={tr.authTitle} id="authentication">
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{tr.authDesc}</p>
        <div className="mb-3">
          <CodeBlock content="Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{tr.authKeyDesc}</p>

        <SubSection title={tr.authCreatingTitle}>
          <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
            {authSteps.map(([num, text]) => (
              <li key={num}>{text}</li>
            ))}
          </ol>
        </SubSection>

        <SubSection title={tr.authRevokingTitle}>
          <p className="text-sm text-muted-foreground">{tr.authRevokingDesc}</p>
        </SubSection>
      </Section>

      {/* Scopes */}
      <Section title={tr.scopesTitle} id="scopes">
        <p className="mb-3 text-sm text-muted-foreground">{tr.scopesDesc}</p>
        <Table headers={[tr.scopesHeaderScope, tr.scopesHeaderAllows]} rows={scopeRows} />
        <p className="mt-3 text-sm text-muted-foreground">{tr.scopesNoScopes}</p>
      </Section>

      {/* Response envelope */}
      <Section title={tr.envelopeTitle} id="envelope">
        <p className="mb-3 text-sm text-muted-foreground">{tr.envelopeDesc}</p>
        <div className="mb-3 space-y-2">
          <CodeBlock content={successEnvelope} copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
          <CodeBlock content={errorEnvelope} copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
        </div>
        <Table headers={['Status', tr.envelopeCode, tr.envelopeMeaning]} rows={statusCodes} />
      </Section>

      {/* Rate limits */}
      <Section title={tr.rateLimitTitle} id="rate-limits">
        <p className="mb-3 text-sm text-muted-foreground">{tr.rateLimitDesc}</p>
        <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Retry-After — seconds until the window resets</li>
          <li>X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset</li>
        </ul>
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <p>{tr.rateLimitNote}</p>
        </div>
      </Section>

      {/* Endpoints */}
      <Section title={tr.endpointsTitle} id="endpoints">
        {endpoints.map((ep, i) => (
          <EndpointCard key={i} ep={ep} lang={lang} copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
        ))}
      </Section>

      {/* Pagination */}
      <Section title={tr.paginationTitle} id="pagination">
        <p className="mb-3 text-sm text-muted-foreground">{tr.paginationDesc}</p>
        <CodeBlock content={paginationExample} copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
        <p className="mt-3 text-sm text-muted-foreground">{tr.paginationCursors}</p>
      </Section>

      {/* Webhooks */}
      <Section title={tr.webhooksTitle} id="webhooks">
        <p className="mb-3 text-sm text-muted-foreground">{tr.webhooksDesc}</p>
        <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          <p>{tr.webhooksMigration}</p>
        </div>

        <SubSection title={tr.webhooksEventsTitle}>
          <Table headers={[tr.webhooksEventsHeaderEvent, tr.webhooksEventsHeaderFires]} rows={webhookEvents} />
        </SubSection>

        <SubSection title={tr.webhooksManageTitle}>
          <p className="mb-2 text-sm text-muted-foreground">All under scope webhooks:manage.</p>
          <div className="overflow-x-auto rounded-lg border border-border">
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
        </SubSection>

        <SubSection title={tr.webhooksDeliveryTitle}>
          <p className="mb-2 text-sm text-muted-foreground">{tr.webhooksDeliveryDesc}</p>
          <CodeBlock content={deliveryPayload} copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
          <p className="mt-2 text-sm text-muted-foreground">
            Headers: <code className="rounded bg-muted px-1 font-mono">X-Wacrm-Event</code>,{' '}
            <code className="rounded bg-muted px-1 font-mono">X-Wacrm-Webhook-Id</code>,{' '}
            <code className="rounded bg-muted px-1 font-mono">X-Wacrm-Signature</code>.
          </p>
        </SubSection>

        <SubSection title={tr.webhooksVerifyTitle}>
          <p className="mb-2 text-sm text-muted-foreground">
            X-Wacrm-Signature: t=&lt;unix_seconds&gt;,v1=&lt;hex&gt; where v1 = HMAC-SHA256(secret, &quot;{'${t}.${rawBody}'}&quot;). Recompute over the raw request body and compare in constant time.
          </p>
          <CodeBlock content={verifyExample} copyLabel={tr.copyLabel} copiedLabel={tr.copiedLabel} />
        </SubSection>

        <SubSection title={tr.webhooksSemanticsTitle}>
          <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{tr.webhooksSemanticsBestEffort}</p>
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            <p>{tr.webhooksSemanticsTargetRestrictions}</p>
          </div>
        </SubSection>
      </Section>

      {/* Roadmap */}
      <Section title={tr.roadmapTitle} id="roadmap">
        <p className="text-sm leading-relaxed text-muted-foreground">{tr.roadmapDesc}</p>
      </Section>
    </div>
  );
}
