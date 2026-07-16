# Plan: Add `send_button` step to automations (Instagram + WhatsApp)

## Overview

Add a new `send_button` automation step type that allows users to configure
interactive button messages in their automations. Uses the existing
`sendButtonTemplate()` for Instagram and `sendInteractiveButtons()` for WhatsApp.

---

## File 1: `src/types/index.ts`

### 1a. Add `send_button` to `AutomationStepType` (line ~462)

```typescript
export type AutomationStepType =
  | 'send_message'
  | 'send_template'
  | 'send_button'       // <-- ADD
  | 'add_tag'
  | 'remove_tag'
  | 'assign_conversation'
  | 'update_contact_field'
  | 'create_deal'
  | 'wait'
  | 'condition'
  | 'send_webhook'
  | 'close_conversation'
  | 'ai_condition'
  | 'ai_reply'
  | 'ai_extract';
```

### 1b. Add `SendButtonStepConfig` interface (after `SendTemplateStepConfig`, ~line 512)

```typescript
export interface SendButtonStepConfig {
  text: string;
  buttons: {
    type: 'postback' | 'url';
    title: string;
    payload?: string;
    url?: string;
  }[];
}
```

---

## File 2: `src/lib/automations/meta-send.ts`

### 2a. Add `SendButtonArgs` interface (~line 40, after SendTemplateArgs)

```typescript
interface SendButtonArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
  buttons: { type: 'postback' | 'url'; title: string; payload?: string; url?: string }[]
}
```

### 2b. Add `engineSendButton()` function (~line 59, after engineSendTemplate)

```typescript
export async function engineSendButton(
  args: SendButtonArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'button' })
}
```

### 2c. Extend `SendInput` union (~line 61)

```typescript
type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })
  | (SendButtonArgs & { kind: 'button' })
```

### 2d. Add button handling in `sendViaInstagramAPI()` (after line 355, before `} else {`)

```typescript
  } else if (input.kind === 'button') {
    const r = await sendButtonTemplate({
      igUserId,
      accessToken,
      to: contact.instagram_id,
      text: input.text,
      buttons: input.buttons.map((b) => ({
        type: b.type === 'url' ? 'web_url' as const : 'postback' as const,
        title: b.title,
        ...(b.type === 'url' ? { url: b.url! } : { payload: b.payload || b.title }),
      })),
    })
    igMessageId = r.messageId
```

### 2e. Update content_type logic for buttons (~line 374)

Change:
```typescript
const content_type = input.kind === 'template' ? 'template' : 'text'
const content_text = input.kind === 'text' ? input.text : null
const template_name = input.kind === 'template' ? input.templateName : null
```

To:
```typescript
const content_type = input.kind === 'template' ? 'template' : input.kind === 'button' ? 'interactive' : 'text'
const content_text = input.kind === 'text' || input.kind === 'button' ? input.text : null
const template_name = input.kind === 'template' ? input.templateName : null
```

### 2f. Update last_message_text for buttons (~line 393)

Change:
```typescript
last_message_text:
  input.kind === 'template' ? `[template:${input.templateName}]` : input.text,
```

To:
```typescript
last_message_text:
  input.kind === 'template' ? `[template:${input.templateName}]` : input.kind === 'button' ? `[buttons:${input.text.substring(0, 50)}]` : input.text,
```

### 2g. Add similar button handling in `sendViaWhatsAppAPI()` (~line 127)

Inside the `attempt` function, add before the text fallback:
```typescript
    if (input.kind === 'button') {
      const r = await sendInteractiveButtons({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        body: { text: input.text },
        buttons: input.buttons.map((b) => ({
          type: b.type === 'url' ? 'url' as const : 'reply' as const,
          reply: b.type !== 'url' ? { id: b.payload || b.title, title: b.title } : undefined,
          url: b.type === 'url' ? { url: b.url! } : undefined,
        })),
      })
      return r.messageId
    }
```

**Wait — need to check `sendInteractiveButtons` interface first.** The WhatsApp API function may have different parameter shapes. This section may need adjustment based on the actual function signature.

### 2h. Update WhatsApp content_type/template_name for buttons

In the WhatsApp path (~line 180), similar to Instagram 2e:
```typescript
const content_type = input.kind === 'template' ? 'template' : input.kind === 'button' ? 'interactive' : 'text'
const content_text = input.kind === 'text' || input.kind === 'button' ? input.text : null
const template_name = input.kind === 'template' ? input.templateName : null
```

### 2i. Add button handling in `sendViaRyzeAPI()` (~line 233)

For RyzeAPI, fallback to sending as text with button info:
```typescript
  } else if (input.kind === 'button') {
    const buttonLines = input.buttons.map((b, i) => `${i + 1}. ${b.title}${b.type === 'url' ? ` - ${b.url}` : ''}`).join('\n')
    const text = `${input.text}\n\n${buttonLines}`
    ryzeMessageId = await sendRyzeText({ ... })
```

---

## File 3: `src/lib/automations/engine.ts`

### 3a. Import `SendButtonStepConfig` (~line 6)

Add to the existing import from `@/types`:
```typescript
  SendMessageStepConfig,
  SendTemplateStepConfig,
  SendButtonStepConfig,   // <-- ADD
```

### 3b. Import `engineSendButton` (~line 21)

```typescript
import { engineSendText, engineSendTemplate, engineSendButton } from './meta-send'
```

### 3c. Add `case 'send_button'` in `runStep()` (~line 466, after send_template case)

```typescript
    case 'send_button': {
      const cfg = step.step_config as SendButtonStepConfig
      if (!args.contactId) throw new Error('send_button needs a contact')
      if (!cfg.text?.trim()) throw new Error('send_button has empty text')
      if (!cfg.buttons?.length) throw new Error('send_button needs at least 1 button')
      const conversationId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendButton({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        text: interpolate(cfg.text, args),
        buttons: cfg.buttons,
      })
      return `button message sent via Meta (${whatsapp_message_id})`
    }
```

---

## File 4: `src/lib/automations/validate.ts`

### 4a. Add `case 'send_button'` validation (~line 66, after send_template)

```typescript
    case 'send_button':
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, message: 'message text is required' })
      }
      if (!Array.isArray(c.buttons) || c.buttons.length === 0) {
        issues.push({ path: `${path}.buttons`, message: 'at least 1 button is required' })
      } else if (c.buttons.length > 3) {
        issues.push({ path: `${path}.buttons`, message: 'maximum 3 buttons allowed' })
      } else {
        for (let bi = 0; bi < (c.buttons as unknown[]).length; bi++) {
          const b = (c.buttons as Record<string, unknown>[])[bi]
          if (!nonEmpty(b.title)) {
            issues.push({ path: `${path}.buttons[${bi}].title`, message: 'button title is required' })
          }
          if (b.type === 'url' && !nonEmpty(b.url)) {
            issues.push({ path: `${path}.buttons[${bi}].url`, message: 'URL is required for url-type buttons' })
          }
          if (b.type !== 'url' && b.type !== 'postback') {
            issues.push({ path: `${path}.buttons[${bi}].type`, message: 'button type must be "postback" or "url"' })
          }
        }
      }
      break
```

---

## File 5: `src/components/automations/automation-builder.tsx`

### 5a. Add to `STEP_META` (~line 103)

```typescript
  send_button: { label: "Send Button", icon: MessageSquare, border: "border-l-primary" },
```

### 5b. Add to `ADDABLE_STEPS` (~line 120)

```typescript
  "send_button",
```

### 5c. Add to `blankConfig()` (~line 162)

```typescript
    case "send_button":
      return { text: "", buttons: [] }
```

### 5d. Add step config editor in `StepConfigEditor()` (~line 1424)

After the `case "send_template"` block, add:

```tsx
    case "send_button":
      return <SendButtonFields cfg={cfg} onChange={set} />
```

### 5e. Create `SendButtonFields` component

Add a new component before `StepConfigEditor`:

```tsx
function SendButtonFields({
  cfg,
  onChange,
}: {
  cfg: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
}) {
  const buttons = (cfg.buttons as SendButtonField[]) ?? []

  return (
    <>
      <FieldBlock label="Message text">
        <Textarea
          value={(cfg.text as string) ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Choose an option below..."
          className="min-h-20 bg-muted text-foreground"
        />
      </FieldBlock>

      <FieldBlock label={`Buttons (${buttons.length}/3)`}>
        <div className="space-y-2">
          {buttons.map((btn, i) => (
            <div key={i} className="rounded-md border border-border bg-muted p-2 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={btn.type ?? "postback"}
                  onChange={(e) => {
                    const next = [...buttons]
                    next[i] = { ...next[i], type: e.target.value as "postback" | "url" }
                    onChange({ buttons: next })
                  }}
                  className="w-28 rounded border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value="postback">Postback</option>
                  <option value="url">URL</option>
                </select>
                <input
                  value={btn.title ?? ""}
                  onChange={(e) => {
                    const next = [...buttons]
                    next[i] = { ...next[i], title: e.target.value }
                    onChange({ buttons: next })
                  }}
                  placeholder="Button title"
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                  maxLength={20}
                />
                <button
                  onClick={() => {
                    const next = buttons.filter((_, j) => j !== i)
                    onChange({ buttons: next })
                  }}
                  className="text-destructive hover:text-destructive/80 p-1"
                  aria-label="Remove button"
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
                  placeholder="Payload (optional)"
                  className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                />
              )}
            </div>
          ))}
          {buttons.length < 3 && (
            <button
              onClick={() => {
                onChange({ buttons: [...buttons, { type: "postback", title: "", payload: "" }] })
              }}
              className="w-full rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
            >
              + Add button
            </button>
          )}
        </div>
      </FieldBlock>
    </>
  )
}
```

### 5f. Add type import and `X` icon import at top of file

Check if `X` (from lucide-react) is already imported. If not, add it.

---

## File 6: WhatsApp `sendInteractiveButtons` interface check

Before implementing 2g, verify the exact function signature in:
`src/lib/whatsapp/meta-api.ts` (~line 766)

The button format may differ. Need to check whether it uses:
- `{ type: 'reply', reply: { id, title } }` or `{ type: 'reply', id, title }`
- `{ type: 'url', url: { url } }` or `{ type: 'url', url }`

---

## Verification

After all changes:
1. Run `npx tsc --noEmit` to verify type correctness
2. Verify the builder renders the new step
3. Test creating an automation with a send_button step for Instagram
