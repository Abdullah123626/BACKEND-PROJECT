import {
	CanActivate,
	ExecutionContext,
	Injectable,
	Logger,
	UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import {
	describeAuthError,
	isServiceFailure,
	serviceUnavailable,
} from '../../supabase/supabase-errors.js';

const MAX_TOKEN_LENGTH = 4096;
// JWT ke teen base64url hisse: header.payload.signature
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// Authorization header se "Bearer <token>" nikalta hai; ghalat format pe undefined.
export function extractBearerToken(request: Request): string | undefined {
	const header = request.headers.authorization;
	if (typeof header !== 'string') return undefined;
	const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
	return match?.[1];
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
	private readonly logger = new Logger(SupabaseAuthGuard.name);

	constructor(private readonly supabaseService: SupabaseService) {}

	// Sirf Supabase se validate hua access token hi user ki pehchan tay karta hai.
	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		const accessToken = extractBearerToken(request);

		if (!accessToken) {
			throw new UnauthorizedException('Authentication required');
		}
		if (accessToken.length > MAX_TOKEN_LENGTH || !JWT_PATTERN.test(accessToken)) {
			throw new UnauthorizedException('Invalid or expired access token');
		}

		// getUser Supabase server se check karta hai: signature, expiry, revoked
		// session (logout) aur deleted user sab yahin pakde jate hain.
		const { data, error } = await this.supabaseService
			.getClient()
			.auth.getUser(accessToken);

		if (error) {
			if (isServiceFailure(error)) {
				this.logger.error(`Token validation failed: ${describeAuthError(error)}`);
				throw serviceUnavailable();
			}
			throw new UnauthorizedException('Invalid or expired access token');
		}
		if (!data.user) {
			throw new UnauthorizedException('Invalid or expired access token');
		}

		request.user = data.user;
		request.accessToken = accessToken;
		return true;
	}
}
