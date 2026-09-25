import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import type { Request } from 'express';

type AuthenticatedRequest = Request & {
	user: User;
};

// Controllers receive the identity verified by SupabaseAuthGuard, never a client-supplied user ID.
export const CurrentUser = createParamDecorator(
	(_data: unknown, context: ExecutionContext): User => {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		return request.user;
	},
);
