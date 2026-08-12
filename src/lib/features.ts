import {
  BarChart3,
  Calendar,
  Camera,
  Coins,
  FileText,
  KeyRound,
  PlugZap,
  Share2,
  Sparkles,
  Tags,
  UsersRound,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

export const WORKSPACE_FEATURES = [
  'whatsapp',
  'instagram',
  'ryzeapi',
  'evolution',
  'calendar',
  'social',
  'templates',
  'fields',
  'deals',
  'members',
  'ai',
  'api',
  'webhooks',
  'meta_capi',
] as const;

export type WorkspaceFeature = (typeof WORKSPACE_FEATURES)[number];

export interface WorkspaceFeatureMeta {
  key: WorkspaceFeature;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const WORKSPACE_FEATURE_META: Record<WorkspaceFeature, WorkspaceFeatureMeta> = {
  whatsapp: { key: 'whatsapp', label: 'WhatsApp (Legacy)', icon: PlugZap, description: 'Legacy WhatsApp Cloud API (migrate to Social Accounts)' },
  instagram: { key: 'instagram', label: 'Instagram (Legacy)', icon: Camera, description: 'Legacy Instagram API (migrate to Social Accounts)' },
  ryzeapi: { key: 'ryzeapi', label: 'RyzeAPI', icon: PlugZap, description: 'Self-hosted WhatsApp gateway' },
  evolution: { key: 'evolution', label: 'Evolution API', icon: PlugZap, description: 'Open-source Evolution API WhatsApp gateway' },
  calendar: { key: 'calendar', label: 'Google Calendar', icon: Calendar, description: 'Google Calendar integration and sync' },
  social: { key: 'social', label: 'Social Accounts', icon: Share2, description: 'Connect WhatsApp, Instagram & more via Zernio' },
  templates: { key: 'templates', label: 'Templates', icon: FileText, description: 'WhatsApp message templates' },
  fields: { key: 'fields', label: 'Fields & tags', icon: Tags, description: 'Custom contact fields and tag management' },
  deals: { key: 'deals', label: 'Deals & currency', icon: Coins, description: 'Pipeline deal settings and default currency' },
  members: { key: 'members', label: 'Team members', icon: UsersRound, description: 'Invite and manage team members' },
  ai: { key: 'ai', label: 'AI Assistant', icon: Sparkles, description: 'AI reply configuration and auto-reply settings' },
  api: { key: 'api', label: 'API keys', icon: KeyRound, description: 'Public REST API key management' },
  webhooks: { key: 'webhooks', label: 'Webhooks', icon: Webhook, description: 'Outbound webhook endpoint configuration' },
  meta_capi: { key: 'meta_capi', label: 'Meta CAPI', icon: BarChart3, description: 'Meta Conversions API for ad optimization' },
};