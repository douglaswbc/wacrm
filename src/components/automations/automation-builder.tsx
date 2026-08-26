"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeft,
  ChevronDown,
  Plus,
  Trash2,
  GripVertical,
  MessageSquare,
  FileText,
  Tag,
  TagIcon,
  UserCheck,
  PencilLine,
  Briefcase,
  Hourglass,
  GitBranch,
  Webhook,
  CircleSlash,
  Zap,
  Loader2,
  ArrowDown,
  ArrowUp,
  ImageIcon,
  Bot,
  BrainCircuit,
  ScanText,
  ScanSearch,
  HandCoins,
  CalendarCheck,
  PlusCircle,
  FolderOpen,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  AccountMember,
  AutomationStepType,
  AutomationTriggerType,
  CustomField,
  KeywordMatchTriggerConfig,
  MessageTemplate,
  Tag as TagRecord,
} from "@/types"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { useLanguage } from "@/hooks/use-language"
import { MediaPicker } from "@/components/media-library/media-picker"

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branches?: { yes: BuilderStep[]; no: BuilderStep[] }
}

export interface BuilderInitial {
  id?: string
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  is_active: boolean
  /** Channel scope — NULL = both. */
  channel?: 'whatsapp' | 'instagram' | null
  /** WhatsApp provider scope — NULL = both (Zernio + RyzeAPI). */
  provider?: 'meta' | 'ryzeapi' | 'zernio' | 'evolution' | null
  steps: BuilderStep[]
}

// ------------------------------------------------------------
// Step metadata — one source of truth for icon + label + border color
// ------------------------------------------------------------

interface StepMeta {
  labelKey: string
  icon: typeof Zap
  /** Left-border accent color per spec. */
  border: string
}

const STEP_META: Record<AutomationStepType, StepMeta> = {
  send_message: { labelKey: "automations.stepSendMessage", icon: MessageSquare, border: "border-l-primary" },
  send_template: { labelKey: "automations.stepSendTemplate", icon: FileText, border: "border-l-primary" },
  send_button: { labelKey: "automations.stepSendButton", icon: MessageSquare, border: "border-l-primary" },
  send_media: { labelKey: "automations.stepSendMedia", icon: ImageIcon, border: "border-l-primary" },
  add_tag: { labelKey: "automations.stepAddTag", icon: Tag, border: "border-l-primary" },
  remove_tag: { labelKey: "automations.stepRemoveTag", icon: TagIcon, border: "border-l-primary" },
  assign_conversation: { labelKey: "automations.stepAssignConversation", icon: UserCheck, border: "border-l-primary" },
  update_contact_field: { labelKey: "automations.stepUpdateContactField", icon: PencilLine, border: "border-l-primary" },
  create_deal: { labelKey: "automations.stepCreateDeal", icon: Briefcase, border: "border-l-primary" },
  update_deal: { labelKey: "automations.stepUpdateDeal", icon: HandCoins, border: "border-l-primary" },
  calendar_update_status: { labelKey: "automations.stepCalendarUpdateStatus", icon: CalendarCheck, border: "border-l-primary" },
  wait: { labelKey: "automations.stepWait", icon: Hourglass, border: "border-l-border" },
  condition: { labelKey: "automations.stepCondition", icon: GitBranch, border: "border-l-amber-500" },
  send_webhook: { labelKey: "automations.stepSendWebhook", icon: Webhook, border: "border-l-primary" },
  close_conversation: { labelKey: "automations.stepCloseConversation", icon: CircleSlash, border: "border-l-primary" },
  ai_condition: { labelKey: "automations.stepAiCondition", icon: BrainCircuit, border: "border-l-purple-500" },
  ai_reply: { labelKey: "automations.stepAiReply", icon: Bot, border: "border-l-purple-500" },
  ai_extract: { labelKey: "automations.stepAiExtract", icon: ScanText, border: "border-l-purple-500" },
  ai_classify: { labelKey: "automations.stepAiClassify", icon: ScanSearch, border: "border-l-purple-500" },
}

const ADDABLE_STEPS: AutomationStepType[] = [
  "send_message",
  "send_template",
  "send_button",
  "send_media",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "create_deal",
  "update_deal",
  "calendar_update_status",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
  "ai_condition",
  "ai_reply",
  "ai_extract",
  "ai_classify",
]

const TRIGGER_OPTIONS: { value: AutomationTriggerType; labelKey: string; hintKey: string }[] = [
  {
    value: "new_message_received",
    labelKey: "automations.triggerNewMessage",
    hintKey: "automations.triggerNewMessageHint",
  },
  {
    value: "first_inbound_message",
    labelKey: "automations.triggerFirstInbound",
    hintKey: "automations.triggerFirstInboundHint",
  },
  {
    value: "keyword_match",
    labelKey: "automations.triggerKeywordMatch",
    hintKey: "automations.triggerKeywordMatchHint",
  },
  {
    value: "new_contact_created",
    labelKey: "automations.triggerNewContact",
    hintKey: "automations.triggerNewContactHint",
  },
  {
    value: "conversation_assigned",
    labelKey: "automations.triggerConversationAssigned",
    hintKey: "automations.triggerConversationAssignedHint",
  },
  {
    value: "tag_added",
    labelKey: "automations.triggerTagAdded",
    hintKey: "automations.triggerTagAddedHint",
  },
  {
    value: "time_based",
    labelKey: "automations.triggerTimeBased",
    hintKey: "automations.triggerTimeBasedHint",
  },
]

function cid(): string {
  return (
    "c_" +
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  )
}

function blankConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case "send_message":
      return { text: "" }
    case "send_template":
      return { template_name: "", language: "en_US" }
    case "send_button":
      return { text: "", buttons: [] }
    case "send_media":
      return { media_type: "image", media_url: "", caption: "", filename: "" }
    case "add_tag":
    case "remove_tag":
      return { tag_id: "" }
    case "assign_conversation":
      return { mode: "round_robin" }
    case "update_contact_field":
      return { field: "name", value: "" }
    case "create_deal":
      return { pipeline_id: "", stage_id: "", title: "", value: 0 }
    case "update_deal":
      return { deal_id: "", pipeline_id: "", stage_id: "", status: "", value: undefined, create_if_missing: false, title: "" }
    case "calendar_update_status":
      return { status: "scheduled", event_id: "" }
    case "wait":
      return { amount: 1, unit: "hours" }
    case "condition":
      return { subject: "tag_presence", operand: "", value: "" }
    case "send_webhook":
      return { url: "", headers: {}, body_template: "" }
    case "close_conversation":
      return {}
    case "ai_condition":
      return { prompt: "" }
    case "ai_reply":
      return { prompt: "" }
    case "ai_extract":
      return { prompt: "", fields: [] }
    case "ai_classify":
      return { prompt: "", labels: [], store_var: "classification", fallback: "" }
    default:
      return {}
  }
}

// ------------------------------------------------------------
// Account resources (tags, members, approved templates, pipelines)
//
// Loaded once at the builder root and shared via context so the
// tag / agent / template pickers below can offer existing resources
// by name instead of asking the user to paste raw UUIDs. Every picker
// falls back to a raw input when its list is empty (fresh account or
// an older deployment), so an automation is always authorable.
// ------------------------------------------------------------

interface AutomationResources {
  tags: TagRecord[]
  members: AccountMember[]
  templates: MessageTemplate[]
  customFields: CustomField[]
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
}

interface PipelineOption {
  id: string
  name: string
}

interface PipelineStageOption {
  id: string
  name: string
  pipeline_id: string
  position: number
}

const ResourcesContext = createContext<AutomationResources>({
  tags: [],
  members: [],
  templates: [],
  customFields: [],
  pipelines: [],
  stages: [],
})

function useResources(): AutomationResources {
  return useContext(ResourcesContext)
}

function ResourcesProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<TagRecord[]>([])
  const [members, setMembers] = useState<AccountMember[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [pipelines, setPipelines] = useState<PipelineOption[]>([])
  const [stages, setStages] = useState<PipelineStageOption[]>([])

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    // Tags, templates and custom fields come straight from the DB — RLS
    // scopes them to the caller's account. Only APPROVED templates can
    // actually be sent (anything else 400s at send time), matching the
    // broadcast picker.
    void (async () => {
      const [tagsRes, templatesRes, customFieldsRes, pipelinesRes, stagesRes] =
        await Promise.all([
          supabase.from("tags").select("*").order("name"),
          supabase
            .from("message_templates")
            .select("*")
            .eq("status", "APPROVED")
            .order("name"),
          supabase.from("custom_fields").select("*").order("field_name"),
          supabase.from("pipelines").select("id, name").order("name"),
          supabase
            .from("pipeline_stages")
            .select("id, name, pipeline_id, position")
            .order("position"),
        ])
      if (cancelled) return
      setTags((tagsRes.data as TagRecord[] | null) ?? [])
      setTemplates((templatesRes.data as MessageTemplate[] | null) ?? [])
      setCustomFields((customFieldsRes.data as CustomField[] | null) ?? [])
      setPipelines((pipelinesRes.data as PipelineOption[] | null) ?? [])
      setStages((stagesRes.data as PipelineStageOption[] | null) ?? [])
    })()

    // Members go through the API so we inherit its email-visibility
    // rules (agents/viewers don't see emails). Unreachable on older
    // deployments → pickers fall back to a raw agent-id input.
    void (async () => {
      try {
        const res = await fetch("/api/account/members", { cache: "no-store" })
        if (!res.ok) return
        const json = (await res.json()) as { members?: AccountMember[] }
        if (!cancelled) setMembers(json.members ?? [])
      } catch {
        // Members endpoint absent — caller falls back to raw input.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ResourcesContext.Provider
      value={{ tags, members, templates, customFields, pipelines, stages }}
    >
      {children}
    </ResourcesContext.Provider>
  )
}

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"

/** Tag dropdown by name + color, storing the tag's id. Falls back to a
 *  raw id input when no tags exist yet. */
function TagSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { tags } = useResources()
  const { t } = useLanguage()
  if (tags.length === 0) {
    return (
      <Input
        placeholder={t("automations.tagIdPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = tags.find((tg) => tg.id === value)
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-3 w-3 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: selected?.color ?? "transparent" }}
        aria-hidden
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">{t("automations.selectTag")}</option>
        {tags.map((tg) => (
          <option key={tg.id} value={tg.id}>
            {tg.name}
          </option>
        ))}
        {/* Preserve a saved tag that's since been deleted so editing an
            existing automation doesn't silently drop it. */}
        {value && !selected && (
          <option value={value}>{value} {t("automations.unknownTag")}</option>
        )}
      </select>
    </div>
  )
}

/** Contact-field dropdown for "Update Contact Field": built-in columns plus
 *  any account custom fields (stored as `custom:<id>`). A saved custom field
 *  that's since been deleted is preserved as a labelled option so editing an
 *  existing automation doesn't silently drop it. */
function ContactFieldSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { customFields } = useResources()
  const { t } = useLanguage()
  const customValue = value.startsWith("custom:") ? value : ""
  const knownCustom =
    customValue && customFields.some((f) => `custom:${f.id}` === customValue)
  return (
    <select
      value={value || "name"}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="name">{t("contacts.name")}</option>
      <option value="email">{t("contacts.email")}</option>
      <option value="company">{t("contacts.company")}</option>
      {customFields.length > 0 && (
        <optgroup label={t("automations.customFieldsGroup")}>
          {customFields.map((f) => (
            <option key={f.id} value={`custom:${f.id}`}>
              {f.field_name}
            </option>
          ))}
        </optgroup>
      )}
      {customValue && !knownCustom && (
        <option value={customValue}>{customValue} {t("automations.unknownField")}</option>
      )}
    </select>
  )
}

/** Agent dropdown by name, storing the member's user_id. Falls back to
 *  a raw id input when the member list is unavailable. */
function AgentSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { members } = useResources()
  const { t } = useLanguage()
  if (members.length === 0) {
    return (
      <Input
        placeholder={t("automations.agentIdPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    )
  }
  const selected = members.find((m) => m.user_id === value)
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      <option value="">{t("automations.selectAgent")}</option>
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.full_name || m.email || m.user_id}
        </option>
      ))}
      {value && !selected && (
        <option value={value}>{value} {t("automations.unknownAgent")}</option>
      )}
    </select>
  )
}

/** Pipeline + stage picker for Create Deal. The automation stores ids because
 *  the engine writes directly to deals, but authors should choose by name. */
function DealPipelineFields({
  pipelineId,
  stageId,
  onChange,
}: {
  pipelineId: string
  stageId: string
  onChange: (patch: { pipeline_id: string; stage_id: string }) => void
}) {
  const { pipelines, stages } = useResources()
  const { t } = useLanguage()

  if (pipelines.length === 0) {
    return (
      <>
        <FieldBlock label={t("automations.pipelineIdLabel")}>
          <Input
            value={pipelineId}
            onChange={(e) =>
              onChange({ pipeline_id: e.target.value, stage_id: stageId })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t("automations.stageIdLabel")}>
          <Input
            value={stageId}
            onChange={(e) =>
              onChange({ pipeline_id: pipelineId, stage_id: e.target.value })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    )
  }

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId)
  const stageOptions = stages.filter((s) => s.pipeline_id === pipelineId)
  const selectedStage = stageOptions.find((s) => s.id === stageId)

  return (
    <>
      <FieldBlock label={t("automations.pipeline")}>
        <select
          value={pipelineId}
          onChange={(e) => {
            const nextPipelineId = e.target.value
            const firstStage = stages.find(
              (s) => s.pipeline_id === nextPipelineId
            )
            onChange({
              pipeline_id: nextPipelineId,
              stage_id: firstStage?.id ?? "",
            })
          }}
          className={SELECT_CLASS}
        >
          <option value="">{t("automations.selectPipeline")}</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {pipelineId && !selectedPipeline && (
            <option value={pipelineId}>{pipelineId} {t("automations.unknownPipeline")}</option>
          )}
        </select>
      </FieldBlock>
      <FieldBlock label={t("automations.stage")}>
        <select
          value={stageId}
          onChange={(e) =>
            onChange({ pipeline_id: pipelineId, stage_id: e.target.value })
          }
          className={SELECT_CLASS}
          disabled={!pipelineId || stageOptions.length === 0}
        >
          <option value="">
            {pipelineId ? t("automations.selectStage") : t("automations.selectPipelineFirst")}
          </option>
          {stageOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {stageId && pipelineId && !selectedStage && (
            <option value={stageId}>{stageId} {t("automations.unknownStage")}</option>
          )}
        </select>
      </FieldBlock>
    </>
  )
}

/** Template dropdown showing approved templates by name + language,
 *  storing both template_name and language. Falls back to manual name +
 *  language inputs when no approved templates are synced yet. */
function SendTemplateFields({
  templateName,
  language,
  onChange,
}: {
  templateName: string
  language: string
  onChange: (patch: { template_name: string; language: string }) => void
}) {
  const { templates } = useResources()
  const { t } = useLanguage()

  if (templates.length === 0) {
    return (
      <>
        <FieldBlock label={t("automations.templateNameLabel")}>
          <Input
            value={templateName}
            onChange={(e) =>
              onChange({ template_name: e.target.value, language })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t("templates.languageLabel")}>
          <Input
            value={language}
            onChange={(e) =>
              onChange({ template_name: templateName, language: e.target.value })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    )
  }

  // Encode name + language in the option value so two templates that
  // share a name across languages stay distinct.
  const toValue = (name: string, lang: string) => `${name}::${lang}`
  const current = templateName ? toValue(templateName, language) : ""
  const hasMatch = templates.some(
    (tpl) => toValue(tpl.name, tpl.language ?? "en_US") === current,
  )

  return (
    <FieldBlock label={t("broadcastNew.template")}>
      <select
        value={current}
        onChange={(e) => {
          const [name, lang] = e.target.value.split("::")
          onChange({ template_name: name ?? "", language: lang ?? "" })
        }}
        className={SELECT_CLASS}
      >
        <option value="">{t("automations.selectTemplate")}</option>
        {templates.map((tpl) => {
          const lang = tpl.language ?? "en_US"
          return (
            <option key={tpl.id} value={toValue(tpl.name, lang)}>
              {tpl.name} ({lang})
            </option>
          )
        })}
        {current && !hasMatch && (
          <option value={current}>
            {templateName} ({language || t("automations.unknownLowercase")}){" "}
            {t("automations.notInApprovedList")}
          </option>
        )}
      </select>
    </FieldBlock>
  )
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter()
  const { t } = useLanguage()
  const isEditing = !!initial.id
  const [state, setState] = useState<BuilderInitial>(initial)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Canvas zoom — persisted per browser. CSS `zoom` (not transform) keeps
  // native scrolling/layout so the flow stays navigable at any scale.
  const [zoom, setZoomState] = useState(1)

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("wacrm-builder-zoom"))
      if (!Number.isNaN(saved) && saved >= 0.5 && saved <= 1.5) setZoomState(saved)
    } catch {
      /* ignore */
    }
  }, [])

  const setZoom = (z: number) => {
    setZoomState(z)
    try { localStorage.setItem("wacrm-builder-zoom", String(z)) } catch {}
  }

  function patchTop<K extends keyof BuilderInitial>(key: K, value: BuilderInitial[K]) {
    setState((s) => ({ ...s, [key]: value }))
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(path: StepPath, updater: (s: BuilderStep) => BuilderStep) {
    setState((s) => ({ ...s, steps: mapAtPath(s.steps, path, updater) }))
  }

  function addStepAt(parent: ParentScope, index: number, type: AutomationStepType) {
    const node: BuilderStep = {
      cid: cid(),
      step_type: type,
      step_config: blankConfig(type),
      branches: type === "condition" ? { yes: [], no: [] } : undefined,
    }
    setState((s) => ({ ...s, steps: insertAt(s.steps, parent, index, node) }))
    setExpandedId(node.cid)
  }

  function deleteStepAt(path: StepPath) {
    setState((s) => ({ ...s, steps: removeAt(s.steps, path) }))
  }

  function moveStepAt(path: StepPath, direction: -1 | 1) {
    setState((s) => ({ ...s, steps: moveAt(s.steps, path, direction) }))
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        name: state.name || t("automations.untitled"),
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config: state.trigger_config,
        is_active: state.is_active,
        steps: toApiSteps(state.steps),
        ...(state.channel !== undefined && { channel: state.channel }),
        ...(state.provider !== undefined && { provider: state.provider }),
      }

      const res = isEditing
        ? await fetch(`/api/automations/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/automations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // If the server blocked activation with validation issues,
        // surface the first concrete problem so the user can fix it
        // without opening DevTools for the full array.
        const firstIssue: { path?: string; message?: string } | undefined =
          body?.issues?.[0]
        if (firstIssue?.message) {
          toast.error(firstIssue.message, {
            description: firstIssue.path
              ? `${t("automations.issueAtPath")} ${firstIssue.path}`
              : undefined,
          })
        } else {
          toast.error(body?.error ?? t("automations.saveFailed"))
        }
        return
      }
      toast.success(isEditing ? t("automations.toastSaved") : t("automations.toastCreated"))
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automations/${body.automation.id}/edit`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => router.push("/automations")}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("automations.backToAutomations")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={state.name}
          onChange={(e) => patchTop("name", e.target.value)}
          placeholder={t("automations.untitled")}
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:bg-muted focus:outline-none sm:text-base"
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{t("automations.active")}</span>
          <Switch
            checked={state.is_active}
            onCheckedChange={(v) => patchTop("is_active", !!v)}
            aria-label={t("automations.active")}
          />
        </div>
        <Button
          onClick={save}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditing ? t("automations.save") : t("automations.saveDraft")}
        </Button>
      </header>

      {/* Canvas */}
      <div className="relative flex-1 overflow-auto">
        <div className="absolute inset-0 bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none" />

        {/* Floating zoom controls — deep flows (nested conditions) get
            unwieldy at 100%; zoom out to see the whole tree at a glance. */}
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => setZoom(Math.max(0.5, Number((zoom - 0.1).toFixed(2))))}
            disabled={zoom <= 0.5}
            aria-label={t("automations.zoomOut")}
            title={t("automations.zoomOut")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              try { localStorage.setItem("wacrm-builder-zoom", "1"); } catch {}
            }}
            title={t("automations.zoomResetTitle")}
            aria-label={t("automations.zoomReset")}
            className="min-w-12 rounded-md px-1 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom(Math.min(1.5, Number((zoom + 0.1).toFixed(2))))}
            disabled={zoom >= 1.5}
            aria-label={t("automations.zoomIn")}
            title={t("automations.zoomIn")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>

        <div
          className="relative mx-auto flex w-full max-w-2xl flex-col items-center gap-0 px-4 py-10"
          style={{
            zoom,
            // Zoomed out → widen the flow so the whole tree uses the freed
            // space instead of shrinking inside the narrow column.
            ...(zoom < 1
              ? { maxWidth: `${Math.min(220, Math.round(100 / zoom))}%` }
              : null),
          }}
        >
          <ResourcesProvider>
            <TriggerCard
              type={state.trigger_type}
              config={state.trigger_config}
              channel={state.channel}
              provider={state.provider}
              onTypeChange={(t) => patchTop("trigger_type", t)}
              onConfigChange={(c) => patchTop("trigger_config", c)}
              onChannelChange={(ch) => patchTop("channel", ch)}
              onProviderChange={(p) => patchTop("provider", p)}
            />
            <StepList
              steps={state.steps}
              parentPath={[]}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              updateStep={updateStep}
              addStepAt={addStepAt}
              deleteStepAt={deleteStepAt}
              moveStepAt={moveStepAt}
              channel={state.channel}
            />
          </ResourcesProvider>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Trigger card
// ------------------------------------------------------------

function TriggerCard({
  type,
  config,
  channel,
  provider,
  onTypeChange,
  onConfigChange,
  onChannelChange,
  onProviderChange,
}: {
  type: AutomationTriggerType
  config: Record<string, unknown>
  channel?: 'whatsapp' | 'instagram' | null
  provider?: 'meta' | 'ryzeapi' | 'zernio' | 'evolution' | null
  onTypeChange: (t: AutomationTriggerType) => void
  onConfigChange: (c: Record<string, unknown>) => void
  onChannelChange: (ch: 'whatsapp' | 'instagram' | null) => void
  onProviderChange: (p: 'meta' | 'ryzeapi' | 'zernio' | 'evolution' | null) => void
}) {
  const [open, setOpen] = useState(false)
  const { t } = useLanguage()
  return (
    // Card width: full on mobile, fixed 320px on sm+. The canvas wrapper
    // (max-w-2xl + px-4) keeps this tidy on tablet/desktop.
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      <div className="rounded-lg border border-border border-l-4 border-l-blue-500 bg-card shadow-lg">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-400">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-blue-300">{t("automations.triggerHeading")}</div>
            <div className="truncate text-sm font-medium text-foreground">
              {(() => {
                const opt = TRIGGER_OPTIONS.find((o) => o.value === type)
                return opt ? t(opt.labelKey) : type
              })()}
            </div>
          </div>
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <div className="space-y-3 border-t border-border px-4 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("automations.triggerType")}
              </label>
              <select
                value={type}
                onChange={(e) => onTypeChange(e.target.value as AutomationTriggerType)}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {TRIGGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {(() => {
                  const opt = TRIGGER_OPTIONS.find((o) => o.value === type)
                  return opt ? t(opt.hintKey) : null
                })()}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("automations.channel")}
              </label>
              <select
                value={channel ?? ''}
                onChange={(e) => onChannelChange((e.target.value || null) as 'whatsapp' | 'instagram' | null)}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="">{t("flows.builder.channelBoth")}</option>
                <option value="whatsapp">{t("flows.builder.channelWhatsapp")}</option>
                <option value="instagram">{t("flows.builder.channelInstagram")}</option>
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("automations.channelHint")}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("automations.provider")}
              </label>
              <select
                value={provider ?? ''}
                onChange={(e) => onProviderChange((e.target.value || null) as 'meta' | 'ryzeapi' | 'zernio' | 'evolution' | null)}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="">{t("automations.providerAll")}</option>
                <option value="zernio">{t("automations.providerZernio")}</option>
                <option value="ryzeapi">{t("automations.providerRyzeapiOnly")}</option>
                <option value="evolution">{t("automations.providerEvolutionOnly")}</option>
                <option value="meta">{t("automations.providerMetaOnly")}</option>
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("automations.providerHint")}
              </p>
            </div>
            {type === "keyword_match" && (
              <KeywordMatchConfig
                config={config as unknown as KeywordMatchTriggerConfig}
                channel={channel}
                onChange={onConfigChange}
              />
            )}
            {type === "tag_added" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t("automations.tag")}
                </label>
                <TagSelect
                  value={(config.tag_id as string) ?? ""}
                  onChange={(v) => onConfigChange({ ...config, tag_id: v })}
                />
              </div>
            )}
            {type === "time_based" && (
              <TimeBasedConfig
                config={config as unknown as Record<string, unknown>}
                onChange={onConfigChange}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function KeywordMatchConfig({
  config,
  channel,
  onChange,
}: {
  config: KeywordMatchTriggerConfig
  channel?: 'whatsapp' | 'instagram' | null
  onChange: (c: Record<string, unknown>) => void
}) {
  const keywords = config?.keywords ?? []
  const { t } = useLanguage()
  const [draft, setDraft] = useState(keywords.join(", "))
  const [posts, setPosts] = useState<{ id: string; content: string }[]>([])
  const [postsLoading, setPostsLoading] = useState(false)
  const selectedPostId = config?.instagram_media_ids?.[0] ?? ""

  useEffect(() => {
    if (config?.match_type == null) {
      onChange({ ...config, match_type: "contains" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (channel !== 'instagram') return
    setPostsLoading(true)
    fetch('/api/zernio/posts?platform=instagram')
      .then((r) => r.json())
      .then((json) => setPosts(json.data ?? []))
      .catch(() => setPosts([]))
      .finally(() => setPostsLoading(false))
  }, [channel])

  function commit() {
    const parsed = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    setDraft(parsed.join(", "))
    onChange({ ...config, keywords: parsed })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("flows.builder.keywordsLabel")}
        </label>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
          }}
          placeholder={t("automations.keywordsPlaceholder")}
          className="bg-muted text-foreground"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("automations.matchType")}
        </label>
        <select
          value={config?.match_type ?? "contains"}
          onChange={(e) => onChange({ ...config, match_type: e.target.value as "exact" | "contains" })}
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"
        >
          <option value="contains">{t("automations.matchContains")}</option>
          <option value="exact">{t("automations.matchExact")}</option>
        </select>
      </div>
      {channel === 'instagram' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("flows.builder.scopeToPost")}
          </label>
          <select
            value={selectedPostId}
            onChange={(e) => {
              const val = e.target.value
              onChange({ ...config, instagram_media_ids: val ? [val] : undefined })
            }}
            disabled={postsLoading}
            className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none disabled:opacity-50"
          >
            <option value="">{t("flows.builder.anyPost")}</option>
            {posts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.content.substring(0, 80)}{p.content.length > 80 ? '...' : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {postsLoading
              ? t('flows.builder.loadingPosts')
              : posts.length === 0
                ? t('automations.noPostsFound')
                : t('flows.builder.scopeHint')}
          </p>
        </div>
      )}

    </div>
  )
}

// ------------------------------------------------------------
// Time-based trigger config — schedule + targeting
// ------------------------------------------------------------

function TimeBasedConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const tagIds = (config.tag_ids as string[]) ?? []
  const pipelineId = (config.pipeline_id as string) ?? ''
  const stageId = (config.stage_id as string) ?? ''
  const dealStatus = (config.deal_status as string) ?? 'open'
  const targetMode = (config.target_mode as string) ?? (pipelineId ? 'pipeline' : 'tags')
  const { tags, pipelines, stages } = useResources()
  const { t } = useLanguage()

  const stageOptions = stages.filter((s) => s.pipeline_id === pipelineId)

  return (
    <div className="space-y-4">
      {/* Schedule */}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("automations.scheduleLabel")}
        </label>
        <Input
          placeholder={t("automations.schedulePlaceholder")}
          value={(config.schedule as string) ?? ""}
          onChange={(e) =>
            onChange({ ...config, schedule: e.target.value })
          }
          className="bg-muted text-foreground"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("automations.scheduleHelp")}
        </p>
      </div>

      {/* Timezone */}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("automations.timezone")}
        </label>
        <select
          value={(config.timezone as string) ?? ''}
          onChange={(e) => onChange({ ...config, timezone: e.target.value || undefined })}
          className={SELECT_CLASS}
        >
          <option value="">{t("automations.utcOption")}</option>
          <option value="America/Sao_Paulo">America/Sao_Paulo (Brasília)</option>
          <option value="America/Argentina/Buenos_Aires">America/Argentina/Buenos_Aires</option>
          <option value="America/Mexico_City">America/Mexico_City</option>
          <option value="America/New_York">America/New_York (Eastern)</option>
          <option value="America/Los_Angeles">America/Los_Angeles (Pacific)</option>
          <option value="Europe/London">Europe/London</option>
          <option value="Europe/Paris">Europe/Paris</option>
          <option value="Europe/Lisbon">Europe/Lisbon</option>
          <option value="Asia/Dubai">Asia/Dubai</option>
          <option value="Asia/Tokyo">Asia/Tokyo</option>
          <option value="Australia/Sydney">Australia/Sydney</option>
        </select>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("automations.timezoneHelp")}
        </p>
      </div>

      {/* Target mode */}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("automations.targetBy")}
        </label>
        <select
          value={targetMode}
          onChange={(e) => onChange({ ...config, target_mode: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="tags">{t("automations.targetTags")}</option>
          <option value="pipeline">{t("automations.targetPipeline")}</option>
          <option value="both">{t("automations.targetBoth")}</option>
        </select>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {targetMode === 'both'
            ? t('automations.targetHelpBoth')
            : targetMode === 'pipeline'
            ? t('automations.targetHelpPipeline')
            : t('automations.targetHelpTags')}
        </p>
      </div>

      {/* Tag selector */}
      {(targetMode === 'tags' || targetMode === 'both') && (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("automations.tag")}
          </label>
          <MultiTagSelect tagIds={tagIds} tags={tags} onChange={(ids) => onChange({ ...config, tag_ids: ids })} />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("automations.tagsHelp")}
          </p>
        </div>
      )}

      {/* Pipeline selector */}
      {(targetMode === 'pipeline' || targetMode === 'both') && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t("automations.pipeline")}
            </label>
            {pipelines.length === 0 ? (
              <Input placeholder={t("automations.pipelineIdPlaceholder")} value={pipelineId} onChange={(e) => onChange({ ...config, pipeline_id: e.target.value })} className="bg-muted text-foreground" />
            ) : (
              <select
                value={pipelineId}
                onChange={(e) => {
                  const nextStageId = stages.find((s) => s.pipeline_id === e.target.value)?.id ?? ''
                  onChange({ ...config, pipeline_id: e.target.value, stage_id: nextStageId })
                }}
                className={SELECT_CLASS}
              >
                <option value="">{t("automations.selectPipeline")}</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
          {pipelineId && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("automations.stage")}
              </label>
              <select
                value={stageId}
                onChange={(e) => onChange({ ...config, stage_id: e.target.value })}
                className={SELECT_CLASS}
                disabled={stageOptions.length === 0}
              >
                <option value="">{t("automations.anyStage")}</option>
                {stageOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t("automations.dealStatus")}
            </label>
            <select
              value={dealStatus}
              onChange={(e) => onChange({ ...config, deal_status: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="open">{t("automations.statusOpen")}</option>
              <option value="won">{t("automations.statusWon")}</option>
              <option value="lost">{t("automations.statusLost")}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {t("automations.inactiveDays")}
            </label>
            <Input
              type="number"
              min={0}
              placeholder={t("automations.inactiveDaysPlaceholder")}
              value={(config.deal_inactivity_days as number) ?? 0}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                onChange({
                  ...config,
                  deal_inactivity_days: Number.isFinite(n) && n > 0 ? n : undefined,
                })
              }}
              className="bg-muted text-foreground"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("automations.inactiveDaysHelp")}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Multi-tag selector — renders a compact list of selected tags with
 * an "Add" button that opens a dropdown. Supports multiple tags unlike
 * the single-tag TagSelect used in the tag_added trigger.
 */
function MultiTagSelect({
  tagIds,
  tags: allTags,
  onChange,
}: {
  tagIds: string[]
  tags: AutomationTagItem[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const { t } = useLanguage()
  const selected = allTags.filter((tg) => tagIds.includes(tg.id))

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          SELECT_CLASS,
          'flex w-full items-center gap-1.5 text-left',
          selected.length === 0 && 'text-muted-foreground',
        )}
      >
        {selected.length === 0 ? (
          t('automations.selectTags')
        ) : (
          <div className="flex flex-wrap gap-1">
            {selected.map((tg) => (
              <span
                key={tg.id}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-white"
                style={{ backgroundColor: tg.color ?? '#3b82f6' }}
              >
                {tg.name}
                <X
                  className="h-3 w-3 cursor-pointer hover:opacity-70"
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(tagIds.filter((id) => id !== tg.id))
                  }}
                />
              </span>
            ))}
          </div>
        )}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
          {allTags.map((tg) => {
            const isChecked = tagIds.includes(tg.id)
            return (
              <label
                key={tg.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {
                    onChange(
                      isChecked
                        ? tagIds.filter((id) => id !== tg.id)
                        : [...tagIds, tg.id],
                    )
                  }}
                />
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: tg.color ?? 'transparent' }}
                />
                {tg.name}
              </label>
            )
          })}
          {allTags.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t('automations.noTagsAvailable')}</p>
          )}
        </div>
      )}
    </div>
  )
}

interface AutomationTagItem {
  id: string
  name: string
  color?: string
}

// ------------------------------------------------------------
// Step list + card + connectors
// ------------------------------------------------------------

type ParentScope =
  | { kind: "root" }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no" }

type StepPath = (
  | { kind: "root"; index: number }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no"; index: number }
)[]

interface StepListProps {
  steps: BuilderStep[]
  parentPath: StepPath
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  updateStep: (path: StepPath, updater: (s: BuilderStep) => BuilderStep) => void
  addStepAt: (parent: ParentScope, index: number, type: AutomationStepType) => void
  deleteStepAt: (path: StepPath) => void
  moveStepAt: (path: StepPath, direction: -1 | 1) => void
  channel?: 'whatsapp' | 'instagram' | null
}

function StepList(props: StepListProps) {
  const { steps, parentPath, ...rest } = props
  const parentScope: ParentScope =
    parentPath.length === 0
      ? { kind: "root" }
      : (() => {
          const last = parentPath[parentPath.length - 1]
          if (last.kind !== "branch") return { kind: "root" } as const
          return { kind: "branch", parentCid: last.parentCid, branch: last.branch } as const
        })()

  return (
    <div className="flex flex-col items-center">
      <AddButton onPick={(t) => props.addStepAt(parentScope, 0, t)} />
      {steps.map((step, idx) => (
        <StepRenderer
          key={step.cid}
          step={step}
          index={idx}
          total={steps.length}
          parentScope={parentScope}
          parentPath={parentPath}
          {...rest}
        />
      ))}
    </div>
  )
}

function StepRenderer({
  step,
  index,
  total,
  parentScope,
  parentPath,
  channel,
  ...props
}: {
  step: BuilderStep
  index: number
  total: number
  parentScope: ParentScope
  parentPath: StepPath
  channel?: 'whatsapp' | 'instagram' | null
} & Omit<StepListProps, "steps" | "parentPath" | "channel">) {
  const { t } = useLanguage()
  // Path resolution. For branch children, ConditionBranches already
  // appended a branch marker (with placeholder index 0) to parentPath —
  // REPLACE its index with this step's real position instead of adding
  // another marker. Appending would double the marker and make every
  // mutation resolve to a nonexistent node (edits silently dropped).
  const path: StepPath =
    parentScope.kind === "root"
      ? [{ kind: "root", index }]
      : [
          ...parentPath.slice(0, -1),
          {
            kind: "branch",
            parentCid: parentScope.parentCid,
            branch: parentScope.branch,
            index,
          },
        ]
  const meta = STEP_META[step.step_type]
  const Icon = meta.icon
  const expanded = props.expandedId === step.cid
  const isCondition = step.step_type === "condition"
  // Card widths on mobile fill the full canvas column (max-w-2xl px-4
  // still keeps them reasonable). On sm+ the original fixed widths
  // come back so the flow visual stays recognisable.
  const width = isCondition
    ? "w-full max-w-[400px] sm:w-[400px]"
    : "w-full max-w-[320px] sm:w-80"

  return (
    <>
      <div className={cn("z-10 flex flex-col", width)}>
        <div
          className={cn(
            "rounded-lg border border-border border-l-4 bg-card shadow-lg",
            meta.border,
          )}
        >
          <button
            type="button"
            onClick={() => props.setExpandedId(expanded ? null : step.cid)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
          >
            <GripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {isCondition ? t("automations.kindCondition") : step.step_type === "wait" ? t("automations.kindWait") : t("automations.kindAction")}
              </div>
              <div className="truncate text-sm font-medium text-foreground">{t(meta.labelKey)}</div>
              <div className="truncate text-[11px] text-muted-foreground">{previewFor(step, t)}</div>
            </div>
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")}
            />
          </button>
          {expanded && (
            <div className="border-t border-border px-4 py-3">
              <StepEditor
                step={step}
                channel={channel}
                onChange={(next) => props.updateStep(path, () => next)}
              />
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    aria-label={t("automations.moveUp")}
                    onClick={() => props.moveStepAt(path, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === total - 1}
                    aria-label={t("automations.moveDown")}
                    onClick={() => props.moveStepAt(path, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => props.deleteStepAt(path)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("automations.delete")}
                </Button>
              </div>
            </div>
          )}
        </div>
        {isCondition && (
          <ConditionBranches step={step} parentPath={path} {...props} />
        )}
      </div>

      {/* Conditions branch into Yes/No (rendered above by
          ConditionBranches) but execution MERGES back to the linear path
          afterwards — so the trailing + appends at this level. Without it,
          an automation ending in a condition is a dead end. */}
      <AddButton onPick={(t) => props.addStepAt(parentScope, index + 1, t)} />
    </>
  )
}

function ConditionBranches({
  step,
  parentPath,
  ...props
}: {
  step: BuilderStep
  parentPath: StepPath
} & Omit<StepListProps, "steps" | "parentPath">) {
  const yes = step.branches?.yes ?? []
  const no = step.branches?.no ?? []
  const { t } = useLanguage()
  // Build the child scope by appending a branch marker. The scope the
  // StepList uses is driven by the LAST element of parentPath, so the
  // tail's `index` doesn't matter — it's replaced per child during walks.
  const yesPath: StepPath = [
    ...parentPath,
    { kind: "branch", parentCid: step.cid, branch: "yes", index: 0 },
  ]
  const noPath: StepPath = [
    ...parentPath,
    { kind: "branch", parentCid: step.cid, branch: "no", index: 0 },
  ]
  return (
    // Stack Yes/No vertically on mobile — two columns at 375px would
    // cram each branch to ~170px which is too narrow for the nested
    // cards. Two-column grid returns on sm+.
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <BranchColumn label={t("automations.yes")} color="text-primary">
        <StepList {...props} steps={yes} parentPath={yesPath} />
      </BranchColumn>
      <BranchColumn label={t("automations.no")} color="text-rose-400">
        <StepList {...props} steps={no} parentPath={noPath} />
      </BranchColumn>
    </div>
  )
}

function BranchColumn({
  label,
  color,
  children,
}: {
  label: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center">
      <div className={cn("mb-2 text-[11px] font-semibold uppercase", color)}>{label}</div>
      {children}
    </div>
  )
}

function AddButton({ onPick }: { onPick: (t: AutomationStepType) => void }) {
  const { t } = useLanguage()
  return (
    <div className="relative flex flex-col items-center">
      <div className="h-4 w-[2px] bg-border" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary data-[popup-open]:border-primary data-[popup-open]:bg-primary/20 data-[popup-open]:text-primary"
          aria-label={t("automations.addStep")}
        >
          <Plus className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-56 overflow-y-auto border-border bg-popover"
        >
          {ADDABLE_STEPS.map((type) => {
            const Icon = STEP_META[type].icon
            return (
              <DropdownMenuItem key={type} onClick={() => onPick(type)}>
                <Icon className="h-4 w-4" />
                {t(STEP_META[type].labelKey)}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="h-4 w-[2px] bg-border" aria-hidden />
    </div>
  )
}

// ------------------------------------------------------------
// SendButtonFields — config editor for send_button step
// ------------------------------------------------------------

interface ButtonField {
  type: "postback" | "url"
  title: string
  payload?: string
  url?: string
}

function SendButtonFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
}) {
  const buttons = (cfg.buttons as ButtonField[]) ?? []
  const { t } = useLanguage()

  return (
    <>
      <FieldBlock label={t("automations.messageText")}>
        <Textarea
          value={(cfg.text as string) ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder={t("automations.messageTextPlaceholder")}
          className="min-h-20 bg-muted text-foreground"
        />
      </FieldBlock>

      <FieldBlock label={`${t("automations.buttons")} (${buttons.length}/3)`}>
        <div className="space-y-2">
          {buttons.map((btn, i) => (
            <div
              key={i}
              className="rounded-md border border-border bg-muted p-2 space-y-2"
            >
              <div className="flex items-center gap-2">
                <select
                  value={btn.type ?? "postback"}
                  onChange={(e) => {
                    const next = [...buttons]
                    next[i] = { ...next[i], type: e.target.value as "postback" | "url" }
                    onChange({ buttons: next })
                  }}
                  className="w-24 rounded border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value="postback">{t("automations.buttonPostback")}</option>
                  <option value="url">{t("automations.buttonUrl")}</option>
                </select>
                <input
                  value={btn.title ?? ""}
                  onChange={(e) => {
                    const next = [...buttons]
                    next[i] = { ...next[i], title: e.target.value }
                    onChange({ buttons: next })
                  }}
                  placeholder={t("automations.buttonTitlePlaceholder")}
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                  maxLength={20}
                />
                <button
                  type="button"
                  onClick={() => {
                    const next = buttons.filter((_, j) => j !== i)
                    onChange({ buttons: next })
                  }}
                  className="text-destructive hover:text-destructive/80 p-1 flex-shrink-0"
                  aria-label={t("automations.removeButton")}
                >
                  <X size={14} />
                </button>
              </div>
              {btn.type === "url" ? (
                <input
                  value={btn.url ?? ""}
                  onChange={(e) => {
                    const next = [...buttons]
                    next[i] = { ...next[i], url: e.target.value }
                    onChange({ buttons: next })
                  }}
                  placeholder="https://..."
                  className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                />
              ) : (
                <input
                  value={btn.payload ?? ""}
                  onChange={(e) => {
                    const next = [...buttons]
                    next[i] = { ...next[i], payload: e.target.value }
                    onChange({ buttons: next })
                  }}
                  placeholder={t("automations.payloadPlaceholder")}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                />
              )}
            </div>
          ))}
          {buttons.length < 3 && (
            <button
              type="button"
              onClick={() => {
                onChange({
                  buttons: [
                    ...buttons,
                    { type: "postback", title: "", payload: "" },
                  ],
                })
              }}
              className="w-full rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              + {t("automations.addButton")}
            </button>
          )}
        </div>
      </FieldBlock>
    </>
  )
}

// ------------------------------------------------------------
// Per-step config editor
// ------------------------------------------------------------

/** Tag picker for the condition step — lists the account's real tags
 *  so users never have to paste a raw tag id. */
function ConditionTagSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [tags, setTags] = useState<TagRecord[]>([])
  const [loading, setLoading] = useState(true)
  const { t } = useLanguage()

  useEffect(() => {
    let cancelled = false
    void createClient()
      .from("tags")
      .select("id, name")
      .order("name")
      .then(({ data }) => {
        if (!cancelled) {
          setTags((data ?? []) as TagRecord[])
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return <div className="h-9 animate-pulse rounded-md bg-muted" />
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
    >
      <option value="">
        {tags.length > 0 ? t("automations.selectTag") : t("automations.noTagsCreateInContacts")}
      </option>
      {tags.map((tg) => (
        <option key={tg.id} value={tg.id}>
          {tg.name}
        </option>
      ))}
    </select>
  )
}

function StepEditor({
  step,
  channel,
  onChange,
}: {
  step: BuilderStep
  channel?: 'whatsapp' | 'instagram' | null
  onChange: (s: BuilderStep) => void
}) {
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const { t } = useLanguage()
  const cfg = step.step_config
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } })

  switch (step.step_type) {
    case "send_message":
      return (
        <>
          <FieldBlock label={t("automations.messageText")}>
            <Textarea
              value={(cfg.text as string) ?? ""}
              onChange={(e) => set({ text: e.target.value })}
              placeholder={t("automations.sendMessagePlaceholder")}
              className="min-h-24 bg-muted text-foreground"
            />
          </FieldBlock>
          {channel === 'instagram' && (
            <FieldBlock label={t("flows.replyMode")}>
              <select
                value={(cfg.reply_mode as string) ?? "public"}
                onChange={(e) => set({ reply_mode: e.target.value })}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
              >
                <option value="public">{t("flows.replyModePublic")}</option>
                <option value="dm">{t("flows.replyModeDm")}</option>
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("flows.replyModeHelp")}
              </p>
            </FieldBlock>
          )}
        </>
      )
    case "send_template":
      return (
        <SendTemplateFields
          templateName={(cfg.template_name as string) ?? ""}
          language={(cfg.language as string) ?? ""}
          onChange={(patch) => set(patch)}
        />
      )
    case "send_button":
      return <SendButtonFields cfg={cfg} onChange={set} />
    case "send_media":
      return (
        <>
          <FieldBlock label={t("automations.mediaType")}>
            <select
              value={(cfg.media_type as string) ?? "image"}
              onChange={(e) => set({ media_type: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="image">{t("flows.mediaType.image")}</option>
              <option value="video">{t("flows.mediaType.video")}</option>
              <option value="document">{t("flows.mediaType.document")}</option>
              <option value="audio">{t("automations.mediaTypeAudio")}</option>
            </select>
          </FieldBlock>
          <FieldBlock label={t("automations.mediaUrl")}>
            <div className="space-y-2">
              <Input
                value={(cfg.media_url as string) ?? ""}
                onChange={(e) => set({ media_url: e.target.value })}
                placeholder="https://example.com/photo.jpg"
                className="bg-muted text-foreground"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => setMediaPickerOpen(true)}
              >
                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                {t("automations.browseMediaLibrary")}
              </Button>
            </div>
          </FieldBlock>
          <FieldBlock label={t("automations.captionOptional")}>
            <Input
              value={(cfg.caption as string) ?? ""}
              onChange={(e) => set({ caption: e.target.value })}
              placeholder={t("automations.captionPlaceholder")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("automations.filenameOptional")}>
            <Input
              value={(cfg.filename as string) ?? ""}
              onChange={(e) => set({ filename: e.target.value })}
              placeholder="report.pdf"
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <MediaPicker
            open={mediaPickerOpen}
            onOpenChange={setMediaPickerOpen}
            onSelect={(asset) => {
              set({
                media_url: asset.media_url,
                media_type: asset.media_type,
                caption: asset.caption ?? (cfg.caption as string) ?? "",
                filename: asset.name,
              })
            }}
          />
        </>
      )
    case "add_tag":
    case "remove_tag":
      return (
        <FieldBlock label={t("automations.tag")}>
          <TagSelect
            value={(cfg.tag_id as string) ?? ""}
            onChange={(v) => set({ tag_id: v })}
          />
        </FieldBlock>
      )
    case "assign_conversation":
      return (
        <>
          <FieldBlock label={t("automations.mode")}>
            <select
              value={(cfg.mode as string) ?? "round_robin"}
              onChange={(e) => set({ mode: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="round_robin">{t("automations.modeRoundRobin")}</option>
              <option value="specific">{t("automations.modeSpecificAgent")}</option>
            </select>
          </FieldBlock>
          {cfg.mode === "specific" && (
            <FieldBlock label={t("automations.agent")}>
              <AgentSelect
                value={(cfg.agent_id as string) ?? ""}
                onChange={(v) => set({ agent_id: v })}
              />
            </FieldBlock>
          )}
        </>
      )
    case "update_contact_field":
      return (
        <>
          <FieldBlock label={t("automations.field")}>
            <ContactFieldSelect
              value={(cfg.field as string) ?? "name"}
              onChange={(v) => set({ field: v })}
            />
          </FieldBlock>
          <FieldBlock label={t("automations.value")}>
            <Input
              value={(cfg.value as string) ?? ""}
              onChange={(e) => set({ value: e.target.value })}
              placeholder={t("automations.fieldValuePlaceholder")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "create_deal":
      return (
        <>
          <DealPipelineFields
            pipelineId={(cfg.pipeline_id as string) ?? ""}
            stageId={(cfg.stage_id as string) ?? ""}
            onChange={(patch) => set(patch)}
          />
          <FieldBlock label={t("automations.title")}>
            <Input
              value={(cfg.title as string) ?? ""}
              onChange={(e) => set({ title: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("automations.value")}>
            <Input
              type="number"
              value={(cfg.value as number) ?? 0}
              onChange={(e) => set({ value: Number(e.target.value) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "update_deal":
      return (
        <>
          <FieldBlock label={t("automations.dealIdOptional")}>
            <Input
              value={(cfg.deal_id as string) ?? ""}
              onChange={(e) => set({ deal_id: e.target.value })}
              placeholder={t("automations.dealIdPlaceholder")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <DealPipelineFields
            pipelineId={(cfg.pipeline_id as string) ?? ""}
            stageId={(cfg.stage_id as string) ?? ""}
            onChange={(patch) => set(patch)}
          />
          <FieldBlock label={t("automations.statusOptional")}>
            <select
              value={(cfg.status as string) ?? ""}
              onChange={(e) => set({ status: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">{t("automations.keepCurrentStatus")}</option>
              <option value="open">{t("automations.statusOpen")}</option>
              <option value="won">{t("automations.statusWon")}</option>
              <option value="lost">{t("automations.statusLost")}</option>
            </select>
          </FieldBlock>
          <FieldBlock label={t("automations.valueOptional")}>
            <Input
              type="number"
              value={(cfg.value as number) ?? 0}
              onChange={(e) => set({ value: Number(e.target.value) })}
              placeholder={t("automations.valueKeepPlaceholder")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={Boolean(cfg.create_if_missing)}
              onCheckedChange={(v) => set({ create_if_missing: v })}
            />
            {t("automations.createIfMissing")}
          </label>
          {cfg.create_if_missing && (
            <FieldBlock label={t("automations.titleForCreation")}>
              <Input
                value={(cfg.title as string) ?? ""}
                onChange={(e) => set({ title: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
        </>
      )
    case "calendar_update_status":
      return (
        <>
          <FieldBlock label={t("automations.newStatus")}>
            <select
              value={(cfg.status as string) ?? "scheduled"}
              onChange={(e) => set({ status: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="scheduled">{t("automations.calScheduled")}</option>
              <option value="cancelled">{t("automations.calCancelled")}</option>
              <option value="tentative">{t("automations.calTentative")}</option>
            </select>
          </FieldBlock>
          <FieldBlock label={t("automations.eventIdOptional")}>
            <Input
              value={(cfg.event_id as string) ?? ""}
              onChange={(e) => set({ event_id: e.target.value })}
              placeholder={t("automations.eventIdPlaceholder")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <p className="text-xs text-muted-foreground">
            {t("automations.calendarHelp")}
          </p>
        </>
      )
    case "wait":
      return (
        <div className="grid grid-cols-2 gap-2">
          <FieldBlock label={t("automations.amount")}>
            <Input
              type="number"
              min={1}
              value={(cfg.amount as number) ?? 1}
              onChange={(e) => set({ amount: Math.max(1, Number(e.target.value)) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("automations.unit")}>
            <select
              value={(cfg.unit as string) ?? "hours"}
              onChange={(e) => set({ unit: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="minutes">{t("automations.unitMinutes")}</option>
              <option value="hours">{t("automations.unitHours")}</option>
              <option value="days">{t("automations.unitDays")}</option>
            </select>
          </FieldBlock>
        </div>
      )
    case "condition": {
      const subject = (cfg.subject as string) ?? "tag_presence"
      return (
        <>
          <FieldBlock label={t("automations.conditionType")}>
            <select
              value={subject}
              onChange={(e) => set({ subject: e.target.value })}
              className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
            >
              <option value="tag_presence">{t("automations.condTagPresence")}</option>
              <option value="contact_field">{t("automations.condContactField")}</option>
              <option value="message_content">{t("automations.condMessageContent")}</option>
              <option value="time_of_day">{t("automations.condTimeOfDay")}</option>
              <option value="var_equals">{t("automations.condVarEquals")}</option>
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {subject === "tag_presence" &&
                t("automations.condHelpTagPresence")}
              {subject === "contact_field" &&
                t("automations.condHelpContactField")}
              {subject === "message_content" &&
                t("automations.condHelpMessageContent")}
              {subject === "time_of_day" &&
                t("automations.condHelpTimeOfDay")}
              {subject === "var_equals" &&
                t("automations.condHelpVarEquals")}
            </p>
          </FieldBlock>

          {subject === "tag_presence" && (
            <FieldBlock label={t("automations.tag")}>
              <ConditionTagSelect
                value={(cfg.operand as string) ?? ""}
                onChange={(v) => set({ operand: v })}
              />
            </FieldBlock>
          )}

          {subject === "contact_field" && (
            <>
              <FieldBlock label={t("automations.field")}>
                <select
                  value={(cfg.operand as string) ?? ""}
                  onChange={(e) => set({ operand: e.target.value })}
                  className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
                >
                  <option value="">{t("automations.selectField")}</option>
                  <option value="name">{t("contacts.name")}</option>
                  <option value="email">{t("automations.eMail")}</option>
                  <option value="company">{t("contacts.company")}</option>
                  <option value="phone">{t("contacts.phone")}</option>
                </select>
              </FieldBlock>
              <FieldBlock label={t("automations.valueExactMatch")}>
                <Input
                  value={(cfg.value as string) ?? ""}
                  onChange={(e) => set({ value: e.target.value })}
                  placeholder="e.g. acme.com"
                  className="bg-muted text-foreground"
                />
              </FieldBlock>
            </>
          )}

          {subject === "message_content" && (
            <FieldBlock label={t("automations.textToLookFor")}>
              <Input
                value={(cfg.value as string) ?? ""}
                onChange={(e) => set({ value: e.target.value })}
                placeholder={t("automations.textExample")}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}

          {subject === "var_equals" && (
            <>
              <FieldBlock label={t("automations.variableName")}>
                <Input
                  value={(cfg.operand as string) ?? ""}
                  onChange={(e) => set({ operand: e.target.value })}
                  placeholder="classification"
                  className="bg-muted text-foreground"
                />
              </FieldBlock>
              <FieldBlock label={t("automations.expectedValue")}>
                <Input
                  value={(cfg.value as string) ?? ""}
                  onChange={(e) => set({ value: e.target.value })}
                  placeholder="HOT"
                  className="bg-muted text-foreground"
                />
              </FieldBlock>
            </>
          )}

          {subject === "time_of_day" && (
            <FieldBlock label={t("automations.timeRangeLabel")}>
              <Input
                value={(cfg.operand as string) ?? ""}
                onChange={(e) => set({ operand: e.target.value })}
                placeholder="09:00-18:00"
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
        </>
      )
    }
    case "send_webhook":
      return (
        <>
          <FieldBlock label={t("automations.url")}>
            <Input
              value={(cfg.url as string) ?? ""}
              onChange={(e) => set({ url: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("automations.bodyTemplateJson")}>
            <Textarea
              value={(cfg.body_template as string) ?? ""}
              onChange={(e) => set({ body_template: e.target.value })}
              className="min-h-20 bg-muted font-mono text-xs text-foreground"
            />
          </FieldBlock>
        </>
      )
    case "close_conversation":
      return (
        <p className="text-xs text-muted-foreground">
          {t("automations.closeHelp")}
        </p>
      )
    case "ai_condition":
      return (
        <>
          <FieldBlock label={t("automations.classificationPrompt")}>
            <Textarea
              value={(cfg.prompt as string) ?? ""}
              onChange={(e) => set({ prompt: e.target.value })}
              placeholder={t("automations.aiConditionPlaceholder")}
              className="min-h-20 bg-muted text-foreground"
            />
          </FieldBlock>
          <p className="text-xs text-muted-foreground">
            {t("automations.aiConditionHelp")}{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{'{{message.text}}'}</code>.
          </p>
        </>
      )
    case "ai_reply":
      return (
        <>
          <FieldBlock label={t("automations.replyPrompt")}>
            <Textarea
              value={(cfg.prompt as string) ?? ""}
              onChange={(e) => set({ prompt: e.target.value })}
              placeholder={t("automations.aiReplyPlaceholder")}
              className="min-h-20 bg-muted text-foreground"
            />
          </FieldBlock>
          {channel === 'instagram' && (
            <FieldBlock label={t("flows.replyMode")}>
              <select
                value={(cfg.reply_mode as string) ?? "public"}
                onChange={(e) => set({ reply_mode: e.target.value })}
                className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground"
              >
                <option value="public">{t("flows.replyModePublic")}</option>
                <option value="dm">{t("flows.replyModeDm")}</option>
              </select>
            </FieldBlock>
          )}
          <p className="text-xs text-muted-foreground">
            {t("automations.aiReplySupports")}{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{'{{vars.*}}'}</code>{' '}
            {t("automations.and")}{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{'{{message.text}}'}</code>.{' '}
            {t("automations.aiReplyHandoffPre")}{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">[[HANDOFF]]</code>{' '}
            {t("automations.aiReplyHandoffPost")}.
          </p>
        </>
      )
    case "ai_extract":
      return (
        <>
          <FieldBlock label={t("automations.extractionPrompt")}>
            <Textarea
              value={(cfg.prompt as string) ?? ""}
              onChange={(e) => set({ prompt: e.target.value })}
              placeholder={t("automations.extractPlaceholder")}
              className="min-h-20 bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("automations.fields")}>
            <AiExtractFieldsEditor
              fields={(cfg.fields as { key: string; description: string }[]) ?? []}
              onChange={(fields) => set({ fields })}
            />
          </FieldBlock>
          <p className="text-xs text-muted-foreground">
            {t("automations.extractSavesTo")}{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{'{{vars.<key>}}'}</code>.
            {' '}
            {t("automations.extractUseVars")}
          </p>
        </>
      )
    case "ai_classify":
      return (
        <>
          <FieldBlock label={t("automations.classificationPrompt")}>
            <Textarea
              value={(cfg.prompt as string) ?? ""}
              onChange={(e) => set({ prompt: e.target.value })}
              placeholder={t("automations.classifyPlaceholder")}
              className="min-h-20 bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("automations.labels")}>
            <AiClassifyLabelsEditor
              labels={(cfg.labels as string[]) ?? []}
              onChange={(labels) => set({ labels })}
            />
          </FieldBlock>
          <FieldBlock label={t("automations.saveResultAs")}>
            <Input
              value={(cfg.store_var as string) ?? "classification"}
              onChange={(e) => set({ store_var: e.target.value })}
              placeholder="classification"
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t("automations.fallbackLabelOptional")}>
            <Input
              value={(cfg.fallback as string) ?? ""}
              onChange={(e) => set({ fallback: e.target.value })}
              placeholder={t("automations.fallbackPlaceholder")}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <p className="text-xs text-muted-foreground">
            {t("automations.classifyPicksOne")}{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{'{{vars.<save result as>}}'}</code>{' '}
            {t("automations.classifyUsedLater")}.
          </p>
        </>
      )
    default:
      return null
  }
}

function AiClassifyLabelsEditor({
  labels,
  onChange,
}: {
  labels: string[]
  onChange: (labels: string[]) => void
}) {
  const { t } = useLanguage()
  return (
    <div className="space-y-2">
      {labels.map((label, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            placeholder={t("automations.classifyLabelPlaceholder", i + 1)}
            value={label}
            onChange={(e) => {
              const next = [...labels]
              next[i] = e.target.value
              onChange(next)
            }}
            className="bg-muted text-foreground text-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(labels.filter((_, idx) => idx !== i))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...labels, ""])}
      >
        <Plus className="h-3.5 w-3.5" /> {t("automations.addLabel")}
      </Button>
    </div>
  )
}

function AiExtractFieldsEditor({
  fields,
  onChange,
}: {
  fields: { key: string; description: string }[]
  onChange: (fields: { key: string; description: string }[]) => void
}) {
  const { t } = useLanguage()
  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <div className="flex-1 space-y-1">
            <Input
              placeholder={t("automations.keyPlaceholder")}
              value={f.key}
              onChange={(e) => {
                const next = [...fields]
                next[i] = { ...next[i], key: e.target.value }
                onChange(next)
              }}
              className="bg-muted text-foreground text-xs"
            />
            <Input
              placeholder={t("automations.descriptionPlaceholder")}
              value={f.description}
              onChange={(e) => {
                const next = [...fields]
                next[i] = { ...next[i], description: e.target.value }
                onChange(next)
              }}
              className="bg-muted text-foreground text-xs"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-0.5 h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-red-400"
            onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="h-7 w-full border-dashed text-xs text-muted-foreground hover:text-foreground"
        onClick={() => onChange([...fields, { key: "", description: "" }])}
      >
        <PlusCircle className="mr-1 h-3 w-3" />
        {t("automations.addField")}
      </Button>
    </div>
  )
}

function FieldBlock({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 last:mb-0">
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

type Translator = ReturnType<typeof useLanguage>["t"]

function previewFor(step: BuilderStep, t: Translator): string {
  switch (step.step_type) {
    case "send_message":
      return (step.step_config.text as string) || t("automations.previewNoText")
    case "send_template":
      return (step.step_config.template_name as string) || t("automations.previewPickTemplate")
    case "send_button":
      const btnCount = Array.isArray(step.step_config.buttons) ? (step.step_config.buttons as unknown[]).length : 0
      return btnCount > 0 ? t("automations.previewButtonsCount", btnCount) : t("automations.previewNoButtons")
    case "wait": {
      const unitKeys: Record<string, string> = {
        minutes: "automations.unitMinutes",
        hours: "automations.unitHours",
        days: "automations.unitDays",
      }
      const unitKey = unitKeys[step.step_config.unit as string]
      return `${step.step_config.amount ?? "?"} ${unitKey ? t(unitKey) : (step.step_config.unit ?? "")}`
    }
    case "condition": {
      const subjectKeys: Record<string, string> = {
        tag_presence: "automations.condTagPresence",
        contact_field: "automations.condContactField",
        message_content: "automations.condMessageContent",
        time_of_day: "automations.condTimeOfDay",
        var_equals: "automations.condVarEquals",
      }
      const subjectKey = subjectKeys[step.step_config.subject as string]
      return `${t("automations.previewWhen")} ${subjectKey ? t(subjectKey) : (step.step_config.subject ?? "?")}`
    }
    case "send_webhook":
      return (step.step_config.url as string) || t("automations.previewNoUrl")
    case "ai_condition":
      return (step.step_config.prompt as string) || t("automations.previewNoPrompt")
    case "ai_reply":
      return (step.step_config.prompt as string) || t("automations.previewNoPrompt")
    case "ai_extract":
      const f = step.step_config.fields as { key: string }[] | undefined
      return f && f.length > 0
        ? t("automations.previewFieldsCount", f.length)
        : t("automations.previewNoFields")
    default:
      return ""
  }
}

// ------------------------------------------------------------
// Tree mutation helpers
// ------------------------------------------------------------

export function insertAt(
  steps: BuilderStep[],
  parent: ParentScope,
  index: number,
  node: BuilderStep,
): BuilderStep[] {
  if (parent.kind === "root") {
    const copy = [...steps]
    copy.splice(index, 0, node)
    return copy
  }
  return steps.map((s) => {
    if (s.cid === parent.parentCid && s.branches) {
      const list = [...s.branches[parent.branch]]
      list.splice(index, 0, node)
      return { ...s, branches: { ...s.branches, [parent.branch]: list } }
    }
    // Recurse into children so NESTED conditions (a condition living
    // inside another condition's branch) are found too — a root-only
    // lookup silently dropped every insert aimed at them.
    if (!s.branches) return s
    return {
      ...s,
      branches: {
        yes: insertAt(s.branches.yes, parent, index, node),
        no: insertAt(s.branches.no, parent, index, node),
      },
    }
  })
}

export function mapAtPath(
  steps: BuilderStep[],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)

  if (head.kind === "root") {
    return steps.map((s, i) => {
      if (i !== head.index) return s
      return rest.length === 0
        ? updater(s)
        : { ...s, branches: walkBranches(s.branches, rest, updater) }
    })
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const updated = bucket.map((child, i) => {
      if (i !== head.index) return child
      return rest.length === 0
        ? updater(child)
        : { ...child, branches: walkBranches(child.branches, rest, updater) }
    })
    return { ...s, branches: { ...s.branches, [head.branch]: updated } }
  })
}

function walkBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const bucket = branches[head.branch]
  const rest = path.slice(1)
  const updated = bucket.map((child, i) => {
    if (i !== head.index) return child
    return rest.length === 0
      ? updater(child)
      : { ...child, branches: walkBranches(child.branches, rest, updater) }
  })
  return { ...branches, [head.branch]: updated }
}

export function removeAt(steps: BuilderStep[], path: StepPath): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  if (head.kind === "root") {
    if (rest.length === 0) return steps.filter((_, i) => i !== head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: removeFromBranches(s.branches, rest) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next =
      rest.length === 0
        ? bucket.filter((_, i) => i !== head.index)
        : bucket.map((child, i) =>
            i !== head.index
              ? child
              : { ...child, branches: removeFromBranches(child.branches, rest) },
          )
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function removeFromBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const next =
    rest.length === 0
      ? bucket.filter((_, i) => i !== head.index)
      : bucket.map((child, i) =>
          i !== head.index
            ? child
            : { ...child, branches: removeFromBranches(child.branches, rest) },
        )
  return { ...branches, [head.branch]: next }
}

export function moveAt(
  steps: BuilderStep[],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  if (head.kind === "root") {
    if (rest.length === 0) return swap(steps, head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: moveInBranches(s.branches, rest, direction) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next = rest.length === 0 ? swap(bucket, head.index) : bucket
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

function moveInBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  const next = rest.length === 0 ? swap(bucket, head.index) : bucket
  return { ...branches, [head.branch]: next }
}

// ------------------------------------------------------------
// Serialize builder tree → API payload (flattened shape)
// ------------------------------------------------------------

interface ApiStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ApiStep[]; no?: ApiStep[] }
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  return steps.map((s) => ({
    step_type: s.step_type,
    step_config: s.step_config,
    branches: s.branches
      ? { yes: toApiSteps(s.branches.yes), no: toApiSteps(s.branches.no) }
      : undefined,
  }))
}

/**
 * Convert server-returned step tree (from loadStepsTree) into the
 * builder-local shape with client ids.
 */
export interface ServerStepNode {
  id: string
  step_type: string
  step_config: Record<string, unknown>
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] }
}

export function fromServerSteps(nodes: ServerStepNode[]): BuilderStep[] {
  return nodes.map((n) => ({
    cid: cid(),
    step_type: n.step_type as AutomationStepType,
    step_config: n.step_config ?? {},
    branches:
      n.step_type === "condition"
        ? {
            yes: fromServerSteps(n.branches?.yes ?? []),
            no: fromServerSteps(n.branches?.no ?? []),
          }
        : undefined,
  }))
}
