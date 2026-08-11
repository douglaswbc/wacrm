import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'lead_triage'
  | 'follow_up_reminder'
  | 'ig_comment_public_reply'
  | 'ig_comment_dm_reply'
  | 'calendar_reminder'
  | 'follow_up_reativacao'
  | 'triagem_atendimento'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  welcome_message: {
    slug: 'welcome_message',
    name: 'Welcome Message',
    description: 'Auto-reply to first-time contacts with a greeting.',
    // first_inbound_message (added in PR #33) catches both brand-new
    // contacts AND manually-added/imported contacts on their first-ever
    // reply, which is what a user setting up a "welcome" automation
    // almost always wants. new_contact_created would miss the
    // manually-imported case.
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Hi! 👋 Thanks for reaching out. We'll get back to you shortly.",
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    name: 'Out of Office',
    description: 'Auto-reply during off-hours so nobody is left waiting.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Thanks for your message! Our team is offline right now (9am–6pm) and will reply first thing tomorrow.",
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    name: 'Lead Qualifier',
    description: 'Ask qualification questions to filter inbound leads.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['pricing', 'quote', 'buy'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Great — happy to help with pricing! Quick question: roughly how many seats are you looking for?",
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 10, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    name: 'Follow-up Reminder',
    description: 'Send a nudge if a contact has not replied within 24 hours.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Just circling back — did you have any other questions for us? Happy to help!",
        },
      },
    ],
  },
  lead_triage: {
    slug: 'lead_triage',
    name: 'Lead Triage',
    description: 'Classify inbound leads (hot/warm/cold) with AI, tag the outcome, and create or update the deal.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['pricing', 'quote', 'buy'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'ai_classify',
        step_config: {
          prompt:
            'Assess purchase intent from the message. HOT = ready to buy now, WARM = interested but comparing, COLD = just browsing.',
          labels: ['hot', 'warm', 'cold'],
          store_var: 'lead_tier',
          fallback: 'cold',
        },
      },
      {
        step_type: 'update_deal',
        step_config: {
          stage_id: '',
          title: 'Lead from keyword',
          create_if_missing: true,
          value: 0,
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Thanks for reaching out! Noted as {{ vars.lead_tier }} — a specialist will follow up shortly.',
        },
      },
    ],
  },
  ig_comment_public_reply: {
    slug: 'ig_comment_public_reply',
    name: 'Instagram Comment Reply (Public)',
    description: 'When someone comments a keyword on your Instagram post, reply publicly on the post.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['promo', 'quero', 'info'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: '👋 Thanks for your comment! Check the link in our bio for more info.',
          reply_mode: 'public',
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  ig_comment_dm_reply: {
    slug: 'ig_comment_dm_reply',
    name: 'Instagram Comment to DM',
    description: 'When someone comments a keyword, send them a private DM with more details.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['promo', 'quero', 'info'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: 'Hey! Thanks for your interest. Here\'s everything you need to know...',
          reply_mode: 'dm',
        },
      },
      {
        step_type: 'send_media',
        step_config: {
          media_type: 'image',
          media_url: '',
          caption: 'Check this out!',
          filename: '',
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  calendar_reminder: {
    slug: 'calendar_reminder',
    name: 'Appointment Reminder',
    description: 'Send a WhatsApp reminder to contacts with a scheduled appointment and let them confirm or cancel with a tap.',
    trigger_type: 'time_based',
    trigger_config: {
      schedule: '17:00',
      timezone: 'America/Sao_Paulo',
      target_mode: 'tags',
      tag_ids: [],
    },
    steps: [
      {
        step_type: 'send_button',
        step_config: {
          text:
            'Olá {{contact.name}}! 👋 Você tem um atendimento marcado para amanhã. Confirma?',
          buttons: [
            { type: 'postback', title: '✅ Confirmar', payload: 'CONFIRMAR' },
            { type: 'postback', title: '❌ Cancelar', payload: 'CANCELAR' },
          ],
        },
      },
      {
        step_type: 'condition',
        step_config: {
          subject: 'message_content',
          operand: 'confirmar',
        },
      },
      {
        step_type: 'calendar_update_status',
        step_config: { status: 'scheduled' },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'send_message',
        step_config: {
          text: 'Perfeito! Até amanhã. 😊',
        },
        parent_index: 1,
        branch: 'yes',
      },
    ],
  },
  follow_up_reativacao: {
    slug: 'follow_up_reativacao',
    name: 'Cold Lead Re-engagement',
    description: 'Send a WhatsApp nudge to contacts whose open deals have had no activity for a set number of days.',
    trigger_type: 'time_based',
    trigger_config: {
      schedule: '10:00',
      timezone: 'America/Sao_Paulo',
      target_mode: 'pipeline',
      deal_status: 'open',
      deal_inactivity_days: 3,
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Olá {{contact.name}}! Vi que ainda não concluímos seu atendimento. Posso ajudar em algo? 😊',
        },
      },
      {
        step_type: 'update_deal',
        step_config: {
          status: 'open',
        },
      },
    ],
  },
  triagem_atendimento: {
    slug: 'triagem_atendimento',
    name: 'Service Triage',
    description: 'Classify each inbound WhatsApp message by department with AI and route the reply accordingly.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'ai_classify',
        step_config: {
          prompt:
            'Classify this customer message into one department: TECNICO (technical/bug), COMERCIAL (pricing/quote/buy), FINANCEIRO (billing/payment/invoice) or OUTRO. Answer with a single label.',
          labels: ['TECNICO', 'COMERCIAL', 'FINANCEIRO', 'OUTRO'],
          store_var: 'setor',
          fallback: 'OUTRO',
        },
      },
      {
        step_type: 'condition',
        step_config: {
          subject: 'var_equals',
          operand: 'setor',
          value: 'TECNICO',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: 'Você falou com o suporte técnico. Já anotei seu caso e um especialista vai te atender em instantes. 🛠️',
        },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'condition',
        step_config: {
          subject: 'var_equals',
          operand: 'setor',
          value: 'COMERCIAL',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: 'Você falou com o comercial! Um consultor vai te chamar com as melhores condições. 💼',
        },
        parent_index: 4,
        branch: 'yes',
      },
      {
        step_type: 'condition',
        step_config: {
          subject: 'var_equals',
          operand: 'setor',
          value: 'FINANCEIRO',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: 'Você falou com o financeiro. Enviei os dados de pagamento para você. 💳',
        },
        parent_index: 6,
        branch: 'yes',
      },
    ],
  },
}

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}
