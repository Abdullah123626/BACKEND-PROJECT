import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.setup.js';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { RateLimitGuard } from '../src/common/guards/rate-limit.guard.js';
import { ProfilesController } from '../src/profiles/profiles.controller.js';
import { ProfilesService } from '../src/profiles/profiles.service.js';
import { SupabaseService } from '../src/supabase/supabase.service.js';

// Do alag users, har ek ka apna (JWT jaisa) access token
const TOKEN_A = 'header.user-a.signature';
const TOKEN_B = 'header.user-b.signature';

type Row = Record<string, unknown> & { id: string };

// In-memory Supabase: auth tokens + profiles table, RLS ki tarah sirf owner ki row.
class FakeSupabase {
  sessions = new Map<string, { id: string; email: string; app_metadata: Record<string, unknown> }>([
    [TOKEN_A, { id: 'user-a', email: 'a@example.com', app_metadata: {} }],
    [TOKEN_B, { id: 'user-b', email: 'b@example.com', app_metadata: { role: 'user' } }],
  ]);
  profiles = new Map<string, Row>([
    ['user-a', { id: 'user-a', full_name: 'User A', phone: null, avatar_url: null, bio: 'A bio', created_at: 't0', updated_at: 't0' }],
    ['user-b', { id: 'user-b', full_name: 'User B', phone: null, avatar_url: null, bio: 'B secret bio', created_at: 't0', updated_at: 't0' }],
  ]);
  signUpCalls: unknown[] = [];

  getClient() {
    return {
      auth: {
        getUser: async (token: string) => {
          const user = this.sessions.get(token);
          return user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: { status: 403, code: 'bad_jwt', message: 'invalid JWT' } };
        },
        resetPasswordForEmail: async () => ({ data: {}, error: null }),
        resend: async () => ({ data: {}, error: null }),
      },
    };
  }

  createAuthClient() {
    return {
      auth: {
        signUp: async (params: unknown) => {
          this.signUpCalls.push(params);
          return { data: { user: { id: 'new', identities: [{}] }, session: null }, error: null };
        },
        signInWithPassword: async () => ({
          data: { user: null, session: null },
          error: { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' },
        }),
        refreshSession: async () => ({
          data: { user: null, session: null },
          error: { status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token' },
        }),
      },
    };
  }

  // Logout: session server pe revoke
  async signOut(token: string) {
    this.sessions.delete(token);
    return { status: 204 };
  }

  async updatePassword() {
    return { status: 200 };
  }

  createUserClient(token: string) {
    const uid = this.sessions.get(token)?.id;
    return { from: () => new FakeQuery(this.profiles, uid) };
  }

  async requestEmailChange() {
    return { status: 200 };
  }
}

class FakeQuery {
  private op: 'select' | 'update' | 'insert' = 'select';
  private payload: Record<string, unknown> = {};
  private filters: Array<[string, unknown]> = [];

  constructor(
    private readonly table: Map<string, Row>,
    private readonly uid: string | undefined,
  ) {}

  select() {
    return this;
  }
  update(values: Record<string, unknown>) {
    this.op = 'update';
    this.payload = values;
    return this;
  }
  insert(values: Record<string, unknown>) {
    this.op = 'insert';
    this.payload = values;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  async single() {
    return this.run();
  }
  async maybeSingle() {
    return this.run();
  }

  private run() {
    // RLS: sirf wo rows jin ka id = auth.uid()
    const visible = [...this.table.values()].filter(
      (row) => row.id === this.uid && this.filters.every(([column, value]) => row[column] === value),
    );
    if (this.op === 'insert') {
      if (this.payload.id !== this.uid) return { data: null, error: { code: '42501' } };
      const created = { ...this.payload, id: this.uid, created_at: 'now', updated_at: 'now' } as Row;
      this.table.set(created.id, created);
      return { data: created, error: null };
    }
    if (this.op === 'update') {
      const target = visible[0];
      if (!target) return { data: null, error: null };
      Object.assign(target, this.payload, { updated_at: 'now' });
      return { data: target, error: null };
    }
    return { data: visible[0] ?? null, error: null };
  }
}

describe('Auth & Profile API (HTTP)', () => {
  let app: INestApplication;
  let supabase: FakeSupabase;

  beforeEach(async () => {
    supabase = new FakeSupabase();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ app: { corsOrigin: 'http://localhost:3000', frontendUrl: 'https://app.example.com' } })],
        }),
      ],
      controllers: [AuthController, ProfilesController],
      providers: [
        AuthService,
        ProfilesService,
        { provide: SupabaseService, useValue: supabase },
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('authentication guard', () => {
    it.each([
      ['missing token', undefined, 'Authentication required'],
      ['wrong scheme', 'Basic abc', 'Authentication required'],
      ['empty bearer', 'Bearer ', 'Authentication required'],
      ['malformed token', 'Bearer not-a-jwt', 'Invalid or expired access token'],
      ['invalid/expired token', 'Bearer aaa.bbb.ccc', 'Invalid or expired access token'],
    ])('rejects %s with 401', async (_name, header, message) => {
      const req = http().get('/profiles/me');
      if (header) req.set('Authorization', header);
      const response = await req.expect(401);
      expect(response.body.message).toBe(message);
      expect(JSON.stringify(response.body)).not.toMatch(/stack|at .*\.ts/);
    });
  });

  describe('user isolation (two users)', () => {
    it('each user only gets their own profile', async () => {
      const a = await http().get('/profiles/me').set('Authorization', `Bearer ${TOKEN_A}`).expect(200);
      const b = await http().get('/profiles/me').set('Authorization', `Bearer ${TOKEN_B}`).expect(200);

      expect(a.body).toMatchObject({ id: 'user-a', email: 'a@example.com', role: 'user' });
      expect(b.body).toMatchObject({ id: 'user-b', email: 'b@example.com' });
      expect(JSON.stringify(a.body)).not.toContain('B secret bio');
    });

    it('there is no endpoint that accepts another user id', async () => {
      await http().get('/profiles/user-b').set('Authorization', `Bearer ${TOKEN_A}`).expect(404);
      await http().patch('/profiles/user-b').set('Authorization', `Bearer ${TOKEN_A}`).send({ bio: 'x' }).expect(404);
    });

    it('a client-supplied id in the query string is ignored', async () => {
      await http()
        .patch('/profiles/me?id=user-b')
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ bio: 'changed by A' })
        .expect(200);
      expect(supabase.profiles.get('user-a')!.bio).toBe('changed by A');
      expect(supabase.profiles.get('user-b')!.bio).toBe('B secret bio');
    });

    it.each([
      ['change user id', { id: 'user-b', bio: 'x' }],
      ['assign admin role', { role: 'admin' }],
      ['assign admin flag', { is_admin: true }],
      ['modify email through profile', { email: 'hacker@example.com' }],
      ['modify timestamps', { created_at: '2000-01-01' }],
    ])('rejects an attempt to %s', async (_name, body) => {
      const response = await http()
        .patch('/profiles/me')
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send(body)
        .expect(400);
      expect(response.body.message).toEqual(expect.arrayContaining([expect.stringContaining('should not exist')]));
      expect(supabase.profiles.get('user-b')!.bio).toBe('B secret bio');
      expect(supabase.profiles.get('user-a')!.id).toBe('user-a');
    });
  });

  describe('profile updates', () => {
    it('supports partial updates and clears fields with null or empty string', async () => {
      const response = await http()
        .patch('/profiles/me')
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ fullName: '  Ali Khan ', bio: '', phone: '+92 300 1234567' })
        .expect(200);
      expect(response.body).toMatchObject({ full_name: 'Ali Khan', bio: null, phone: '+923001234567' });
    });

    it.each([
      ['empty body', {}],
      ['invalid phone', { phone: 'abc' }],
      ['very long bio', { bio: 'x'.repeat(10_000) }],
      ['wrong type', { fullName: ['array'] }],
    ])('rejects %s', async (_name, body) => {
      await http().patch('/profiles/me').set('Authorization', `Bearer ${TOKEN_A}`).send(body).expect(400);
    });

    it('creates a missing profile on first load', async () => {
      supabase.profiles.delete('user-a');
      const response = await http().get('/profiles/me').set('Authorization', `Bearer ${TOKEN_A}`).expect(200);
      expect(response.body).toMatchObject({ id: 'user-a', email: 'a@example.com' });
      expect(supabase.profiles.has('user-a')).toBe(true);
    });
  });

  describe('sessions', () => {
    it('a logged-out (revoked) access token can no longer be used', async () => {
      await http().get('/profiles/me').set('Authorization', `Bearer ${TOKEN_A}`).expect(200);
      await http().post('/auth/logout').set('Authorization', `Bearer ${TOKEN_A}`).send({}).expect(200);
      await http().get('/profiles/me').set('Authorization', `Bearer ${TOKEN_A}`).expect(401);
    });

    it('logout with an invalid refresh token still succeeds', async () => {
      await http().post('/auth/logout').send({ refreshToken: 'garbage' }).expect(200, { message: 'Logout successful' });
    });

    it('refresh with an invalid token returns 401', async () => {
      await http().post('/auth/refresh').send({ refreshToken: 'garbage' }).expect(401);
    });

    it('change-email requires authentication', async () => {
      await http().post('/auth/change-email').send({ newEmail: 'new@example.com' }).expect(401);
      await http()
        .post('/auth/change-email')
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .send({ newEmail: 'new@example.com' })
        .expect(200);
    });
  });

  describe('request validation', () => {
    it('normalizes email case and spaces before calling Supabase', async () => {
      await http().post('/auth/signup').send({ email: '  MixedCase@Example.COM ', password: 'Str0ng!Passw0rd' }).expect(201);
      expect(supabase.signUpCalls[0]).toMatchObject({ email: 'mixedcase@example.com' });
    });

    it.each([
      ['missing email', { password: 'Str0ng!Passw0rd' }],
      ['missing password', { email: 'a@example.com' }],
      ['invalid email', { email: 'nope', password: 'Str0ng!Passw0rd' }],
      ['weak password', { email: 'a@example.com', password: 'password' }],
      ['extremely long input', { email: `${'a'.repeat(5000)}@x.com`, password: 'Str0ng!Passw0rd' }],
      ['unexpected field', { email: 'a@example.com', password: 'Str0ng!Passw0rd', role: 'admin' }],
    ])('rejects signup with %s', async (_name, body) => {
      await http().post('/auth/signup').send(body).expect(400);
      expect(supabase.signUpCalls).toHaveLength(0);
    });

    it('rejects malformed JSON without crashing', async () => {
      await http().post('/auth/login').set('Content-Type', 'application/json').send('{"email":').expect(400);
      await http().get('/profiles/me').set('Authorization', `Bearer ${TOKEN_A}`).expect(200);
    });

    it('does not echo the submitted password in validation errors', async () => {
      const response = await http().post('/auth/signup').send({ email: 'a@example.com', password: 'weakpass1' }).expect(400);
      expect(JSON.stringify(response.body)).not.toContain('weakpass1');
    });
  });

  describe('abuse protection', () => {
    it('rate limits repeated login requests from one IP', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const response = await http().post('/auth/login').send({ email: `user${i}@example.com`, password: 'wrong' });
        statuses.push(response.status);
      }
      expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    });

    it('forgot-password gives the same answer for any email', async () => {
      const a = await http().post('/auth/forgot-password').send({ email: 'exists@example.com' }).expect(200);
      const b = await http().post('/auth/forgot-password').send({ email: 'missing@example.com' }).expect(200);
      expect(a.body).toEqual(b.body);
    });
  });
});
