# Frontend Integration Files

Copy `api-client.ts` into the frontend source tree, for example:

```text
src/lib/api-client.ts
```

## Setup

Create the frontend environment variable:

Vite:

```env
VITE_API_URL=http://localhost:3000
```

Next.js:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

Create the client once and reuse it through the frontend auth/provider layer:

```ts
import { BackendApiClient } from './api-client';

export const api = new BackendApiClient(import.meta.env.VITE_API_URL);
```

For Next.js, replace `import.meta.env.VITE_API_URL` with `process.env.NEXT_PUBLIC_API_URL`.

For centralized logout and redirect when refresh fails:

```ts
const api = new BackendApiClient(
  process.env.NEXT_PUBLIC_API_URL!,
  tokenStore,
  {
    onSessionExpired: async () => {
      authStore.clear();
      router.replace('/login');
    },
  },
);
```

## Typical usage

```ts
await api.login(email, password);
const profile = await api.getMyProfile();
await api.updateMyProfile({ fullName: 'Ayesha Khan' });
await api.logout();
```

The client automatically:

- Adds the bearer token to protected requests.
- Refreshes an expired access token once after a `401`.
- Prevents multiple simultaneous requests from starting duplicate refresh calls.
- Clears tokens when refresh fails or logout completes.
- Converts backend errors into `ApiError` with `statusCode` and `details`.

The client intentionally has no Google, LinkedIn, or OTP methods because the backend does not expose those endpoints.

The default `MemoryTokenStore` clears tokens on a full page reload. If persistent login is required, implement the `TokenStore` interface in the frontend and use a reviewed storage strategy. Never log token values.

## Password reset page

On `/reset-password`, Supabase supplies the access token in the URL hash. Extract it in the browser, then call:

```ts
const hash = new URLSearchParams(window.location.hash.slice(1));
const accessToken = hash.get('access_token');

if (!accessToken) {
  // Show an invalid or expired link state.
} else {
  await api.resetPassword(accessToken, newPassword);
}
```

After success, remove the token from the URL and navigate to `/login`.
