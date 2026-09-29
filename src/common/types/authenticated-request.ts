import type { User } from '@supabase/supabase-js';
import type { Request } from 'express';

// SupabaseAuthGuard validate hone ke baad ye dono fields set karta hai.
export type AuthenticatedRequest = Request & {
	user: User;
	accessToken: string;
};
