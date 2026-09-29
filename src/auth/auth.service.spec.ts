import { HttpException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';

// Fake JWT: sirf payload ka "amr" claim test ke liye (signature Supabase check karta hai).
function jwt(methods: string[]) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ amr: methods.map((method) => ({ method })) })}.signature`;
}

const PASSWORD = 'Str0ng!Passw0rd';
const RECOVERY_TOKEN = jwt(['recovery']);
const LOGIN_TOKEN = jwt(['password']);

function authError(status: number | undefined, code?: string, message = 'internal supabase detail') {
  return { status, code, message, name: 'AuthApiError' };
}

// auth-js 2.117+: network failure (status 0) aur 5xx dono isi naam se aate hain.
function retryableError(status: number, code?: string) {
  return { status, code, message: 'internal supabase detail', name: 'AuthRetryableFetchError' };
}

async function expectStatus(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(status);
  return error as HttpException;
}

describe('AuthService', () => {
  let service: AuthService;
  let mocks: Record<string, ReturnType<typeof vi.fn>>;
  let logs: string[];

  beforeEach(() => {
    mocks = {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      refreshSession: vi.fn(),
      getUser: vi.fn(),
      resend: vi.fn().mockResolvedValue({ data: {}, error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
      updatePassword: vi.fn().mockResolvedValue({ status: 200 }),
      signOut: vi.fn().mockResolvedValue({ status: 204 }),
      requestEmailChange: vi.fn(),
    };

    const supabaseService = {
      createAuthClient: () => ({
        auth: {
          signUp: mocks.signUp,
          signInWithPassword: mocks.signInWithPassword,
          refreshSession: mocks.refreshSession,
        },
      }),
      getClient: () => ({
        auth: {
          getUser: mocks.getUser,
          resend: mocks.resend,
          resetPasswordForEmail: mocks.resetPasswordForEmail,
        },
      }),
      signOut: mocks.signOut,
      updatePassword: mocks.updatePassword,
      requestEmailChange: mocks.requestEmailChange,
    };
    const configService = { get: () => 'https://app.example.com/' };

    service = new AuthService(supabaseService as any, configService as any);

    // Har log line capture karo taake sensitive data check ho sake
    logs = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('signup', () => {
    it('creates an account that requires email verification', async () => {
      mocks.signUp.mockResolvedValue({
        data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: null },
        error: null,
      });

      const result = await service.signup({ email: 'user@example.com', password: PASSWORD });

      expect(result).toEqual({
        message: expect.stringContaining('verify'),
        requiresEmailConfirmation: true,
      });
      expect(mocks.signUp).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: PASSWORD,
        options: { emailRedirectTo: 'https://app.example.com/login' },
      });
      // Response me password/session/token kabhi nahi
      expect(JSON.stringify(result)).not.toContain(PASSWORD);
    });

    it('returns 409 for an email that already has a verified account', async () => {
      // Supabase (confirm ON) duplicate pe khali identities wala nakli user bhejta hai
      mocks.signUp.mockResolvedValueOnce({
        data: { user: { id: 'obfuscated', identities: [] }, session: null },
        error: null,
      });
      const thrown = await expectStatus(service.signup({ email: 'taken@example.com', password: PASSWORD }), 409);
      expect(thrown.message).toContain('already exists');
    });

    it('treats a brand-new account (confirmation sent right away) as new', async () => {
      mocks.signUp.mockResolvedValueOnce({
        data: {
          user: {
            id: 'u1',
            identities: [{ id: 'i1' }],
            created_at: '2026-09-29T10:00:00.000Z',
            confirmation_sent_at: '2026-09-29T10:00:01.500Z',
          },
          session: null,
        },
        error: null,
      });
      const result = await service.signup({ email: 'new@example.com', password: PASSWORD });
      expect(result.message).toMatch(/^Account created/);
    });

    it('tells an existing unverified user that a new verification email was sent', async () => {
      mocks.signUp.mockResolvedValueOnce({
        data: {
          user: {
            id: 'u1',
            identities: [{ id: 'i1' }],
            created_at: '2026-09-20T10:00:00.000Z',
            confirmation_sent_at: '2026-09-29T10:00:00.000Z',
          },
          session: null,
        },
        error: null,
      });
      const result = await service.signup({ email: 'pending@example.com', password: PASSWORD });
      expect(result).toEqual({
        message: expect.stringContaining('already registered but not verified'),
        requiresEmailConfirmation: true,
      });
    });

    it('explains when the verification email could not be sent (SMTP failure)', async () => {
      mocks.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: { status: 500, code: 'unexpected_failure', message: 'Error sending confirmation email', name: 'AuthRetryableFetchError' },
      });
      const thrown = await expectStatus(service.signup({ email: 'user@example.com', password: PASSWORD }), 503);
      expect(thrown.message).toContain('verification email');
      expect(logs.some((line) => line.includes('SMTP Settings'))).toBe(true);
    });

    it('does not blame SMTP when the database failed to save the user', async () => {
      mocks.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: { status: 500, code: 'unexpected_failure', message: 'Database error saving new user', name: 'AuthRetryableFetchError' },
      });
      const thrown = await expectStatus(service.signup({ email: 'user@example.com', password: PASSWORD }), 503);
      expect(thrown.message).not.toContain('email');
      expect(logs.some((line) => line.includes('migration 003'))).toBe(true);
      expect(logs.some((line) => line.includes('SMTP'))).toBe(false);
    });

    it('asks the user to wait when a verification email was sent moments ago', async () => {
      mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: authError(429, 'over_email_send_rate_limit') });
      const thrown = await expectStatus(service.signup({ email: 'user@example.com', password: PASSWORD }), 429);
      expect(thrown.message).toContain('check your inbox');
    });

    it('returns 409 for a duplicate when Supabase reports it (confirm email disabled)', async () => {
      mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: authError(422, 'user_already_exists') });
      await expectStatus(service.signup({ email: 'taken@example.com', password: PASSWORD }), 409);
    });

    it('does not hand out or keep a session when confirm email is disabled', async () => {
      mocks.signUp.mockResolvedValue({
        data: { user: { id: 'u1' }, session: { access_token: 'auto-session' } },
        error: null,
      });
      const result = await service.signup({ email: 'user@example.com', password: PASSWORD });
      expect(result.requiresEmailConfirmation).toBe(false);
      expect(mocks.signOut).toHaveBeenCalledWith('auto-session', 'local');
      expect(JSON.stringify(result)).not.toContain('auto-session');
    });

    it.each([
      ['signups disabled', authError(422, 'signup_disabled'), 403],
      ['weak password per Supabase', authError(422, 'weak_password'), 400],
      ['invalid email per Supabase', authError(400, 'email_address_invalid'), 400],
      ['rate limited', authError(429, 'over_email_send_rate_limit'), 429],
      ['email service failure', authError(500, 'unexpected_failure'), 503],
      ['network failure', authError(undefined), 503],
      ['unknown client error', authError(400, 'something_new'), 400],
    ])('handles %s safely', async (_name, error, status) => {
      mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error });
      const thrown = await expectStatus(service.signup({ email: 'user@example.com', password: PASSWORD }), status);
      // Supabase ka andar ka message client tak nahi jata
      expect(JSON.stringify(thrown.getResponse())).not.toContain('internal supabase detail');
    });
  });

  describe('login', () => {
    const session = { access_token: 'access-1', refresh_token: 'refresh-1', expires_at: 100, expires_in: 3600 };

    it('returns the user and session on success', async () => {
      mocks.signInWithPassword.mockResolvedValue({
        data: { user: { id: 'u1', email: 'user@example.com', email_confirmed_at: '2026-01-01' }, session },
        error: null,
      });

      const result = await service.login({ email: 'user@example.com', password: PASSWORD }, '1.1.1.1');

      expect(result).toEqual({
        message: 'Login successful',
        user: { id: 'u1', email: 'user@example.com', emailConfirmedAt: '2026-01-01' },
        session: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 100, expiresIn: 3600 },
      });
      expect(JSON.stringify(result)).not.toContain(PASSWORD);
    });

    it.each([
      ['wrong password / unknown email', 'invalid_credentials'],
      ['deleted user', 'invalid_credentials'],
      ['disabled (banned) user', 'user_banned'],
    ])('returns the same generic 401 for %s', async (_name, code) => {
      mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError(400, code) });
      const thrown = await expectStatus(service.login({ email: 'user@example.com', password: 'Wrong' }, '1.1.1.1'), 401);
      expect(thrown.message).toBe('Invalid email or password');
    });

    it('asks unverified users to verify their email', async () => {
      mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError(400, 'email_not_confirmed') });
      await expectStatus(service.login({ email: 'user@example.com', password: PASSWORD }, '1.1.1.1'), 403);
    });

    it('blocks and revokes a session for an unconfirmed user even if Supabase issued one', async () => {
      mocks.signInWithPassword.mockResolvedValue({
        data: { user: { id: 'u1', email_confirmed_at: null }, session },
        error: null,
      });
      await expectStatus(service.login({ email: 'user@example.com', password: PASSWORD }, '1.1.1.1'), 403);
      expect(mocks.signOut).toHaveBeenCalledWith('access-1', 'local');
    });

    it('locks out repeated failed attempts (brute force) per IP + email', async () => {
      mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError(400, 'invalid_credentials') });
      const attempt = (ip = '1.1.1.1') => service.login({ email: 'victim@example.com', password: 'Guess' }, ip);

      for (let i = 0; i < 5; i++) await expectStatus(attempt(), 401);
      mocks.signInWithPassword.mockClear();
      await expectStatus(attempt(), 429); // 6th attempt locked: Supabase is not even called
      expect(mocks.signInWithPassword).not.toHaveBeenCalled();

      // Doosre IP se wahi email lock nahi (victim ka account DoS nahi hota)
      await expectStatus(attempt('2.2.2.2'), 401);
    });

    it('resets the failure counter after a successful login', async () => {
      mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError(400, 'invalid_credentials') });
      for (let i = 0; i < 4; i++) {
        await expectStatus(service.login({ email: 'user@example.com', password: 'x' }, '1.1.1.1'), 401);
      }
      mocks.signInWithPassword.mockResolvedValueOnce({
        data: { user: { id: 'u1', email_confirmed_at: '2026-01-01' }, session },
        error: null,
      });
      await service.login({ email: 'user@example.com', password: PASSWORD }, '1.1.1.1');
      await expectStatus(service.login({ email: 'user@example.com', password: 'x' }, '1.1.1.1'), 401);
    });

    it.each([
      ['Supabase 5xx', authError(502)],
      ['network failure', authError(undefined)],
    ])('returns 503 on %s', async (_name, error) => {
      mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error });
      await expectStatus(service.login({ email: 'user@example.com', password: PASSWORD }, '1.1.1.1'), 503);
    });

    it('passes Supabase rate limiting through as 429', async () => {
      mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError(429, 'over_request_rate_limit') });
      await expectStatus(service.login({ email: 'user@example.com', password: PASSWORD }, '1.1.1.1'), 429);
    });
  });

  describe('forgotPassword', () => {
    it('sends a reset email with the frontend reset URL', async () => {
      const result = await service.forgotPassword({ email: 'user@example.com' });
      expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', {
        redirectTo: 'https://app.example.com/reset-password',
      });
      expect(result.message).toContain('If an account exists');
    });

    it.each([
      ['non-existent email', null],
      ['Supabase per-user rate limit', authError(429, 'over_email_send_rate_limit')],
      ['email service failure', authError(500, 'unexpected_failure')],
    ])('returns the same generic response for %s', async (_name, error) => {
      const expected = await service.forgotPassword({ email: 'a@example.com' });
      mocks.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error });
      await expect(service.forgotPassword({ email: 'b@example.com' })).resolves.toEqual(expected);
    });

    it('silently absorbs repeated requests for the same email', async () => {
      for (let i = 0; i < 5; i++) await service.forgotPassword({ email: 'user@example.com' });
      expect(mocks.resetPasswordForEmail).toHaveBeenCalledTimes(3);
    });

    it('returns 503 when Supabase cannot be reached', async () => {
      mocks.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: authError(undefined) });
      await expectStatus(service.forgotPassword({ email: 'user@example.com' }), 503);
    });

    // auth-js asal me SMTP failure (500) ko AuthRetryableFetchError ke naam se deta hai.
    it('does not reveal an SMTP failure (real auth-js error shape) as 503', async () => {
      const expected = await service.forgotPassword({ email: 'a@example.com' });
      mocks.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: retryableError(500, 'unexpected_failure') });
      await expect(service.forgotPassword({ email: 'b@example.com' })).resolves.toEqual(expected);
      expect(logs.some((line) => line.includes('SMTP Settings'))).toBe(true);
    });

    it.each([502, 503, 504, 522])('returns 503 when the Supabase gateway fails with %i', async (status) => {
      mocks.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: retryableError(status) });
      await expectStatus(service.forgotPassword({ email: 'user@example.com' }), 503);
    });
  });

  describe('resendConfirmation', () => {
    it('always returns a generic message', async () => {
      const ok = await service.resendConfirmation('user@example.com');
      mocks.resend.mockResolvedValueOnce({ data: {}, error: authError(429, 'over_email_send_rate_limit') });
      await expect(service.resendConfirmation('other@example.com')).resolves.toEqual(ok);
    });

    it('does not reveal an SMTP failure as 503', async () => {
      const ok = await service.resendConfirmation('user@example.com');
      mocks.resend.mockResolvedValueOnce({ data: {}, error: retryableError(500, 'unexpected_failure') });
      await expect(service.resendConfirmation('other@example.com')).resolves.toEqual(ok);
    });

    it('returns 503 when Supabase cannot be reached', async () => {
      mocks.resend.mockResolvedValueOnce({ data: {}, error: retryableError(0) });
      await expectStatus(service.resendConfirmation('user@example.com'), 503);
    });
  });

  describe('resetPassword', () => {
    beforeEach(() => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    });

    it('updates the password and revokes all sessions so the link cannot be reused', async () => {
      await expect(service.resetPassword({ accessToken: RECOVERY_TOKEN, password: PASSWORD })).resolves.toEqual({
        message: expect.stringContaining('Password reset successfully'),
      });
      expect(mocks.updatePassword).toHaveBeenCalledWith(RECOVERY_TOKEN, PASSWORD);
      expect(mocks.signOut).toHaveBeenCalledWith(RECOVERY_TOKEN, 'global');
    });

    it('rejects a normal login access token (not from a reset link)', async () => {
      await expectStatus(service.resetPassword({ accessToken: LOGIN_TOKEN, password: PASSWORD }), 401);
      expect(mocks.updatePassword).not.toHaveBeenCalled();
    });

    it.each([
      ['invalid token', authError(401, 'bad_jwt')],
      ['expired link', authError(401, 'bad_jwt')],
      ['already-used link (session revoked)', authError(403, 'session_not_found')],
      ['deleted user', authError(404, 'user_not_found')],
    ])('rejects an %s with 401', async (_name, error) => {
      mocks.getUser.mockResolvedValue({ data: { user: null }, error });
      await expectStatus(service.resetPassword({ accessToken: RECOVERY_TOKEN, password: PASSWORD }), 401);
      expect(mocks.updatePassword).not.toHaveBeenCalled();
    });

    it('handles a user deleted during the reset', async () => {
      mocks.updatePassword.mockResolvedValue({ status: 404, code: 'user_not_found' });
      await expectStatus(service.resetPassword({ accessToken: RECOVERY_TOKEN, password: PASSWORD }), 401);
    });

    it('rejects reusing the current password', async () => {
      mocks.updatePassword.mockResolvedValue({ status: 422, code: 'same_password' });
      await expectStatus(service.resetPassword({ accessToken: RECOVERY_TOKEN, password: PASSWORD }), 400);
    });

    it('returns 503 when Supabase is unavailable', async () => {
      mocks.getUser.mockResolvedValue({ data: { user: null }, error: authError(undefined) });
      await expectStatus(service.resetPassword({ accessToken: RECOVERY_TOKEN, password: PASSWORD }), 503);
    });
  });

  describe('refreshSession', () => {
    it('returns the rotated session', async () => {
      mocks.refreshSession.mockResolvedValue({
        data: {
          user: { id: 'u1', email: 'user@example.com' },
          session: { access_token: 'a2', refresh_token: 'r2', expires_at: 1, expires_in: 3600 },
        },
        error: null,
      });
      const result = await service.refreshSession({ refreshToken: 'r1' });
      expect(result.session).toEqual({ accessToken: 'a2', refreshToken: 'r2', expiresAt: 1, expiresIn: 3600 });
    });

    it.each([
      ['invalid refresh token', authError(400, 'refresh_token_not_found')],
      ['expired session', authError(400, 'session_expired')],
      ['revoked / already used token', authError(400, 'refresh_token_already_used')],
    ])('returns 401 for an %s', async (_name, error) => {
      mocks.refreshSession.mockResolvedValue({ data: { user: null, session: null }, error });
      await expectStatus(service.refreshSession({ refreshToken: 'bad' }), 401);
    });

    it('returns 503 on network failure', async () => {
      mocks.refreshSession.mockResolvedValue({ data: { user: null, session: null }, error: authError(undefined) });
      await expectStatus(service.refreshSession({ refreshToken: 'r1' }), 503);
    });
  });

  describe('logout', () => {
    it('revokes the session identified by the refresh token', async () => {
      mocks.refreshSession.mockResolvedValue({ data: { session: { access_token: 'fresh-access' } }, error: null });
      await expect(service.logout({ refreshToken: 'r1' })).resolves.toEqual({ message: 'Logout successful' });
      expect(mocks.signOut).toHaveBeenCalledWith('fresh-access', 'local');
    });

    it('succeeds for an already expired or invalid session', async () => {
      mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: authError(400, 'refresh_token_not_found') });
      await expect(service.logout({ refreshToken: 'expired' })).resolves.toEqual({ message: 'Logout successful' });
      expect(mocks.signOut).not.toHaveBeenCalled();
    });

    it('uses the bearer token when no refresh token is sent', async () => {
      await service.logout({}, 'bearer-access');
      expect(mocks.signOut).toHaveBeenCalledWith('bearer-access', 'local');
    });

    it('succeeds with no tokens at all', async () => {
      await expect(service.logout({})).resolves.toEqual({ message: 'Logout successful' });
    });

    it('returns 503 when Supabase cannot be reached', async () => {
      mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: authError(undefined) });
      await expectStatus(service.logout({ refreshToken: 'r1' }), 503);
    });
  });

  describe('changeEmail', () => {
    const user = { id: 'u1', email: 'old@example.com' } as any;

    it('starts the Supabase confirmation flow', async () => {
      mocks.requestEmailChange.mockResolvedValue({ status: 200 });
      const result = await service.changeEmail(user, 'access', { newEmail: 'new@example.com' });
      expect(mocks.requestEmailChange).toHaveBeenCalledWith('access', 'new@example.com', 'https://app.example.com/login');
      expect(result.message).toContain('confirm');
    });

    it('rejects the same email', async () => {
      await expectStatus(service.changeEmail(user, 'access', { newEmail: 'old@example.com' }), 400);
      expect(mocks.requestEmailChange).not.toHaveBeenCalled();
    });

    it.each([
      ['duplicate email', { status: 422, code: 'email_exists' }, 409],
      ['invalid email', { status: 400, code: 'email_address_invalid' }, 400],
      ['rate limited', { status: 429, code: 'over_email_send_rate_limit' }, 429],
      ['expired session', { status: 401, code: 'bad_jwt' }, 401],
      ['Supabase failure', { status: 500 }, 503],
      ['network failure', { status: 0 }, 503],
    ])('handles %s', async (_name, response, status) => {
      mocks.requestEmailChange.mockResolvedValue(response);
      await expectStatus(service.changeEmail(user, 'access', { newEmail: 'new@example.com' }), status);
    });
  });

  it('never writes passwords, tokens or emails to the logs', async () => {
    const secrets = [PASSWORD, 'refresh-secret', RECOVERY_TOKEN, 'victim@example.com'];
    mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: authError(500) });
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: authError(503) });
    mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: authError(undefined) });
    mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: authError(500) });
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mocks.updatePassword.mockResolvedValue({ status: 500 });

    const calls = [
      service.signup({ email: 'victim@example.com', password: PASSWORD }),
      service.login({ email: 'victim@example.com', password: PASSWORD }, '1.1.1.1'),
      service.refreshSession({ refreshToken: 'refresh-secret' }),
      service.forgotPassword({ email: 'victim@example.com' }),
      service.resetPassword({ accessToken: RECOVERY_TOKEN, password: PASSWORD }),
    ];
    await Promise.allSettled(calls);

    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      for (const secret of secrets) expect(line).not.toContain(secret);
    }
  });
});
