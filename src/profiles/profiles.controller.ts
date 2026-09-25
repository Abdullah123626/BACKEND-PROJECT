import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ProfilesService } from './profiles.service.js';

@Controller('profiles')
@UseGuards(SupabaseAuthGuard)
export class ProfilesController {
	constructor(private readonly profilesService: ProfilesService) {}

	// Protected endpoint for the authenticated user's own profile.
	@Get('me')
	getCurrentProfile(@CurrentUser() user: User) {
		return this.profilesService.getCurrentProfile(
			user.id,
			user.email ?? null,
			this.getRole(user),
		);
	}

	// Protected endpoint for updating only the authenticated user's profile fields.
	@Patch('me')
	updateCurrentProfile(
		@CurrentUser() user: User,
		@Body() updateProfileDto: UpdateProfileDto,
	) {
		return this.profilesService.updateCurrentProfile(
			user.id,
			user.email ?? null,
			this.getRole(user),
			updateProfileDto,
		);
	}

	private getRole(user: User): string {
		const role = user.app_metadata?.role;
		return typeof role === 'string' && role.trim() ? role : 'user';
	}
}
