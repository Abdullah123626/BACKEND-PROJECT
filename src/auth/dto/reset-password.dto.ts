import {
	IsNotEmpty,
	IsStrongPassword,
	IsString,
	Matches,
	MaxLength,
} from 'class-validator';

export class ResetPasswordDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(4096)
	accessToken!: string;

	@IsString()
	@IsNotEmpty()
	@MaxLength(128)
	@IsStrongPassword({
		minLength: 12,
		minLowercase: 1,
		minUppercase: 1,
		minNumbers: 1,
		minSymbols: 1,
	})
	@Matches(/^\S+$/, {
		message: 'Password must not contain spaces',
	})
	password!: string;
}