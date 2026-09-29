import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// Logout hamesha kamyab hona chahiye, is liye refresh token optional hai
// (expired/missing session wala user bhi logout kar sake).
export class LogoutDto {
	@ApiPropertyOptional({
		description:
			'Refresh token of the session to end. Optional: a Bearer access token in the Authorization header also works.',
		example: 'v1.MRjcyQ3...',
		maxLength: 2048,
	})
	@IsOptional()
	@IsString({ message: 'Refresh token must be a string' })
	@MaxLength(2048, { message: 'Refresh token is invalid' })
	refreshToken?: string;
}
