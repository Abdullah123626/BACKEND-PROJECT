import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ChangeEmailDto } from '../../auth/dto/change-email.dto.js';
import { ForgotPasswordDto } from '../../auth/dto/forgot.password.dto.js';
import { LoginDto } from '../../auth/dto/login.dto.js';
import { LogoutDto } from '../../auth/dto/logout.dto.js';
import { ResetPasswordDto } from '../../auth/dto/reset-password.dto.js';
import { SignupDto } from '../../auth/dto/signup.dto.js';
import { UpdateProfileDto } from '../../profiles/dto/update-profile.dto.js';

// ValidationPipe jaisi settings (main app me bhi yahi hain)
async function check<T extends object>(cls: new () => T, body: unknown) {
  const instance = plainToInstance(cls, body);
  const errors = await validate(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { instance, errors, fields: errors.map((error) => error.property) };
}

const STRONG = 'Str0ng!Passw0rd';

describe('SignupDto', () => {
  it('accepts a valid email and strong password', async () => {
    const { errors } = await check(SignupDto, { email: 'user@example.com', password: STRONG });
    expect(errors).toHaveLength(0);
  });

  it('normalizes uppercase email and leading/trailing spaces', async () => {
    const { instance, errors } = await check(SignupDto, {
      email: '  User.Name@Example.COM  ',
      password: STRONG,
    });
    expect(errors).toHaveLength(0);
    expect(instance.email).toBe('user.name@example.com');
  });

  it.each([
    ['missing email', { password: STRONG }, 'email'],
    ['missing password', { email: 'user@example.com' }, 'password'],
    ['invalid email', { email: 'not-an-email', password: STRONG }, 'email'],
    ['empty email', { email: '   ', password: STRONG }, 'email'],
    ['email as number', { email: 12345, password: STRONG }, 'email'],
    ['weak password (short)', { email: 'user@example.com', password: 'Ab1!' }, 'password'],
    ['weak password (no symbol)', { email: 'user@example.com', password: 'Abcdefgh12345' }, 'password'],
    ['weak password (no uppercase)', { email: 'user@example.com', password: 'abcdefgh123!@' }, 'password'],
    ['password with spaces', { email: 'user@example.com', password: 'Str0ng! Passw0rd' }, 'password'],
    ['password too long', { email: 'user@example.com', password: `Aa1!${'x'.repeat(80)}` }, 'password'],
    ['email too long', { email: `${'a'.repeat(250)}@example.com`, password: STRONG }, 'email'],
    ['null password', { email: 'user@example.com', password: null }, 'password'],
  ])('rejects %s', async (_name, body, field) => {
    const { fields } = await check(SignupDto, body);
    expect(fields).toContain(field);
  });

  it('rejects unexpected fields such as role or id', async () => {
    const { fields } = await check(SignupDto, {
      email: 'user@example.com',
      password: STRONG,
      role: 'admin',
      id: 'someone-else',
    });
    expect(fields).toEqual(expect.arrayContaining(['role', 'id']));
  });

  it('never includes the password value in validation errors', async () => {
    const { errors } = await check(SignupDto, { email: 'user@example.com', password: 'weakpass' });
    expect(JSON.stringify(errors.map((error) => error.constraints))).not.toContain('weakpass');
  });
});

describe('LoginDto', () => {
  it('does not apply the signup policy (old passwords still work) but requires a value', async () => {
    expect((await check(LoginDto, { email: 'user@example.com', password: 'anything' })).errors).toHaveLength(0);
    expect((await check(LoginDto, { email: 'user@example.com', password: '' })).fields).toContain('password');
  });

  it('normalizes the email', async () => {
    const { instance } = await check(LoginDto, { email: ' USER@example.com ', password: 'x' });
    expect(instance.email).toBe('user@example.com');
  });
});

describe('ForgotPasswordDto / ChangeEmailDto', () => {
  it('validates and normalizes email', async () => {
    expect((await check(ForgotPasswordDto, { email: 'bad' })).fields).toContain('email');
    expect((await check(ForgotPasswordDto, {})).fields).toContain('email');
    expect((await check(ChangeEmailDto, { newEmail: ' New@Example.com ' })).instance.newEmail).toBe('new@example.com');
  });
});

describe('ResetPasswordDto', () => {
  it('applies the same password policy as signup', async () => {
    expect((await check(ResetPasswordDto, { accessToken: 'token', password: STRONG })).errors).toHaveLength(0);
    expect((await check(ResetPasswordDto, { accessToken: 'token', password: 'weak' })).fields).toContain('password');
  });

  it('rejects a missing or malformed reset token', async () => {
    expect((await check(ResetPasswordDto, { password: STRONG })).fields).toContain('accessToken');
    expect((await check(ResetPasswordDto, { accessToken: 42, password: STRONG })).fields).toContain('accessToken');
    expect((await check(ResetPasswordDto, { accessToken: 'x'.repeat(5000), password: STRONG })).fields).toContain('accessToken');
  });
});

describe('LogoutDto', () => {
  it('allows logout without a refresh token', async () => {
    expect((await check(LogoutDto, {})).errors).toHaveLength(0);
  });
});

describe('UpdateProfileDto', () => {
  it('accepts a partial update', async () => {
    const { errors, instance } = await check(UpdateProfileDto, { bio: '  Backend developer  ' });
    expect(errors).toHaveLength(0);
    expect(instance.bio).toBe('Backend developer');
  });

  it('treats empty strings and null the same way (clear the field)', async () => {
    const { errors, instance } = await check(UpdateProfileDto, {
      fullName: '   ',
      bio: null,
      phone: '',
      avatarUrl: null,
    });
    expect(errors).toHaveLength(0);
    expect(instance).toMatchObject({ fullName: null, bio: null, phone: null, avatarUrl: null });
  });

  it('normalizes phone numbers to international format', async () => {
    const { errors, instance } = await check(UpdateProfileDto, { phone: '+92 300-123 4567' });
    expect(errors).toHaveLength(0);
    expect(instance.phone).toBe('+923001234567');
  });

  it.each([
    ['local phone without country code', { phone: '03001234567' }, 'phone'],
    ['phone with letters', { phone: '+92abc1234567' }, 'phone'],
    ['phone too short', { phone: '+12' }, 'phone'],
    ['very long full name', { fullName: 'a'.repeat(101) }, 'fullName'],
    ['very long bio', { bio: 'b'.repeat(501) }, 'bio'],
    ['invalid avatar url', { avatarUrl: 'javascript:alert(1)' }, 'avatarUrl'],
    ['non-string full name', { fullName: 123 }, 'fullName'],
    ['control characters in name', { fullName: 'Ali\u0000Khan' }, 'fullName'],
  ])('rejects %s', async (_name, body, field) => {
    const { fields } = await check(UpdateProfileDto, body);
    expect(fields).toContain(field);
  });

  it.each([
    ['id'],
    ['role'],
    ['email'],
    ['is_admin'],
    ['created_at'],
    ['updated_at'],
    ['user_id'],
  ])('rejects the protected/unexpected field "%s"', async (field) => {
    const { fields } = await check(UpdateProfileDto, { fullName: 'Ali', [field]: 'x' });
    expect(fields).toContain(field);
  });
});
