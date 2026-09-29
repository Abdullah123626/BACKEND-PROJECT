import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';

// Controllers ko SupabaseAuthGuard ki verify ki hui identity milti hai, client ka bheja user ID kabhi nahi.
export const CurrentUser = createParamDecorator(
	(_data: unknown, context: ExecutionContext): User => {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		return request.user;
	},
);

// Guard ka validate kiya hua access token (RLS wale database client ke liye).
export const AccessToken = createParamDecorator(
	(_data: unknown, context: ExecutionContext): string => {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		return request.accessToken;
	},
);
