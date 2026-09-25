import { Transform } from 'class-transformer';
import {
	IsEmail,
	IsNotEmpty,
	IsStrongPassword,
	IsString,
	Matches,
	MaxLength,
} from 'class-validator';

export class SignupDto {
	@Transform(({ value }) =>
		typeof value === 'string' ? value.trim().toLowerCase() : value,
	)
	@IsEmail()
	@IsNotEmpty()
	@MaxLength(254)
	email!: string;

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
