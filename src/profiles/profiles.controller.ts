import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import {
	AccessToken,
	CurrentUser,
} from '../common/decorators/current-user.decorator.js';
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ProfileOwner, ProfilesService } from './profiles.service.js';

@Controller('profiles')
@UseGuards(SupabaseAuthGuard)
export class ProfilesController {
	constructor(private readonly profilesService: ProfilesService) {}

	// Protected: sirf logged-in user ki apni profile.
	@Get('me')
	getCurrentProfile(
		@CurrentUser() user: User,
		@AccessToken() accessToken: string,
	) {
		return this.profilesService.getCurrentProfile(this.toOwner(user), accessToken);
	}

	// Protected: sirf logged-in user ki apni profile ke allowed fields update.
	@Patch('me')
	updateCurrentProfile(
		@CurrentUser() user: User,
		@AccessToken() accessToken: string,
		@Body() updateProfileDto: UpdateProfileDto,
	) {
		return this.profilesService.updateCurrentProfile(
			this.toOwner(user),
			accessToken,
			updateProfileDto,
		);
	}

	// Role sirf server-controlled app_metadata se (user khud set nahi kar sakta).
	private toOwner(user: User): ProfileOwner {
		const role = user.app_metadata?.role;
		return {
			id: user.id,
			email: user.email ?? null,
			role: typeof role === 'string' && role.trim() ? role : 'user',
		};
	}
}
