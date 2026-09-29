import { HttpException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilesService } from './profiles.service.js';

const owner = { id: 'user-123', email: 'user@example.com', role: 'user' };
const row = {
  id: 'user-123',
  full_name: 'Ayesha Khan',
  phone: null,
  avatar_url: null,
  bio: null,
  created_at: '2026-09-25T00:00:00.000Z',
  updated_at: '2026-09-25T00:00:00.000Z',
};

// Supabase query builder ka chhota fake: har chain call record hoti hai.
function fakeQuery(result: { data: unknown; error: unknown }, calls: unknown[][]) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'update', 'insert']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = () => Promise.resolve(result);
  builder.single = () => Promise.resolve(result);
  return builder;
}

async function expectStatus(promise: Promise<unknown>, status: number) {
  const error = await promise.then(() => undefined, (thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(status);
}

describe('ProfilesService', () => {
  let results: Array<{ data: unknown; error: unknown }>;
  let calls: unknown[][];
  let tokens: string[];
  let service: ProfilesService;

  beforeEach(() => {
    results = [];
    calls = [];
    tokens = [];
    const supabaseService = {
      createUserClient: (token: string) => {
        tokens.push(token);
        return { from: (table: string) => { calls.push(['from', table]); return fakeQuery(results.shift()!, calls); } };
      },
    };
    service = new ProfilesService(supabaseService as any);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('loads the profile with the user token (RLS applies) and adds email/role', async () => {
    results.push({ data: row, error: null });
    await expect(service.getCurrentProfile(owner, 'user-token')).resolves.toMatchObject({
      id: 'user-123',
      email: 'user@example.com',
      role: 'user',
    });
    expect(tokens).toEqual(['user-token']);
    expect(calls).toContainEqual(['eq', 'id', 'user-123']);
  });

  it('creates an empty profile when it is missing', async () => {
    results.push({ data: null, error: null }, { data: row, error: null });
    await expect(service.getCurrentProfile(owner, 'user-token')).resolves.toMatchObject({ id: 'user-123' });
    expect(calls).toContainEqual(['insert', { id: 'user-123' }]);
  });

  it('returns 401 when the auth user was deleted (profile cannot be created)', async () => {
    results.push({ data: null, error: null }, { data: null, error: { code: '23503' } });
    await expectStatus(service.getCurrentProfile(owner, 'user-token'), 401);
  });

  it.each([
    ['database unreachable', { message: 'fetch failed', code: '' }, 503],
    ['internal database error', { message: 'relation "profiles" does not exist', code: '42P01' }, 500],
    ['expired JWT at the database', { code: 'PGRST303' }, 401],
  ])('handles %s without leaking details', async (_name, error, status) => {
    results.push({ data: null, error });
    const thrown = await service.getCurrentProfile(owner, 'user-token').catch((e: HttpException) => e);
    expect((thrown as HttpException).getStatus()).toBe(status);
    expect(JSON.stringify((thrown as HttpException).getResponse())).not.toContain('relation');
  });

  it('updates only allowed fields for the token owner', async () => {
    results.push({ data: { ...row, bio: 'Hi' }, error: null });
    await service.updateCurrentProfile(owner, 'user-token', { bio: 'Hi', fullName: null });
    expect(calls).toContainEqual(['update', { bio: 'Hi', full_name: null }]);
    expect(calls).toContainEqual(['eq', 'id', 'user-123']);
  });

  it('rejects an empty update', async () => {
    await expectStatus(service.updateCurrentProfile(owner, 'user-token', {}), 400);
  });

  it('creates the profile with the update when it was missing', async () => {
    results.push({ data: null, error: null }, { data: { ...row, bio: 'Hi' }, error: null });
    await service.updateCurrentProfile(owner, 'user-token', { bio: 'Hi' });
    expect(calls).toContainEqual(['insert', { id: 'user-123', bio: 'Hi' }]);
  });

  it('maps constraint violations to 400', async () => {
    results.push({ data: null, error: { code: '23514' } });
    await expectStatus(service.updateCurrentProfile(owner, 'user-token', { bio: 'x' }), 400);
  });
});
