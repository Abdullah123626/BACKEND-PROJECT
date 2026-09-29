import { randomUUID } from 'node:crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Asli Supabase database pe RLS test (do users). Ye test users banata aur aakhir me
// delete karta hai, is liye sirf tab chalta hai jab jaan boojh kar enable ho:
//   RUN_RLS_TESTS=1 npm run test:e2e
// Zaroori env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// (service-role key sirf test users banane/mitane ke liye; app use nahi karti).
try {
  process.loadEnvFile('.env');
} catch {
  // .env na ho to environment variables se
}

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === '1' && !!url && !!anonKey && !!serviceKey;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

type TestUser = { id: string; client: SupabaseClient };

describe.skipIf(!enabled)('RLS on public.profiles (real Supabase, two users)', () => {
  let admin: SupabaseClient;
  const users: TestUser[] = [];

  async function createUser(label: string): Promise<TestUser> {
    const email = `rls-test-${label}-${randomUUID()}@example.com`;
    const password = `Rls!${randomUUID()}A1`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.code}`);

    const { data: login, error: loginError } = await createClient(url!, anonKey!, noSession)
      .auth.signInWithPassword({ email, password });
    if (loginError || !login.session) throw new Error(`login failed: ${loginError?.code}`);

    const client = createClient(url!, anonKey!, {
      ...noSession,
      global: { headers: { Authorization: `Bearer ${login.session.access_token}` } },
    });
    return { id: data.user.id, client };
  }

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, noSession);
    users.push(await createUser('a'), await createUser('b'));
  }, 30_000);

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  it('trigger creates exactly one profile per auth user', async () => {
    for (const user of users) {
      const { data } = await admin.from('profiles').select('id').eq('id', user.id);
      expect(data).toHaveLength(1);
    }
  });

  it('a user can read only their own profile', async () => {
    const [a, b] = users;
    const own = await a.client.from('profiles').select('id').eq('id', a.id);
    expect(own.data).toEqual([{ id: a.id }]);

    const other = await a.client.from('profiles').select('id').eq('id', b.id);
    expect(other.data).toEqual([]);

    const all = await a.client.from('profiles').select('id');
    expect(all.data).toEqual([{ id: a.id }]);
  });

  it("a user cannot update another user's profile", async () => {
    const [a, b] = users;
    const { data } = await a.client.from('profiles').update({ bio: 'hacked' }).eq('id', b.id).select();
    expect(data ?? []).toEqual([]);

    const check = await admin.from('profiles').select('bio').eq('id', b.id).single();
    expect(check.data?.bio).not.toBe('hacked');
  });

  it('a user can update their own allowed fields', async () => {
    const [a] = users;
    const { data, error } = await a.client.from('profiles').update({ bio: 'mine' }).eq('id', a.id).select('bio');
    expect(error).toBeNull();
    expect(data).toEqual([{ bio: 'mine' }]);
  });

  it('a user cannot change their profile id or timestamps (column privileges)', async () => {
    const [a, b] = users;
    const idChange = await a.client.from('profiles').update({ id: b.id }).eq('id', a.id);
    expect(idChange.error).not.toBeNull();

    const timestamp = await a.client.from('profiles').update({ created_at: '2000-01-01' }).eq('id', a.id);
    expect(timestamp.error).not.toBeNull();
  });

  it('a user cannot create a profile for someone else', async () => {
    const [a] = users;
    const { error } = await a.client.from('profiles').insert({ id: randomUUID() });
    expect(error).not.toBeNull();
  });

  it('a user cannot delete profiles directly', async () => {
    const [a] = users;
    await a.client.from('profiles').delete().eq('id', a.id);
    const check = await admin.from('profiles').select('id').eq('id', a.id);
    expect(check.data).toHaveLength(1);
  });

  it('anonymous requests cannot read profiles', async () => {
    const anon = createClient(url!, anonKey!, noSession);
    const { data } = await anon.from('profiles').select('id');
    expect(data ?? []).toEqual([]);
  });

  it('deleting the auth user removes the profile (cascade)', async () => {
    const temp = await createUser('cascade');
    await admin.auth.admin.deleteUser(temp.id);
    const { data } = await admin.from('profiles').select('id').eq('id', temp.id);
    expect(data).toEqual([]);
  });
});
