import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsStrongAppPassword } from '../../common/validation/auth-fields.js';

export class ResetPasswordDto {
	// Reset link se mila recovery access token
	@ApiProperty({
		description:
			'The `access_token` from the password reset link (URL hash on the /reset-password page). A normal login token is rejected.',
		example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
		maxLength: 4096,
	})
	@IsString({ message: 'Reset token must be a string' })
	@IsNotEmpty({ message: 'Reset token is required' })
	@MaxLength(4096, { message: 'Reset token is invalid' })
	accessToken!: string;

	@IsStrongAppPassword()
	password!: string;
}
