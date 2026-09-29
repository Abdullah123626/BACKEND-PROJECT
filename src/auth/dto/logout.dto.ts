import { IsOptional, IsString, MaxLength } from 'class-validator';

// Logout hamesha kamyab hona chahiye, is liye refresh token optional hai
// (expired/missing session wala user bhi logout kar sake).
export class LogoutDto {
	@IsOptional()
	@IsString({ message: 'Refresh token must be a string' })
	@MaxLength(2048, { message: 'Refresh token is invalid' })
	refreshToken?: string;
}
