import { ServiceUnavailableException } from '@nestjs/common';

// Supabase AuthError ka woh hissa jo hum use karte hain (message kabhi client ko nahi jata).
export type SupabaseAuthErrorLike = {
	status?: number;
	code?: string;
	name?: string;
	message?: string;
};

// Network failure ya Supabase ki taraf se 5xx: ye "system" error hai, auth error nahi.
export function isServiceFailure(error: SupabaseAuthErrorLike): boolean {
	return (
		!error.status ||
		error.status >= 500 ||
		error.name === 'AuthRetryableFetchError'
	);
}

export function serviceUnavailable(): ServiceUnavailableException {
	return new ServiceUnavailableException(
		'Authentication service is temporarily unavailable. Please try again shortly',
	);
}

// Logs me sirf status/code, message nahi (message me kabhi kabhi user data hota hai).
export function describeAuthError(error: SupabaseAuthErrorLike): string {
	return `status=${error.status ?? 'none'} code=${error.code ?? 'none'} name=${error.name ?? 'none'}`;
}

// PostgREST/database error ka safe description (details/hint log nahi karte).
export function describeDbError(error: { code?: string }): string {
	return `code=${error.code ?? 'none'}`;
}

// JWT ke payload se "amr" (authentication methods) nikalta hai.
// Token pehle hi Supabase se validate ho chuka hota hai; ye sirf method check ke liye hai.
export function getAuthMethods(accessToken: string): string[] {
	try {
		const payload = accessToken.split('.')[1];
		if (!payload) return [];
		const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
			amr?: Array<{ method?: string } | string>;
		};
		return (json.amr ?? [])
			.map((entry) => (typeof entry === 'string' ? entry : entry.method))
			.filter((method): method is string => typeof method === 'string');
	} catch {
		return [];
	}
}
