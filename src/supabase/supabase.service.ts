import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase Auth (GoTrue) REST call ka natija: sirf status aur error code.
export type AuthApiResult = {
	status: number;
	code?: string;
};

const CLIENT_AUTH_OPTIONS = {
	autoRefreshToken: false,
	persistSession: false,
	detectSessionInUrl: false,
};

// Backend sirf anon key use karta hai. Service-role key (jo RLS bypass karti hai)
// ki zaroorat hi nahi: har kaam user ke apne token se hota hai.
@Injectable()
export class SupabaseService implements OnApplicationBootstrap {
	private readonly logger = new Logger(SupabaseService.name);
	private readonly url: string;
	private readonly anonKey: string;
	private readonly client: SupabaseClient;

	constructor(private readonly configService: ConfigService) {
		const url = this.configService.get<string>('supabase.url');
		const anonKey = this.configService.get<string>('supabase.anonKey');

		if (!url || !anonKey) {
			throw new Error('Supabase configuration is incomplete');
		}

		this.url = url.replace(/\/+$/, '');
		this.anonKey = anonKey;
		this.client = createClient(this.url, anonKey, {
			auth: CLIENT_AUTH_OPTIONS,
		});
	}

	// Sirf stateless calls ke liye (jaise getUser(token)); is client pe kabhi session set nahi hota.
	getClient(): SupabaseClient {
		return this.client;
	}

	// Har signup/login/refresh ke liye naya client, taake ek user ka session
	// kabhi doosre user ki request ke saath share na ho.
	createAuthClient(): SupabaseClient {
		return createClient(this.url, this.anonKey, { auth: CLIENT_AUTH_OPTIONS });
	}

	// User ke access token ke saath client: database queries pe RLS lagti hai.
	createUserClient(accessToken: string): SupabaseClient {
		return createClient(this.url, this.anonKey, {
			auth: CLIENT_AUTH_OPTIONS,
			global: { headers: { Authorization: `Bearer ${accessToken}` } },
		});
	}

	// Token wale session ko server pe khatam karta hai ("local" = sirf ye session,
	// "global" = user ke saare sessions).
	signOut(accessToken: string, scope: 'local' | 'global'): Promise<AuthApiResult> {
		return this.callAuthApi('POST', `/logout?scope=${scope}`, accessToken);
	}

	// Naya password user ke (recovery) token se set hota hai.
	updatePassword(accessToken: string, password: string): Promise<AuthApiResult> {
		return this.callAuthApi('PUT', '/user', accessToken, { password });
	}

	// Email change Supabase ke secure flow se (confirmation link ke baad hi email badalta hai).
	requestEmailChange(
		accessToken: string,
		newEmail: string,
		redirectTo: string,
	): Promise<AuthApiResult> {
		return this.callAuthApi(
			'PUT',
			`/user?redirect_to=${encodeURIComponent(redirectTo)}`,
			accessToken,
			{ email: newEmail },
		);
	}

	// supabase-js ke session-based methods ki jagah seedha GoTrue endpoint,
	// taake shared client pe kabhi kisi user ka session store na ho.
	private async callAuthApi(
		method: 'POST' | 'PUT',
		path: string,
		accessToken: string,
		body?: object,
	): Promise<AuthApiResult> {
		try {
			const response = await fetch(`${this.url}/auth/v1${path}`, {
				method,
				headers: {
					apikey: this.anonKey,
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(10_000),
			});
			if (response.ok) return { status: response.status };

			const errorBody = (await response.json().catch(() => ({}))) as {
				error_code?: string;
				code?: string | number;
			};
			const code =
				errorBody.error_code ??
				(typeof errorBody.code === 'string' ? errorBody.code : undefined);
			return { status: response.status, code };
		} catch {
			// Network failure / timeout
			return { status: 0 };
		}
	}

	// Startup pe check: "Confirm email" band ho to log me saaf warning.
	// Await nahi karte taake serverless cold start slow na ho.
	onApplicationBootstrap(): void {
		void this.warnAboutAuthSettings();
	}

	private async warnAboutAuthSettings(): Promise<void> {
		try {
			const response = await fetch(`${this.url}/auth/v1/settings`, {
				headers: { apikey: this.anonKey },
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) return;

			const settings = (await response.json()) as {
				mailer_autoconfirm?: boolean;
				disable_signup?: boolean;
			};
			if (settings.mailer_autoconfirm) {
				this.logger.warn(
					'Supabase "Confirm email" is DISABLED: new accounts are created without email verification. Enable it in Supabase Dashboard > Authentication > Sign In / Providers > Email.',
				);
			}
			if (settings.disable_signup) {
				this.logger.warn(
					'Supabase signups are DISABLED: POST /auth/signup will return 403.',
				);
			}
		} catch {
			// Settings check sirf warning ke liye hai; app start hone se na roke.
		}
	}
}
