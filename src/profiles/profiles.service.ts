import {
	BadRequestException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { SupabaseService } from '../supabase/supabase.service.js';

@Injectable()
export class ProfilesService {
	constructor(private readonly supabaseService: SupabaseService) {}

	// The user ID comes from the validated access token, never from the request body or URL.
	async getCurrentProfile(userId: string, email: string | null, role: string) {
		const { data, error } = await this.supabaseService
			.getAdminClient()
			.from('profiles')
			.select('id, full_name, phone, avatar_url, bio, created_at, updated_at')
			.eq('id', userId)
			.maybeSingle();

		if (error) {
			throw new InternalServerErrorException('Unable to load profile');
		}

		if (!data) {
			throw new NotFoundException('Profile not found');
		}

		return { ...data, email, role };
	}

	// Only profile fields from the DTO are mapped; identity and privileged fields stay server-controlled.
	async updateCurrentProfile(
		userId: string,
		email: string | null,
		role: string,
		updateProfileDto: UpdateProfileDto,
	) {
		const updates = {
			...(updateProfileDto.fullName !== undefined && {
				full_name: updateProfileDto.fullName,
			}),
			...(updateProfileDto.phone !== undefined && {
				phone: updateProfileDto.phone,
			}),
			...(updateProfileDto.avatarUrl !== undefined && {
				avatar_url: updateProfileDto.avatarUrl,
			}),
			...(updateProfileDto.bio !== undefined && {
				bio: updateProfileDto.bio,
			}),
		};

		if (Object.keys(updates).length === 0) {
			throw new BadRequestException('At least one profile field is required');
		}

		const { data, error } = await this.supabaseService
			.getAdminClient()
			.from('profiles')
			.update(updates)
			.eq('id', userId)
			.select('id, full_name, phone, avatar_url, bio, created_at, updated_at')
			.maybeSingle();

		if (error) {
			throw new InternalServerErrorException('Unable to update profile');
		}

		if (!data) {
			throw new NotFoundException('Profile not found');
		}

		return { ...data, email, role };
	}
}
