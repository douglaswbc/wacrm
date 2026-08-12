import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';

export interface ApiEvolutionConfig {
  api_url: string;
  instance_name: string;
  instance_token: string;
  status: string;
}

export async function getEvolutionConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<ApiEvolutionConfig | null> {
  const { data, error } = await db
    .from('evolution_config')
    .select('api_url, instance_name, instance_token, status')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !data) return null;

  let instanceToken: string;
  try {
    instanceToken = decrypt(data.instance_token);
  } catch {
    return null;
  }

  return {
    api_url: data.api_url,
    instance_name: data.instance_name,
    instance_token: instanceToken,
    status: data.status,
  };
}
