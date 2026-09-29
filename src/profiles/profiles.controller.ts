import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
} from '@nestjs/swagger';
import type { User } from '@supabase/supabase-js';
import {
	AccessToken,
	CurrentUser,
} from '../common/decorators/current-user.decorator.js';
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard.js';
import { ApiErrors } from '../common/swagger/api-docs.decorators.js';
import { ProfileResponse } from '../common/swagger/api-responses.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ProfileOwner, ProfilesService } from './profiles.service.js';

@ApiTags('Profiles')
@ApiBearerAuth()
@Controller('profiles')
@UseGuards(SupabaseAuthGuard)
export class ProfilesController {
	constructor(private readonly profilesService: ProfilesService) {}

	// Protected: sirf logged-in user ki apni profile.
	@Get('me')
	@ApiOperation({
		summary: 'Get my profile',
		description:
			'The user is identified only by the access token. A missing profile is created empty.',
	})
	@ApiOkResponse({ type: ProfileResponse })
	@ApiErrors({
		401: 'Missing, invalid, expired or revoked access token',
		503: 'Supabase or the database is unavailable',
	})
	getCurrentProfile(
		@CurrentUser() user: User,
		@AccessToken() accessToken: string,
	) {
		return this.profilesService.getCurrentProfile(this.toOwner(user), accessToken);
	}

	// Protected: sirf logged-in user ki apni profile ke allowed fields update.
	@Patch('me')
	@ApiOperation({
		summary: 'Update my profile (partial)',
		description:
			'Send only the fields to change. `null` or an empty string clears a field. id, email, role, timestamps and any unknown field are rejected.',
	})
	@ApiOkResponse({ type: ProfileResponse })
	@ApiErrors({
		400: 'Validation failed, empty body, or a protected/unknown field',
		401: 'Missing, invalid, expired or revoked access token',
		503: 'Supabase or the database is unavailable',
	})
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
