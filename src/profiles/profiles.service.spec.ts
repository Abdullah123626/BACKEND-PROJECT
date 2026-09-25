import { describe, expect, it, vi } from 'vitest';
import { ProfilesService } from './profiles.service.js';

describe('ProfilesService', () => {
  it('includes the authenticated email in the current profile response', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'user-123',
        full_name: 'Ayesha Khan',
        phone: null,
        avatar_url: null,
        bio: null,
        created_at: '2026-09-25T00:00:00.000Z',
        updated_at: '2026-09-25T00:00:00.000Z',
      },
      error: null,
    });
    const supabaseService = {
      getAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle }),
          }),
        }),
      }),
    };

    const service = new ProfilesService(supabaseService as any);

    await expect(
      service.getCurrentProfile('user-123', 'user@example.com', 'user'),
    ).resolves.toMatchObject({
      id: 'user-123',
      email: 'user@example.com',
      role: 'user',
    });
  });
});
