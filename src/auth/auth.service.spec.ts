import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;
  let resetPasswordForEmail: ReturnType<typeof vi.fn>;
  let getUser: ReturnType<typeof vi.fn>;
  let updateUserById: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetPasswordForEmail = vi.fn();
    getUser = vi.fn();
    updateUserById = vi.fn();

    const supabaseService = {
      getClient: () => ({
        auth: {
          resetPasswordForEmail,
          getUser,
        },
      }),
      getAdminClient: () => ({
        auth: {
          admin: {
            updateUserById,
          },
        },
      }),
    };

    service = new AuthService(supabaseService as any);
  });

  it('forgotPassword should request a password reset email', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

    await service.forgotPassword({ email: 'user@example.com' });

    expect(resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', {
      redirectTo: expect.any(String),
    });
  });

  it('resetPassword should reject invalid reset tokens', async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid token' },
    });

    await expect(
      service.resetPassword({
        accessToken: 'bad-token',
        password: 'ValidPass!123',
      }),
    ).rejects.toThrow('Invalid or expired reset token');
  });

  it('resetPassword should update the password for a valid reset token', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });
    updateUserById.mockResolvedValue({ data: { id: 'user-123' }, error: null });

    await expect(
      service.resetPassword({
        accessToken: 'valid-token',
        password: 'NewStrongPass!123',
      }),
    ).resolves.toEqual({
      message: 'Password reset successfully',
    });

    expect(updateUserById).toHaveBeenCalledWith('user-123', {
      password: 'NewStrongPass!123',
    });
  });
});
