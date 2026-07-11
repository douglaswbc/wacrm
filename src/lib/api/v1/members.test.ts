import { describe, it, expect } from 'vitest';

import { serializeMember } from './members';

describe('serializeMember', () => {
  it('serializes a full profile row into an ApiMember', () => {
    const row = {
      id: 'p1',
      user_id: 'u1',
      full_name: 'Jane Doe',
      email: 'jane@acme.com',
      avatar_url: null,
      account_role: 'admin',
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(serializeMember(row)).toEqual({
      id: 'p1',
      user_id: 'u1',
      full_name: 'Jane Doe',
      email: 'jane@acme.com',
      avatar_url: null,
      account_role: 'admin',
      created_at: '2026-01-01T00:00:00Z',
    });
  });

  it('treats null name, email, avatar_url as null', () => {
    const row = {
      id: 'p2',
      user_id: 'u2',
      full_name: null,
      email: null,
      avatar_url: null,
      account_role: 'agent',
      created_at: '2026-02-01T00:00:00Z',
    };
    expect(serializeMember(row)).toEqual({
      id: 'p2',
      user_id: 'u2',
      full_name: null,
      email: null,
      avatar_url: null,
      account_role: 'agent',
      created_at: '2026-02-01T00:00:00Z',
    });
  });

  it('falls back to viewer for unrecognized account_role', () => {
    const row = {
      id: 'p3',
      user_id: 'u3',
      full_name: 'Unknown',
      email: null,
      avatar_url: null,
      account_role: 'superadmin',
      created_at: '2026-03-01T00:00:00Z',
    };
    expect(serializeMember(row).account_role).toBe('viewer');
  });

  it('handles all known roles', () => {
    for (const role of ['owner', 'admin', 'agent', 'viewer']) {
      const row = {
        id: 'p4',
        user_id: 'u4',
        full_name: 'Test',
        email: null,
        avatar_url: null,
        account_role: role,
        created_at: '2026-04-01T00:00:00Z',
      };
      expect(serializeMember(row).account_role).toBe(role);
    }
  });
});
