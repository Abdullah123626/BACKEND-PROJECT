// Copy this file into the frontend project and set API_BASE_URL from its environment.

export type Session = {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
  expiresIn?: number;
};

export type AuthUser = {
  id: string;
  email?: string;
  emailConfirmedAt?: string | null;
};

export type AuthResponse = {
  message: string;
  user?: AuthUser;
  session?: Session;
  requiresEmailConfirmation?: boolean;
};

export type Profile = {
  id: string;
  email: string | null;
  role: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
};

// null ya "" bhejne se field clear ho jata hai
export type UpdateProfileInput = {
  fullName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
};

type ApiErrorBody = {
  statusCode?: number;
  message?: string | string[];
  error?: string;
};

export class ApiError extends Error {
  readonly statusCode: number;
  readonly details: string | string[] | undefined;

  constructor(statusCode: number, body: ApiErrorBody) {
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message || body.error || 'Request failed';
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = body.message;
  }
}

export type TokenStore = {
  getSession(): Session | null;
  setSession(session: Session): void;
  clear(): void;
};

export type ApiClientOptions = {
  onSessionExpired?: () => void | Promise<void>;
};

export class MemoryTokenStore implements TokenStore {
  private session: Session | null = null;

  getSession(): Session | null {
    return this.session;
  }

  setSession(session: Session): void {
    this.session = session;
  }

  clear(): void {
    this.session = null;
  }
}

export class BackendApiClient {
  private readonly baseUrl: string;
  private readonly tokenStore: TokenStore;
  private readonly onSessionExpired?: () => void | Promise<void>;
  private refreshPromise: Promise<Session> | null = null;

  constructor(
    baseUrl: string,
    tokenStore: TokenStore = new MemoryTokenStore(),
    options: ApiClientOptions = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.tokenStore = tokenStore;
    this.onSessionExpired = options.onSessionExpired;
  }

  getSession(): Session | null {
    return this.tokenStore.getSession();
  }

  async signup(email: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
  }
  
  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    if (response.session) this.tokenStore.setSession(response.session);
    return response;
  }

  async resendConfirmation(email: string): Promise<{ message: string }> {
    return this.request('/auth/resend-confirmation', {
      method: 'POST',
      body: { email },
      auth: false,
    });
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    return this.request('/auth/forgot-password', {
      method: 'POST',
      body: { email },
      auth: false,
    });
  }

  async resetPassword(accessToken: string, password: string): Promise<{ message: string }> {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: { accessToken, password },
      auth: false,
    });
  }

  async refresh(): Promise<AuthResponse> {
    const session = this.tokenStore.getSession();
    if (!session) throw new ApiError(401, { message: 'No refresh session available' });

    const response = await this.request<AuthResponse>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: session.refreshToken },
      auth: false,
    });
    if (!response.session) throw new ApiError(401, { message: 'Refresh returned no session' });
    this.tokenStore.setSession(response.session);
    return response;
  }

  async logout(): Promise<{ message: string }> {
    const session = this.tokenStore.getSession();
    try {
      return await this.request('/auth/logout', {
        method: 'POST',
        body: { refreshToken: session?.refreshToken || '' },
        auth: false,
      });
    } finally {
      this.tokenStore.clear();
    }
  }

  // Email confirmation link click hone ke baad hi badalta hai
  async changeEmail(newEmail: string): Promise<{ message: string }> {
    return this.request('/auth/change-email', {
      method: 'POST',
      body: { newEmail },
    });
  }

  async getMyProfile(): Promise<Profile> {
    return this.request<Profile>('/profiles/me', { method: 'GET' });
  }

  async updateMyProfile(input: UpdateProfileInput): Promise<Profile> {
    return this.request<Profile>('/profiles/me', {
      method: 'PATCH',
      body: input,
    });
  }

  private async request<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PATCH';
      body?: unknown;
      auth?: boolean;
      retryOnUnauthorized?: boolean;
    },
  ): Promise<T> {
    const auth = options.auth !== false;
    const session = this.tokenStore.getSession();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (auth && session?.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`,{
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (response.ok) return (await response.json()) as T;

    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Keep a useful status error when the server returns no JSON body.
    }

    if (
      response.status === 401 &&
      auth &&
      options.retryOnUnauthorized !== false &&
      session?.refreshToken
    ) {
      await this.refreshOnce();
      return this.request<T>(path, {
        ...options,
        retryOnUnauthorized: false,
      });
    }

    throw new ApiError(response.status, body);
  }

  private async refreshOnce(): Promise<Session> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh().then((response) => response.session!);
      this.refreshPromise.then(
        () => {
          this.refreshPromise = null;
        },
        () => {
          this.refreshPromise = null;
        },
      );
    }

    try {
      return await this.refreshPromise;
    } catch (error) {
      this.tokenStore.clear();
      await this.onSessionExpired?.();
      throw error;
    }
  }
}

// Example:
// const api = new BackendApiClient(import.meta.env.VITE_API_URL);
// await api.login(email, password);
// const profile = await api.getMyProfile();
