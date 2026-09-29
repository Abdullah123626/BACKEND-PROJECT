import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsStrongAppPassword } from '../../common/validation/auth-fields.js';

export class ResetPasswordDto {
	// Reset link se mila recovery access token
	@IsString({ message: 'Reset token must be a string' })
	@IsNotEmpty({ message: 'Reset token is required' })
	@MaxLength(4096, { message: 'Reset token is invalid' })
	accessToken!: string;

	@IsStrongAppPassword()
	password!: string;
}
