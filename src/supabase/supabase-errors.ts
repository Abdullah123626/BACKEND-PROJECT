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

// Request Supabase tak pohanchi hi nahi, ya gateway/infra down hai (502-504, Cloudflare 52x).
// Ye har email pe ek jaisa hota hai, is liye client ko batana safe hai.
// Note: auth-js 500 ko bhi AuthRetryableFetchError banata hai, lekin email flows me 500
// aksar SMTP failure hota hai jo sirf mojooda accounts pe aata hai; is liye 500 yahan shamil nahi.
export function isSupabaseUnreachable(error: SupabaseAuthErrorLike): boolean {
	const status = error.status;
	if (!status) return true;
	return [502, 503, 504].includes(status) || (status >= 520 && status <= 530);
}

// Email flows (signup/resend/forgot/change-email) me Supabase ka 500 = email bhej nahi saka.
export function isEmailDeliveryFailure(error: SupabaseAuthErrorLike): boolean {
	return error.status === 500;
}

// Signup ka 500 do wajah se ho sakta hai: email na bhej saka, ya database (profile trigger) fail.
// Supabase ka message sirf yahan farq karne ke liye dekhte hain, log/client ko nahi bhejte.
export function isDatabaseSaveFailure(error: SupabaseAuthErrorLike): boolean {
	return error.status === 500 && /database error/i.test(error.message ?? '');
}

export const DATABASE_SAVE_HINT =
	'Supabase could not save the new user: check the profiles trigger (migration 003) and the Postgres logs in the Supabase dashboard';

export const EMAIL_DELIVERY_HINT =
	'Supabase could not send the email: check Authentication > Emails > SMTP Settings and the Auth logs in the Supabase dashboard';

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
