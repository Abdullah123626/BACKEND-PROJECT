# Authentication & Profile Architecture

NestJS backend with Supabase Auth and a Supabase Postgres `profiles` table. This document covers the authentication flow, password recovery, sessions, the user/profile relationship, authorization, RLS, validation, error handling, security and the known limitations.

The endpoint contract for the frontend is in [FRONTEND_HANDOFF.md](FRONTEND_HANDOFF.md).

---

## 1. Components

| Piece | File | Responsibility |
| --- | --- | --- |
| `AuthController` / `AuthService` | `src/auth/` | Signup, login, refresh, logout, forgot/reset password, email change |
| `ProfilesController` / `ProfilesService` | `src/profiles/` | Current user's profile (read / partial update) |
| `SupabaseAuthGuard` | `src/common/guards/supabase-auth.guard.ts` | Validates the bearer access token with Supabase and sets the request identity |
| `RateLimitGuard` | `src/common/guards/rate-limit.guard.ts` | Global per-IP, per-route rate limiting (stricter on auth routes) |
| `HttpExceptionFilter` | `src/common/filters/http-exception.filter.ts` | One safe error shape; never leaks internals or stack traces |
| `SupabaseService` | `src/supabase/supabase.service.ts` | Supabase clients and the few direct Supabase Auth REST calls |
| Migrations | `supabase/migrations/` | `profiles` table, trigger, RLS policies, column privileges |

### Keys used by the backend

The backend uses **only the Supabase anon key**. Every privileged operation (updating a password, signing out a session, reading or updating a profile) runs with **the user's own access token**, so Supabase Auth and Postgres RLS enforce what the user may do. The service-role key (which bypasses RLS) is **not needed by the application**. It is only used, optionally, by the RLS integration test to create and delete test users.

---

## 2. Authentication flow

### 2.1 Signup: `POST /auth/signup`

1. The DTO validates the body. The email is trimmed and lowercased; the password must meet the policy (section 8). Unknown fields are rejected.
2. `supabase.auth.signUp()` runs on a **fresh client per request**, so a session can never be shared across users. `emailRedirectTo` = `FRONTEND_URL/login`.
3. Supabase stores the password hash. **The application never stores passwords.**
4. The `on_auth_user_created` trigger (migration 003) creates the matching `profiles` row.
5. With **Confirm email** enabled (required), Supabase sends a verification email and returns no session. The response is:
   ```json
   { "message": "Account created. Please check your email and verify your account before logging in.", "requiresEmailConfirmation": true }
   ```
6. **Duplicate email:** Supabase returns an obfuscated user without identities. The backend returns **exactly the same response** as for a new account, so signup cannot be used to discover registered emails. No second account is created.

If Confirm email is disabled in Supabase, the backend:
- logs a startup warning,
- revokes the automatically created session (it is never returned to the client),
- returns `requiresEmailConfirmation: false`,
- returns `409` for duplicates, because Supabase reports them directly in that mode.

This mode is **not** the intended configuration. See section 11.

### 2.2 Email verification

The user clicks the Supabase link, and Supabase marks the email as confirmed and redirects to `FRONTEND_URL/login`. `POST /auth/resend-confirmation` resends the link. It always returns the same generic message, and repeated requests are silently absorbed (section 9).

### 2.3 Login: `POST /auth/login`

1. Per-IP-and-email lockout check (section 9).
2. `signInWithPassword` runs on a fresh client.
3. Result mapping:

| Situation | Response |
| --- | --- |
| Success, email confirmed | `200` with `user` (id, email, emailConfirmedAt) and `session` (access and refresh token) |
| Wrong password, unknown email, deleted user, disabled (banned) user | `401 Invalid email or password`. Always the same message, so account existence is never revealed. Counts as a failed attempt. |
| Correct password but email not verified | `403 Please verify your email before logging in` (Supabase only reports this after the password matched) |
| Session issued but `email_confirmed_at` is empty (defense in depth) | The session is revoked, then `403` |
| Too many failed attempts | `429` with the minutes to wait |
| Supabase unreachable or 5xx | `503` |

Responses never contain the password. Tokens only appear in the `session` object of login and refresh.

---

## 3. Authorization

- Protected routes use `SupabaseAuthGuard`: `GET/PATCH /profiles/me` and `POST /auth/change-email`.
- The guard requires an `Authorization: Bearer <token>` header in JWT shape (at most 4096 chars) and validates it with `supabase.auth.getUser(token)` **on the Supabase server**. That check covers the signature, expiry, a **revoked session** (after logout or password reset) and a **deleted user**.

| Token state | Response |
| --- | --- |
| Missing, wrong scheme, empty | `401 Authentication required` |
| Malformed, invalid, expired, revoked, deleted user | `401 Invalid or expired access token` |
| Supabase unreachable | `503` (a system error, kept separate from auth errors) |

- **Identity comes only from the validated token.** No endpoint accepts a user ID. `/profiles/me` has no `:id` variant, and body or query IDs are rejected or ignored.
- `role` comes from Supabase `app_metadata`, which users cannot write. It is read-only in API responses and can never be set through the API.

---

## 4. Session & token handling

| Operation | Behaviour |
| --- | --- |
| Access token | Short-lived Supabase JWT (default 1 hour), sent as a Bearer header |
| `POST /auth/refresh` | `refreshSession` on a fresh client. Returns the rotated access and refresh tokens. The client **must** replace both. |
| Invalid, expired, revoked or already-used refresh token | `401 Your session has expired. Please log in again` |
| `POST /auth/logout` | Accepts `refreshToken` in the body and/or a Bearer header. Revokes **this session** (`scope=local`) on Supabase. An already expired or invalid session still returns `200 Logout successful`. |
| After logout | The same access token is rejected by the guard because Supabase reports the session as not found. The refresh token no longer works. |
| After a password reset | **All** sessions of the user are revoked (`scope=global`) |

Tokens are never logged (section 10). The backend never keeps a user session in memory: auth calls use a new Supabase client per request, and database calls use a client bound to the caller's token.

---

## 5. Password recovery

### 5.1 Forgot password: `POST /auth/forgot-password`

- Validates and normalizes the email.
- Calls `resetPasswordForEmail(email, { redirectTo: FRONTEND_URL/reset-password })`.
- **Always** returns `200 "If an account exists for this email, a password reset link has been sent."`. That covers existing, non-existent, deleted and unavailable accounts, Supabase's per-user rate limit, and email-sending failures, because each of those outcomes would otherwise reveal whether the account exists. Failures are logged (code only) for operators.
- Only a network failure to Supabase returns `503`. It affects every email equally, so it reveals nothing.
- Repeated requests: after 3 per email in 15 minutes, the backend silently stops calling Supabase and still returns the same message.

### 5.2 Reset password: `POST /auth/reset-password`

The reset link takes the user to `/reset-password` with a recovery session. The frontend sends `{ accessToken, password }`.

1. The DTO applies **the same password policy as signup**.
2. `getUser(accessToken)` validates the token server-side.
3. The token's `amr` claim must show it came from an email link (`recovery`, `otp` or `magiclink`). A **normal login token is rejected**, so a stolen access token cannot be used to change the password without the email.
4. The password is updated with the user's own recovery token (`PUT /auth/v1/user`).
5. **All sessions are revoked** (`scope=global`), including the recovery session. The same link therefore **cannot be used again**, and any attacker sessions are killed.

| Situation | Response |
| --- | --- |
| Invalid, malformed or expired link or token | `401` "This password reset link is invalid, expired or has already been used…" |
| Already-used link (session revoked) | same `401` |
| User deleted during the reset | same `401` |
| Weak new password | `400` (policy message) |
| New password equals the current one | `400` |
| Supabase unavailable | `503` |

**Multiple active reset requests:** each forgot-password request makes Supabase issue a new recovery token, which **replaces** the previous one. Only the latest email link works. Older links return `401`. Once any reset succeeds, every session (including other open recovery sessions) is revoked.

---

## 6. Email change: `POST /auth/change-email` (protected)

- Email is **not** a profile field. `PATCH /profiles/me` rejects `email`.
- The endpoint calls Supabase's user update with the caller's token. Supabase sends confirmation links; with "Secure email change" enabled, links go to both the old and the new address. **The email only changes after confirmation.** The backend never writes `auth.users` directly.

| Situation | Response |
| --- | --- |
| Same as the current email | `400` |
| Invalid email | `400` |
| Email already used by another account | `409` |
| Too many requests | `429` |
| Expired session | `401` |
| Supabase unavailable | `503` |

Invalid or expired confirmation links are handled by Supabase on the link itself; the user can start the change again.

---

## 7. User / profile relationship & database

`public.profiles` (migrations 001–004):

| Column | Notes |
| --- | --- |
| `id uuid primary key references auth.users(id) on delete cascade` | Exactly one profile per auth user. It is removed automatically when the auth user is deleted. |
| `full_name`, `phone`, `avatar_url`, `bio` | Application data, with length CHECK constraints in the database too |
| `created_at`, `updated_at` | `updated_at` is maintained by the `profiles_set_updated_at` trigger |

- No email, password or role is duplicated in `profiles`. Email and role are read from the verified auth user at request time.
- The profile is created by a trigger on `auth.users` insert. If a profile is ever missing (for example an account created before the trigger existed), `GET /profiles/me` creates an empty one. If the auth user no longer exists, the response is `401`.

### Row Level Security

- RLS is enabled on `profiles`.
- Policies for `authenticated`: **select, insert, update only where `auth.uid() = id`**. There is no delete policy.
- **Column privileges** (migration 004): `authenticated` may insert `(id, full_name, phone, avatar_url, bio)` and update only `(full_name, phone, avatar_url, bio)`. So even through direct database access with their own token, a user cannot change `id`, `created_at` or `updated_at`, and cannot write another user's row.
- `anon` has no access to `profiles`.
- **The backend does not bypass RLS.** Profile queries run with the caller's access token, never the service-role key. A bug in backend code therefore still cannot expose another user's row.

Apply migrations in order in Supabase Dashboard > SQL Editor: `001` → `002` → `003` → `004`.

---

## 8. Validation rules

A global `ValidationPipe` uses `whitelist` + `forbidNonWhitelisted` + `transform`, so every body is validated and **unknown fields are rejected** with `400 "property X should not exist"`. Validation errors never echo submitted values.

| Field | Rule |
| --- | --- |
| Email (signup, login, forgot, resend, change) | Required string, trimmed, lowercased, valid format, ≤ 254 chars |
| Password (signup, reset) | 12–72 chars, at least 1 uppercase, 1 lowercase, 1 number and 1 symbol, no spaces. The 72 limit matches bcrypt's input limit. |
| Password (login) | Required, ≤ 72 chars. The policy is not re-checked, so older passwords still work. |
| Refresh token | Required string, ≤ 2048 chars (optional for logout) |
| Reset token | Required string, ≤ 4096 chars |
| `fullName` | ≤ 100 chars, single line, no control characters |
| `phone` | International format, normalized: `"+92 300-123 4567"` → `"+923001234567"` (a `+`, then 7–15 digits) |
| `avatarUrl` | `http`/`https` URL, ≤ 2048 chars |
| `bio` | ≤ 500 chars, newlines allowed, no other control characters |
| Profile update | Partial. At least one field required. **`null`, `""` and whitespace-only all clear the field (stored as `null`).** |
| Profile protected fields | `id`, `user_id`, `email`, `role`, `is_admin`, `created_at`, `updated_at` and any other unknown field → `400` |

Malformed JSON returns `400` and does not crash the app.

---

## 9. Abuse protection

| Mechanism | Limit |
| --- | --- |
| Global per IP + route | 60 requests/min by default |
| `POST /auth/login` | 10 requests/min per IP |
| `POST /auth/signup`, `forgot-password`, `resend-confirmation`, `reset-password`, `change-email` | 5 per 15 min per IP |
| `POST /auth/refresh`, `logout` | 30/min per IP |
| Failed logins | 5 failures per **IP + email** in 15 min lock that pair out (`429`). Keying on IP + email means an attacker cannot lock a victim out from every location. |
| Forgot password / resend | 3 per email per 15 min, then silently ignored with the same response |
| Supabase built-in limits | Still apply underneath (email sending, token refresh, sign-in) |

The client IP comes from Express `trust proxy = 1`: the address added by the hosting proxy (Vercel or Render). A client-supplied `X-Forwarded-For` header cannot be used to bypass the limits.

---

## 10. Error handling & sensitive data

Every error uses one shape:

```json
{ "statusCode": 401, "message": "Invalid or expired access token", "error": "Unauthorized", "path": "/profiles/me", "timestamp": "..." }
```

| Class | Status |
| --- | --- |
| Validation | `400` |
| Authentication (missing, invalid or expired token, bad credentials) | `401` |
| Forbidden (unverified email, signups disabled) | `403` |
| Duplicate email on email change | `409` |
| Rate limited | `429` |
| Unexpected server error | `500` "Internal server error" |
| Supabase or database unreachable | `503` |

- Supabase and Postgres error messages are **never** returned to clients. They are translated into fixed, safe messages.
- **Logs contain no** passwords, access, refresh or reset tokens, keys, emails, request bodies, database error text or stack traces. Only the Supabase error `status`/`code`, the Postgres error `code`, or `Unhandled <ErrorName> on <METHOD> <path>` are logged.
- The `path` in error responses excludes the query string, so a token in a URL never appears in a response.
- Secrets live only in environment variables. `.env` is git-ignored, and `.env.example` contains no values.
- `helmet` sets security headers. CORS allows only the origins listed in `CORS_ORIGIN` (comma-separated).

---

## 11. Required Supabase configuration

1. **Authentication > Sign In / Providers > Email: "Confirm email" = ON.** Without it, Supabase creates accounts without verification. The backend cannot enforce verification in that mode, and it logs a startup warning.
2. **"Allow new users to sign up" = ON.**
3. **Custom SMTP** (Authentication > Emails > SMTP Settings). Supabase's built-in mailer only sends to project team members and has a very low hourly limit. Without SMTP, other users never receive verification or reset emails.
4. **URL Configuration:** Site URL = the frontend URL. Redirect URLs must include `<frontend>/login` and `<frontend>/reset-password`.
5. **Secure email change = ON** (the default).
6. Run migrations `001`–`004`.

---

## 12. Testing

| Suite | Command | Covers |
| --- | --- | --- |
| Unit and HTTP (no network) | `npm test` | DTO validation edge cases, `AuthService` (every Supabase outcome), `ProfilesService`, the error filter, and the full HTTP stack (guards, pipes, filter, rate limiting) with two users against an RLS-emulating fake |
| Real-database RLS | `RUN_RLS_TESTS=1 npm run test:e2e` | Two real users: own-row read/update, cross-user read/update blocked, id/timestamp changes blocked, foreign insert blocked, delete blocked, anon blocked, cascade on user delete. Needs `SUPABASE_SERVICE_ROLE_KEY` locally. Creates and then deletes throwaway users. |

Edge cases from the requirements covered by the tests include: duplicate signup; email case and whitespace variations; invalid or missing email; missing, weak or too-long password; extremely long input; wrong credentials; unverified email; deleted and disabled users; missing, malformed, invalid, expired and revoked tokens; invalid, expired and revoked refresh tokens; repeated logins (lockout); repeated forgot-password requests; non-existent email; invalid, expired and already-used reset links; weak new password; missing profile; database and Supabase failures; access to or update of another user's profile; changing the user ID; assigning an admin role; unexpected fields; invalid, empty and null profile data; email changes through the profile; and sensitive data in logs.

---

## 13. Decisions & limitations

- **Rate limits and lockouts are in memory, per server instance.** On serverless or multi-instance hosting (Vercel), counters are not shared and reset on cold start. Supabase's own limits still apply. For strict guarantees, move `AttemptCounter` to a shared store such as Redis or Upstash.
- **Logout revokes only the current session** (`local`). A password reset revokes all sessions (`global`).
- **Already-issued access tokens:** revocation is enforced because the guard validates every request with Supabase (`getUser`). That costs one Supabase round-trip per protected request, in exchange for immediate revocation.
- **Duplicate signup** looks like success to the caller (anti-enumeration). A legitimate user who already has an account can use "forgot password".
- **Disabled (banned) users** get the same `401` as wrong credentials, so account state is not revealed.
- **Phone numbers** must use international format (`+` and country code).
- **Password policy** applies to new passwords only. Existing accounts with older, weaker passwords can still log in, but must meet the policy on their next reset.
