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
import { SettingsPanelHead } from './settings-panel-head'
import { importCurl } from '@/lib/ai/curl'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
interface Tool { id: string; name: string; description: string; method: Method; endpoint_url: string; timeout_ms: number; is_active: boolean; parameters: unknown[]; has_headers: boolean }
interface NativeTool { name: string; description: string; parameters: unknown[] }
const empty = { name: '', description: '', method: 'GET' as Method, endpoint_url: '', timeout_ms: 10000, headers: '{}', query_params: '{}', parameters: '[]', is_active: true }

export function AiToolsSettings({ onInsertPromptVariable, onNativeToolsChange }: { onInsertPromptVariable?: (variable: string) => void; onNativeToolsChange?: (tools: NativeTool[]) => void }) {
  const [tools, setTools] = useState<Tool[]>([])
  const [nativeTools, setNativeTools] = useState<NativeTool[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(empty)
  const [open, setOpen] = useState(false)
  const [curlCommand, setCurlCommand] = useState('')

  const load = useCallback(async () => {
    try { const res = await fetch('/api/ai/tools', { cache: 'no-store' }); const data = await res.json(); if (res.ok) { const natives = data.native_tools ?? []; setTools(data.tools ?? []); setNativeTools(natives); onNativeToolsChange?.(natives) } else toast.error(data.error ?? 'Failed to load tools.') }
    catch { toast.error('Could not load AI tools.') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  const update = <K extends keyof typeof empty>(key: K, value: typeof empty[K]) => setForm((current) => ({ ...current, [key]: value }))

  function applyCurlImport() {
    try {
      const imported = importCurl(curlCommand)
      setForm((current) => ({ ...current, method: imported.method, endpoint_url: imported.endpointUrl, headers: JSON.stringify(imported.headers, null, 2), query_params: JSON.stringify(imported.queryParams, null, 2), parameters: JSON.stringify(imported.parameters, null, 2) }))
      toast.success('cURL imported. Review the generated parameters before saving.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not import cURL.') }
  }

  async function save() {
    let headers: unknown, query_params: unknown, parameters: unknown
    try { headers = JSON.parse(form.headers); query_params = JSON.parse(form.query_params); parameters = JSON.parse(form.parameters) }
    catch { toast.error('Headers, query parameters and parameters must be valid JSON.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/ai/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, headers, query_params, parameters }) })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Failed to create tool.'); return }
      toast.success('AI tool created.'); setForm(empty); setOpen(false); await load()
    } catch { toast.error('Could not save AI tool.') } finally { setSaving(false) }
  }
  async function remove(id: string) {
    if (!confirm('Delete this AI tool?')) return
    const res = await fetch(`/api/ai/tools?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) { const data = await res.json(); toast.error(data.error ?? 'Failed to delete tool.'); return }
    toast.success('AI tool deleted.'); await load()
  }

  return <div>
    <SettingsPanelHead title="AI Tools" description="Configure external APIs the agent can call automatically. Add {{tool.name}} to the prompt to explicitly tell it when to use a tool." action={<Button onClick={() => setOpen(true)}><Plus className="mr-2 size-4" />New tool</Button>} />
    {open && <div role="dialog" aria-modal="true" aria-label="Create AI tool" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><Card className="max-h-[90vh] w-full max-w-3xl overflow-y-auto shadow-xl"><CardContent className="grid gap-4 pt-6"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">Create AI tool</h2><p className="text-sm text-muted-foreground">Create manually or import a cURL command to fill the fields below.</p></div><Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button></div>
      <div className="rounded-md border bg-muted/30 p-3"><Label htmlFor="ai-tool-curl">Import from cURL</Label><Textarea id="ai-tool-curl" className="mt-2" value={curlCommand} onChange={(e) => setCurlCommand(e.target.value)} rows={4} placeholder={'curl -X POST "https://api.example.com/orders" -H "Authorization: Bearer …" -d \'{"order_id":"123"}\''} /><div className="mt-2 flex justify-end"><Button variant="outline" size="sm" onClick={applyCurlImport}><FileCode2 className="mr-2 size-4" />Fill fields from cURL</Button></div></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label>Name</Label><Input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="buscar_produto" /></div><div><Label>Method</Label><select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.method} onChange={(e) => update('method', e.target.value as Method)}>{(['GET','POST','PUT','PATCH','DELETE'] as Method[]).map((method) => <option key={method}>{method}</option>)}</select></div></div>
      <div><Label>Description (the AI reads this)</Label><Textarea value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Search product availability and price by code." /></div>
      <div><Label>Endpoint URL</Label><Input value={form.endpoint_url} onChange={(e) => update('endpoint_url', e.target.value)} placeholder="https://api.example.com/products/{{codigo}}" /></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label>Headers (JSON)</Label><Textarea value={form.headers} onChange={(e) => update('headers', e.target.value)} placeholder={'{"Authorization":"Bearer token"}'} /></div><div><Label>Query parameters (JSON)</Label><Textarea value={form.query_params} onChange={(e) => update('query_params', e.target.value)} placeholder={'{"search":"{{termo}}"}'} /></div></div>
      <div><Label>Parameters (JSON)</Label><Textarea value={form.parameters} onChange={(e) => update('parameters', e.target.value)} placeholder={'[{"name":"codigo","type":"string","description":"Product code","required":true}]'} /></div>
      <div className="flex items-center gap-3"><Switch checked={form.is_active} onCheckedChange={(value) => update('is_active', value)} /><Label>Tool enabled</Label><Label className="ml-auto">Timeout (ms)</Label><Input className="w-28" type="number" min="1000" max="30000" value={form.timeout_ms} onChange={(e) => update('timeout_ms', Number(e.target.value))} /></div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 size-4 animate-spin" />}Save tool</Button></div>
    </CardContent></Card></div>}
    {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div> : tools.length === 0 ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No external tools configured yet. Import a cURL command or add one manually.</CardContent></Card> : <div className="space-y-3">{tools.map((tool) => <Card key={tool.id}><CardContent className="flex items-start gap-4 py-4"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><code className="font-semibold">{tool.name}</code><span className="rounded bg-muted px-1.5 py-0.5 text-xs">{tool.method}</span>{!tool.is_active && <span className="text-xs text-muted-foreground">Disabled</span>}</div><p className="mt-1 text-sm text-muted-foreground">{tool.description}</p><p className="mt-1 truncate text-xs text-muted-foreground">{tool.endpoint_url}</p></div><div className="flex shrink-0 gap-1">{onInsertPromptVariable && <Button variant="ghost" size="sm" onClick={() => onInsertPromptVariable(`{{tool.${tool.name}}}`)}><Braces className="mr-1 size-3.5" />Prompt</Button>}<Button variant="ghost" size="icon" aria-label={`Delete ${tool.name}`} onClick={() => remove(tool.id)}><Trash2 className="size-4 text-destructive" /></Button></div></CardContent></Card>)}</div>}
  </div>
}
