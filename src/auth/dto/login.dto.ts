import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
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
	password!: string;
}
