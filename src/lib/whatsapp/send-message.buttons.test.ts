import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

// A db that explodes if touched — these tests cover the button-type
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp,
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params),
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    },
  );
}

const base = {
  conversationId: 'cv-1',
  messageType: 'buttons',
  contentText: 'body',
};

describe('sendMessageToConversation — OutboundButton validation (pre-DB)', () => {
  it('accepts legacy reply buttons ({id,title}) and explicit reply type', async () => {
    // Validation passes → it proceeds to the DB lookup which throws
    // (noDb) — meaning validation did NOT reject.
    await expect(
      sendMessageToConversation(noDb(), 'acct-1', {
        ...base,
        buttons: [{ id: '1', title: 'Yes' }],
      }),
    ).rejects.toThrow(/db should not be queried|not_configured/);

    await expect(
      sendMessageToConversation(noDb(), 'acct-1', {
        ...base,
        buttons: [{ type: 'reply', id: '1', title: 'Yes' }],
      }),
    ).rejects.not.toBeInstanceOf(SendMessageError);
  });

  it('rejects reply buttons missing id or title', async () => {
    await expectSendError(
      { ...base, buttons: [{ title: 'No id' }] as SendMessageParams['buttons'] },
      400,
      /Reply buttons must have/,
    );
  });

  it('validates copy buttons', async () => {
    // Valid copy button → passes validation, hits the DB guard.
    await expect(
      sendMessageToConversation(noDb(), 'acct-1', {
        ...base,
        buttons: [{ type: 'copy', title: 'Copy', copyCode: 'abc' }],
      }),
    ).rejects.toThrow(/db should not be queried|not_configured/);
    // Missing copy_code → validation error.
    await expectSendError(
      { ...base, buttons: [{ type: 'copy', title: 'Copy' }] } as SendMessageParams,
      400,
      /Copy buttons must have/,
    );
  });

  it('validates url buttons', async () => {
    await expectSendError(
      { ...base, buttons: [{ type: 'url', title: 'Go' }] } as SendMessageParams,
      400,
      /URL buttons must have/,
    );
  });

  it('validates call buttons', async () => {
    await expectSendError(
      {
        ...base,
        buttons: [{ type: 'call', title: 'Call' }],
      } as SendMessageParams,
      400,
      /Call buttons must have/,
    );
  });

  it('validates pix buttons', async () => {
    // Valid pix button → passes validation.
    await expect(
      sendMessageToConversation(noDb(), 'acct-1', {
        ...base,
        buttons: [
          {
            type: 'pix',
            currency: 'BRL',
            name: 'Davidson',
            keyType: 'RANDOM',
            key: 'key-1',
          },
        ],
      }),
    ).rejects.toThrow(/db should not be queried|not_configured/);
    // Invalid key_type → validation error.
    await expectSendError(
      {
        ...base,
        buttons: [
          { type: 'pix', currency: 'BRL', name: 'Davidson', keyType: 'BOGUS', key: 'k' },
        ],
      },
      400,
      /key_type must be one of/,
    );
  });

  it('still enforces the 1-3 button limit across types', async () => {
    await expectSendError(
      {
        ...base,
        buttons: [
          { id: '1', title: 'A' },
          { type: 'url', title: 'B', url: 'https://x.com' },
          { type: 'copy', title: 'C', copyCode: 'x' },
          { type: 'call', title: 'D', phoneNumber: '123' },
        ],
      },
      400,
      /1-3 items/,
    );
  });
});
