import {
	BadRequestException,
	HttpException,
	Injectable,
	InternalServerErrorException,
	Logger,
	ServiceUnavailableException,
	UnauthorizedException,
} from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { describeDbError } from '../supabase/supabase-errors.js';

// Auth user ki pehchan, jo sirf verified token se aati hai.
export type ProfileOwner = {
	id: string;
	email: string | null;
	role: string;
};

type DbError = { code?: string; message?: string };

const PROFILE_COLUMNS = 'id, full_name, phone, avatar_url, bio, created_at, updated_at';

@Injectable()
export class ProfilesService {
	private readonly logger = new Logger(ProfilesService.name);

	constructor(private readonly supabaseService: SupabaseService) {}

	// User ID token se aata hai, request body/URL se kabhi nahi. Query user ke apne
	// token se chalti hai, is liye database ki RLS policies bhi lagti hain.
	async getCurrentProfile(owner: ProfileOwner, accessToken: string) {
		const db = this.supabaseService.createUserClient(accessToken);
		const { data, error } = await db
			.from('profiles')
			.select(PROFILE_COLUMNS)
			.eq('id', owner.id)
			.maybeSingle();

		if (error) throw this.toHttpError(error, 'load');
		if (data) return { ...data, email: owner.email, role: owner.role };

		// Profile nahi mili (jaise trigger se pehle bana purana account): khali profile bana do.
		return this.createProfile(owner, accessToken, {});
	}

	// Sirf DTO ke profile fields map hote hain; id, email, role, timestamps server ke paas.
	async updateCurrentProfile(
		owner: ProfileOwner,
		accessToken: string,
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

		const db = this.supabaseService.createUserClient(accessToken);
		const { data, error } = await db
			.from('profiles')
			.update(updates)
			.eq('id', owner.id)
			.select(PROFILE_COLUMNS)
			.maybeSingle();

		if (error) throw this.toHttpError(error, 'update');
		if (data) return { ...data, email: owner.email, role: owner.role };

		return this.createProfile(owner, accessToken, updates);
	}

	private async createProfile(
		owner: ProfileOwner,
		accessToken: string,
		fields: Record<string, string | null>,
	) {
		const db = this.supabaseService.createUserClient(accessToken);
		const { data, error } = await db
			.from('profiles')
			.insert({ id: owner.id, ...fields })
			.select(PROFILE_COLUMNS)
			.single();

		if (error) {
			// Auth user delete ho chuka hai (foreign key fail)
			if (error.code === '23503') {
				throw new UnauthorizedException('This account no longer exists');
			}
			throw this.toHttpError(error, 'create');
		}
		return { ...data, email: owner.email, role: owner.role };
	}

	// Database ka andar ka error client ko kabhi nahi jata; sirf safe message.
	private toHttpError(error: DbError, action: string): HttpException {
		this.logger.error(`Profile ${action} failed: ${describeDbError(error)}`);

		switch (error.code) {
			case '23514': // check constraint
			case '22001': // value too long
			case '22P02': // invalid text representation
				return new BadRequestException('Invalid profile data');
			case 'PGRST301': // JWT invalid
			case 'PGRST303': // JWT expired
				return new UnauthorizedException('Invalid or expired access token');
		}
		// Code na ho to network/database tak pohanch nahi saka
		if (!error.code) {
			return new ServiceUnavailableException(
				'Profile service is temporarily unavailable. Please try again shortly',
			);
		}
		return new InternalServerErrorException('Unable to process profile request');
	}
}
