import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
	@ApiProperty({
		description: 'Refresh token from the last login/refresh response',
		example: 'v1.MRjcyQ3...',
		maxLength: 2048,
	})
	@IsString({ message: 'Refresh token must be a string' })
	@IsNotEmpty({ message: 'Refresh token is required' })
	@MaxLength(2048, { message: 'Refresh token is invalid' })
	refreshToken!: string;
}
