import {
	CanActivate,
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service.js';

type AuthenticatedRequest = Request & {
	user?: User;
};

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
	constructor(private readonly supabaseService: SupabaseService) {}

	// Only a validated Supabase access token can establish request identity.
	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		const authorization = request.headers.authorization;
		const [scheme, accessToken] = authorization?.split(' ') ?? [];

		if (scheme?.toLowerCase() !== 'bearer' || !accessToken) {
			throw new UnauthorizedException('Authentication required');
        }
        
		const { data, error } = await this.supabaseService
			.getClient()
			.auth.getUser(accessToken);

		if (error || !data.user) {
			throw new UnauthorizedException('Invalid or expired access token');
		}

		request.user = data.user;
		return true;
	}
}
