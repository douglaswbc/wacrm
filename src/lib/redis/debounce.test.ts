import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRedis: vi.fn(),
}))

vi.mock('./client', () => ({ getRedis: mocks.getRedis }))

import { addToDebounce } from './debounce'

describe('addToDebounce', () => {
  beforeEach(() => mocks.getRedis.mockReset())

  it('returns false without Redis so the caller dispatches immediately', async () => {
    mocks.getRedis.mockReturnValue(null)

    await expect(addToDebounce({
      accountId: 'account-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      configOwnerUserId: 'owner-1',
      text: 'Olá',
      timestamp: '2026-09-02T18:00:00.000Z',
    })).resolves.toBe(false)
  })
})
