'use client'

import { useCallback, useEffect, useState } from 'react'
import { Braces, FileCode2, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { useLanguage } from '@/hooks/use-language'
import { SettingsPanelHead } from './settings-panel-head'
import { importCurl } from '@/lib/ai/curl'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
interface Tool { id: string; name: string; description: string; method: Method; endpoint_url: string; timeout_ms: number; is_active: boolean; parameters: unknown[]; has_headers: boolean }
interface NativeTool { name: string; description: string; parameters: unknown[] }
const empty = { name: '', description: '', method: 'GET' as Method, endpoint_url: '', timeout_ms: 10000, headers: '{}', query_params: '{}', parameters: '[]', is_active: true }

export function AiToolsSettings({ onInsertPromptVariable, onNativeToolsChange }: { onInsertPromptVariable?: (variable: string) => void; onNativeToolsChange?: (tools: NativeTool[]) => void }) {
  const { t } = useLanguage()
  const [tools, setTools] = useState<Tool[]>([])
  const [nativeTools, setNativeTools] = useState<NativeTool[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(empty)
  const [open, setOpen] = useState(false)
  const [curlCommand, setCurlCommand] = useState('')

  const load = useCallback(async () => {
    try { const res = await fetch('/api/ai/tools', { cache: 'no-store' }); const data = await res.json(); if (res.ok) { const natives = data.native_tools ?? []; setTools(data.tools ?? []); setNativeTools(natives); onNativeToolsChange?.(natives) } else toast.error(data.error ?? t('aiTools.loadFailed')) }
    catch { toast.error(t('aiTools.loadError')) } finally { setLoading(false) }
  }, [t])
  useEffect(() => { load() }, [load])
  const update = <K extends keyof typeof empty>(key: K, value: typeof empty[K]) => setForm((current) => ({ ...current, [key]: value }))

  function applyCurlImport() {
    try {
      const imported = importCurl(curlCommand)
      setForm((current) => ({ ...current, method: imported.method, endpoint_url: imported.endpointUrl, headers: JSON.stringify(imported.headers, null, 2), query_params: JSON.stringify(imported.queryParams, null, 2), parameters: JSON.stringify(imported.parameters, null, 2) }))
      toast.success(t('aiTools.curlImported'))
    } catch (error) { toast.error(error instanceof Error ? error.message : t('aiTools.curlImportFailed')) }
  }

  async function save() {
    let headers: unknown, query_params: unknown, parameters: unknown
    try { headers = JSON.parse(form.headers); query_params = JSON.parse(form.query_params); parameters = JSON.parse(form.parameters) }
    catch { toast.error(t('aiTools.invalidJson')); return }
    setSaving(true)
    try {
      const res = await fetch('/api/ai/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, headers, query_params, parameters }) })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? t('aiTools.createFailed')); return }
      toast.success(t('aiTools.created')); setForm(empty); setOpen(false); await load()
    } catch { toast.error(t('aiTools.saveError')) } finally { setSaving(false) }
  }
  async function remove(id: string) {
    if (!confirm(t('aiTools.confirmDelete'))) return
    const res = await fetch(`/api/ai/tools?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) { const data = await res.json(); toast.error(data.error ?? t('aiTools.deleteFailed')); return }
    toast.success(t('aiTools.deleted')); await load()
  }

  return <div>
    <SettingsPanelHead title={t('aiTools.title')} description={t('aiTools.description')} action={<Button onClick={() => setOpen(true)}><Plus className="mr-2 size-4" />{t('aiTools.newTool')}</Button>} />
    {open && <div role="dialog" aria-modal="true" aria-label={t('aiTools.createAriaLabel')} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><Card className="max-h-[90vh] w-full max-w-3xl overflow-y-auto shadow-xl"><CardContent className="grid gap-4 pt-6"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">{t('aiTools.createTitle')}</h2><p className="text-sm text-muted-foreground">{t('aiTools.createDesc')}</p></div><Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t('aiTools.close')}</Button></div>
      <div className="rounded-md border bg-muted/30 p-3"><Label htmlFor="ai-tool-curl">{t('aiTools.importFromCurl')}</Label><Textarea id="ai-tool-curl" className="mt-2" value={curlCommand} onChange={(e) => setCurlCommand(e.target.value)} rows={4} placeholder={'curl -X POST "https://api.example.com/orders" -H "Authorization: Bearer …" -d \'{"order_id":"123"}\''} /><div className="mt-2 flex justify-end"><Button variant="outline" size="sm" onClick={applyCurlImport}><FileCode2 className="mr-2 size-4" />{t('aiTools.fillFromCurl')}</Button></div></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label>{t('aiTools.name')}</Label><Input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="buscar_produto" /></div><div><Label>{t('aiTools.method')}</Label><select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.method} onChange={(e) => update('method', e.target.value as Method)}>{(['GET','POST','PUT','PATCH','DELETE'] as Method[]).map((method) => <option key={method}>{method}</option>)}</select></div></div>
      <div><Label>{t('aiTools.descriptionLabel')}</Label><Textarea value={form.description} onChange={(e) => update('description', e.target.value)} placeholder={t('aiTools.descriptionPlaceholder')} /></div>
      <div><Label>{t('aiTools.endpointUrl')}</Label><Input value={form.endpoint_url} onChange={(e) => update('endpoint_url', e.target.value)} placeholder="https://api.example.com/products/{{codigo}}" /></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label>{t('aiTools.headers')}</Label><Textarea value={form.headers} onChange={(e) => update('headers', e.target.value)} placeholder={'{"Authorization":"Bearer token"}'} /></div><div><Label>{t('aiTools.queryParams')}</Label><Textarea value={form.query_params} onChange={(e) => update('query_params', e.target.value)} placeholder={'{"search":"{{termo}}"}'} /></div></div>
      <div><Label>{t('aiTools.parameters')}</Label><Textarea value={form.parameters} onChange={(e) => update('parameters', e.target.value)} placeholder={'[{"name":"codigo","type":"string","description":"Product code","required":true}]'} /></div>
      <div className="flex items-center gap-3"><Switch checked={form.is_active} onCheckedChange={(value) => update('is_active', value)} /><Label>{t('aiTools.toolEnabled')}</Label><Label className="ml-auto">{t('aiTools.timeout')}</Label><Input className="w-28" type="number" min="1000" max="30000" value={form.timeout_ms} onChange={(e) => update('timeout_ms', Number(e.target.value))} /></div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>{t('aiTools.cancel')}</Button><Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 size-4 animate-spin" />}{t('aiTools.saveTool')}</Button></div>
    </CardContent></Card></div>}
    {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div> : tools.length === 0 ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('aiTools.empty')}</CardContent></Card> : <div className="space-y-3">{tools.map((tool) => <Card key={tool.id}><CardContent className="flex items-start gap-4 py-4"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><code className="font-semibold">{tool.name}</code><span className="rounded bg-muted px-1.5 py-0.5 text-xs">{tool.method}</span>{!tool.is_active && <span className="text-xs text-muted-foreground">{t('aiTools.disabled')}</span>}</div><p className="mt-1 text-sm text-muted-foreground">{tool.description}</p><p className="mt-1 truncate text-xs text-muted-foreground">{tool.endpoint_url}</p></div><div className="flex shrink-0 gap-1">{onInsertPromptVariable && <Button variant="ghost" size="sm" onClick={() => onInsertPromptVariable(`{{tool.${tool.name}}}`)}><Braces className="mr-1 size-3.5" />{t('aiTools.promptButton')}</Button>}<Button variant="ghost" size="icon" aria-label={`${t('aiTools.delete')} ${tool.name}`} onClick={() => remove(tool.id)}><Trash2 className="size-4 text-destructive" /></Button></div></CardContent></Card>)}</div>}
  </div>
}
