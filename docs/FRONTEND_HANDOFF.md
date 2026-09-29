# Backend API Frontend Handoff

This document is the complete integration guide for the frontend team.

## 1. Environments

Backend base URLs:

- Local: `http://localhost:3000`
- Production: use the deployed backend URL, for example `https://api.example.com`

The frontend should keep the URL in an environment variable, not hard-code it in components.

Example frontend environment variables:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

For Vite:

```env
VITE_API_URL=http://localhost:3000
```

The backend environment variables are separate:

```env
NODE_ENV=production
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
# Comma-separated list allowed, e.g. https://app.example.com,http://localhost:3000
CORS_ORIGIN=https://your-frontend.example.com
FRONTEND_URL=https://your-frontend.example.com
```

The backend only needs the Supabase anon key. Never put the Supabase service-role key anywhere in the frontend (or the backend); it bypasses all database security.

## 2. Authentication Rules

The backend uses Supabase Auth. The frontend receives an access token from login and sends it to protected endpoints:

```http
Authorization: Bearer <accessToken>
```

Protected routes:

- `GET /profiles/me`
- `PATCH /profiles/me`
- `POST /auth/change-email`

Public routes:

- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/resend-confirmation`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/refresh`
- `POST /auth/logout`

Recommended client behavior:

1. Login and keep the returned `accessToken` and `refreshToken`.
2. Send the access token on every profile request.
3. When an API request returns `401`, call `/auth/refresh` once.
4. Replace both stored tokens with the new session tokens.
5. Retry the original request once.
6. If refresh fails, clear auth state and send the user to login.
7. Never retry a failed refresh recursively.

The supplied API client accepts an `onSessionExpired` callback. Use it in the frontend auth provider to clear user state and redirect to `/login` after refresh fails. This keeps the behavior centralized instead of duplicating it in every page.

For better browser security, keep tokens in memory when possible. If persistence across page reloads is required, use a carefully reviewed storage strategy and never log tokens.

## 3. API Contract

All requests use JSON:

```http
Content-Type: application/json
```

### 3.1 Sign up

`POST /auth/signup`

Request:

```json
{
  "email": "user@example.com",
  "password": "StrongPass!123"
}
```

Rules:

- Email is trimmed and lowercased by the backend.
- Password must be 12 to 72 characters.
- Password must contain at least one lowercase letter, uppercase letter, number, and symbol.
- Password cannot contain spaces.
- Unknown fields are rejected.

Success: `201 Created`

```json
{
  "message": "Account created. Please check your email and verify your account before logging in.",
  "requiresEmailConfirmation": true
}
```

Signup returns no user object and no session. A **duplicate email gets exactly the same response** (the backend does not reveal registered emails); tell users who already have an account to use "Forgot password".

The frontend should always treat signup as a verification-pending state. Show a check-email screen and send the user to the login screen only after they verify the email. The backend does not allow an unverified user to log in.

### 3.2 Email confirmation

Supabase sends the confirmation email after signup. The frontend should not create an authenticated session from signup; it should show a check-email state.

If the user does not receive the email, call `POST /auth/resend-confirmation`:

```json
{
  "email": "user@example.com"
}
```

Success: `200 OK`

```json
{
  "message": "If the account exists, a confirmation email has been sent."
}
```

After the user clicks the confirmation link, redirect to `/login` and perform a normal login.

### 3.3 Login

`POST /auth/login`

Request:

```json
{
  "email": "user@example.com",
  "password": "StrongPass!123"
}
```

Success: `200 OK`

```json
{
  "message": "Login successful",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "emailConfirmedAt": "2026-09-18T10:00:00.000Z"
  },
  "session": {
    "accessToken": "supabase-access-token",
    "refreshToken": "supabase-refresh-token",
    "expiresAt": 1770000000,
    "expiresIn": 3600
  }
}
```

Store the session in the frontend auth state. Do not display tokens to the user.

Unverified login: `403 Forbidden`

```json
{
  "statusCode": 403,
  "message": "Please verify your email before logging in",
  "error": "Forbidden"
}
```

### 3.3 Forgot password

`POST /auth/forgot-password`

Request:

```json
{
  "email": "user@example.com"
}
```

Success: `200 OK`

```json
{
  "message": "If an account exists, a password reset email has been sent."
}
```

The message is intentionally generic. The frontend should show the same confirmation message whether or not the email exists.

The backend asks Supabase to send the email with this redirect:

```text
<FRONTEND_URL>/reset-password
```

The frontend must have a `/reset-password` page.

### 3.4 Reset password

`POST /auth/reset-password`

The password reset link from Supabase normally contains the access token in the URL hash. On the reset page, read `access_token` from `window.location.hash`, then send:

```json
{
  "accessToken": "token-from-reset-link",
  "password": "NewStrongPass!123"
}
```

Success: `200 OK`

```json
{
  "message": "Password reset successfully. Please log in with your new password."
}
```

Rules for the new password are the same as signup, and it must differ from the current password. After success, **all sessions of the user are logged out** (including the reset link's session, so the link cannot be reused). Clear the token from the URL and redirect the user to login.

Only the token from the reset email is accepted; a normal login access token is rejected. An invalid, expired, already-used or superseded link (only the latest reset email works) returns `401`. Show a "request a new link" message in that case.

Do not send the refresh token to this endpoint. Do not put the access token in application logs, analytics, query strings, or error reports.

### 3.5 Refresh session

`POST /auth/refresh`

Request:

```json
{
  "refreshToken": "supabase-refresh-token"
}
```

Success: `200 OK`

```json
{
  "message": "Session refreshed successfully",
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "session": {
    "accessToken": "new-access-token",
    "refreshToken": "new-refresh-token",
    "expiresAt": 1770000000,
    "expiresIn": 3600
  }
}
```

Supabase may rotate the refresh token. Always replace the old refresh token with the returned one.

### 3.6 Logout

`POST /auth/logout`

Request:

```json
{
  "refreshToken": "supabase-refresh-token"
}
```

Success: `200 OK`

```json
{
  "message": "Logout successful"
}
```

`refreshToken` is optional, and the backend also accepts `Authorization: Bearer <accessToken>`. Send whichever you have. The backend revokes this session on Supabase, so the old tokens stop working immediately. An already expired or invalid session still returns `200`.

The frontend must clear its local access token, refresh token, user state, and cached profile after calling logout, even if the user is already expired.

### 3.7 Get current profile

`GET /profiles/me`

Required header:

```http
Authorization: Bearer <accessToken>
```

Success: `200 OK`

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "role": "user",
  "full_name": "Ayesha Khan",
  "phone": "+92 300 1234567",
  "avatar_url": "https://example.com/avatar.png",
  "bio": "Backend developer",
  "created_at": "2026-09-18T10:00:00.000Z",
  "updated_at": "2026-09-18T10:00:00.000Z"
}
```

The database response uses snake_case names. `role` comes from verified Supabase `app_metadata` and is read-only. If no role is configured, the backend returns `user`. Frontend models may map these to `fullName`, `avatarUrl`, and so on, but requests must use the update request names below.

### 3.8 Update current profile

`PATCH /profiles/me`

Required header:

```http
Authorization: Bearer <accessToken>
```

Request fields are optional, so send only changed fields:

```json
{
  "fullName": "Ayesha Khan",
  "phone": "+92 300 1234567",
  "avatarUrl": "https://example.com/avatar.png",
  "bio": "Backend developer"
}
```

Field limits:

| Field | Type | Limit |
| --- | --- | --- |
| `fullName` | string | max 100 characters |
| `phone` | string | international format with country code, e.g. `+92 300 1234567`; stored normalized as `+923001234567` |
| `avatarUrl` | URL | max 2048 characters; must use `http` or `https` |
| `bio` | string | max 500 characters |

At least one field is required. `null`, an empty string, or only spaces **clears** a field (stored as `null`). `id`, timestamps, email, role, password, and admin fields cannot be changed through this endpoint. Unknown fields are rejected.

Success: `200 OK`, returning the updated profile in the same shape as `GET /profiles/me`.

If a profile is missing, `GET /profiles/me` creates an empty one, so the frontend does not need a 404 "profile setup" state.

### 3.9 Change email

`POST /auth/change-email` (requires `Authorization: Bearer <accessToken>`)

```json
{
  "newEmail": "new@example.com"
}
```

Success: `200 OK`

```json
{
  "message": "Confirmation email sent. Your email will change only after you confirm the link sent to your email."
}
```

The email does **not** change until the user clicks the Supabase confirmation link (with Secure email change, links go to both addresses). Errors: `400` for the same or an invalid email, `409` if the email is already in use, `429` if rate limited, `401` if the session expired.

## 4. Error Handling

NestJS returns errors in this general shape:

```json
{
  "statusCode": 401,
  "message": "Invalid or expired access token",
  "error": "Unauthorized"
}
```

Validation errors may return an array:

```json
{
  "statusCode": 400,
  "message": ["password must be longer than or equal to 12 characters"],
  "error": "Bad Request"
}
```

Frontend handling:

| Status | Meaning | Frontend action |
| --- | --- | --- |
| `400` | Invalid body or request | Show field errors or a safe message |
| `401` | Missing/expired/invalid auth | Try refresh once, then log out |
| `403` | Email not verified / signups disabled | Show the message (e.g. ask to verify email) |
| `409` | Email already in use (email change) | Ask for a different email |
| `429` | Too many requests | Show a wait message; do not immediately retry |
| `500` | Backend failure | Show a generic retry message |
| `503` | Supabase temporarily unavailable | Show a temporary service message |

Do not display raw stack traces or Supabase internal errors to users.

## 4.1 Role, middleware, social login, and OTP scope

- `role` is returned by profile APIs for display and authorization-aware UI only. It is never accepted in profile update requests.
- The backend does not provide Google or LinkedIn OAuth endpoints yet. Social-login buttons should remain hidden or disabled until OAuth endpoints are added.
- The backend does not provide OTP verification endpoints. An OTP/check-email screen should remain out of the frontend flow unless an OTP contract is added.
- Client-side session checks are useful for UX but are not a security boundary. For Next.js, protect private pages with middleware or server-side session checks, then still rely on backend bearer-token authorization for API security.

## 5. Supabase Dashboard Setup

Before frontend testing:

1. Open Supabase Dashboard > Authentication > URL Configuration.
2. Set the Site URL to the deployed frontend URL.
3. Add the local frontend URL, such as `http://localhost:3001`, to Redirect URLs.
4. Ensure the reset URL is allowed: `http://localhost:3001/reset-password` and the production equivalent.
5. Confirm the email provider settings required by the project.
6. In Supabase Authentication > Providers > Email, keep **Confirm email** enabled.
7. Run the SQL files in `supabase/migrations` in order (`001` to `004`).
8. Configure custom SMTP (Authentication > Emails). The built-in mailer only delivers to project team members.

The migrations create:

- `public.profiles`, linked to `auth.users`.
- Row-level security policies for a user's own profile.
- Automatic profile creation after a new auth user.
- Automatic profile deletion through the foreign-key cascade.

## 6. Local Frontend Integration

Start the backend:

```bash
cd backend
npm install
npm run start:dev
```

Start the frontend on the origin configured in `CORS_ORIGIN`.

Use the supplied `frontend-integration/api-client.ts` as a starting point. It is framework-independent and uses browser `fetch`.

## 7. Backend Deployment

A generic deployment sequence for Render, Railway, Fly.io, or another Node host:

1. Deploy the `backend` directory as a Node/NestJS service.
2. Install command: `npm ci`.
3. Build command: `npm run build`.
4. Start command: `npm run start:prod`.
5. Do not set `PORT`; the host provides it.
6. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` as server-side environment variables (the service-role key is not needed).
7. Set `CORS_ORIGIN` to the exact deployed frontend origin.
8. Set `FRONTEND_URL` to the deployed frontend origin.
9. Apply Supabase migrations before accepting traffic.
10. Verify `GET /` and one authenticated profile request.

Do not commit `.env`. Do not expose the service-role key in build logs, frontend bundles, Docker images used by the browser, or public documentation.

## 8. Frontend Deployment Checklist

Before production release:

- Set the frontend API URL to the deployed backend URL.
- Add the frontend production origin to backend `CORS_ORIGIN`.
- Add the reset-password production URL to Supabase Redirect URLs.
- Verify signup, email confirmation, login, profile load, profile update, logout, forgot password, and reset password.
- Verify an unauthenticated request to `/profiles/me` returns `401`.
- Verify an expired token refreshes once and does not loop.
- Confirm browser developer tools and analytics do not contain access or refresh tokens.
- Confirm HTTPS is enabled for both frontend and backend.

## 9. What the Frontend Must Not Do

- Do not call Supabase with the service-role key.
- Do not trust a user ID supplied by the browser; this API derives identity from the bearer token.
- Do not send `id`, `created_at`, `updated_at`, or admin fields in profile updates.
- Do not assume signup always logs the user in; email confirmation may be required.
- Do not enable direct login before email confirmation; the backend expects Supabase **Confirm email** to remain enabled.
- Do not reveal whether an email exists during forgot-password.
- Do not retry login, reset, or refresh requests aggressively after `429`.
- Do not store or log passwords.
- Do not put tokens in URLs, screenshots, telemetry, or error messages.
