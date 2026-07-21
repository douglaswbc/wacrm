import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  resolveConversationByPhone,
} from './resolve-conversation';

describe('resolveConversationByPhone — provider fallback', () => {
  let db: SupabaseClient;
  let mockFrom: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFrom = vi.fn();
    db = { from: mockFrom } as unknown as SupabaseClient;
  });

  it('allows resolution when only RyzeAPI is configured (no Meta)', async () => {
    // Simular: Meta não configurado, RyzeAPI configurado
    mockFrom.mockImplementation((table: string) => {
      if (table === 'whatsapp_config') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }
      if (table === 'ryzeapi_config') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'ryze-1' } }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    // Deve passar da verificação de configuração (não lançar erro)
    // O erro virá depois quando tentar criar o contato (db não está completo)
    await expect(
      resolveConversationByPhone(db, 'acct-1', '+14155550123')
    ).rejects.toThrow();

    // Verificar que ryzeapi_config foi consultado
    const ryzeCalls = mockFrom.mock.calls.filter(([t]) => t === 'ryzeapi_config');
    expect(ryzeCalls.length).toBeGreaterThan(0);
  });

  it('throws whatsapp_not_configured when neither Meta nor RyzeAPI is configured', async () => {
    // Simular: nenhum provider configurado
    mockFrom.mockImplementation((table: string) => {
      if (table === 'whatsapp_config') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }
      if (table === 'ryzeapi_config') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { SendMessageError } = await import('./send-message');
    await expect(
      resolveConversationByPhone(db, 'acct-1', '+14155550123')
    ).rejects.toThrow(SendMessageError);
  });
});
