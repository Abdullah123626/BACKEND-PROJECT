import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
	IsEmail,
	IsNotEmpty,
	IsString,
	IsStrongPassword,
	Matches,
	MaxLength,
} from 'class-validator';

// Ek hi password policy signup, reset aur har jagah use hoti hai.
export const PASSWORD_MIN_LENGTH = 12;
// Supabase bcrypt use karta hai jo 72 bytes se lambe password ko cut kar deta hai.
export const PASSWORD_MAX_LENGTH = 72;
export const EMAIL_MAX_LENGTH = 254;

export const PASSWORD_POLICY_MESSAGE = `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters and include an uppercase letter, a lowercase letter, a number and a symbol`;

// Email trim + lowercase, taake "  User@Mail.com " aur "user@mail.com" ek hi account hon.
export function IsNormalizedEmail() {
	return applyDecorators(
		ApiProperty({
			description: 'Email address. Trimmed and lowercased by the server.',
			example: 'user@example.com',
			format: 'email',
			maxLength: EMAIL_MAX_LENGTH,
		}),
		Transform(({ value }) =>
			typeof value === 'string' ? value.trim().toLowerCase() : value,
		),
		IsString({ message: 'Email must be a string' }),
		IsNotEmpty({ message: 'Email is required' }),
		MaxLength(EMAIL_MAX_LENGTH, { message: 'Email is too long' }),
		IsEmail({}, { message: 'Please enter a valid email address' }),
	);
}

export function IsStrongAppPassword() {
	return applyDecorators(
		ApiProperty({
			description: `${PASSWORD_POLICY_MESSAGE}. No spaces.`,
			example: 'Str0ng!Passw0rd',
			format: 'password',
			minLength: PASSWORD_MIN_LENGTH,
			maxLength: PASSWORD_MAX_LENGTH,
		}),
		IsString({ message: 'Password must be a string' }),
		IsNotEmpty({ message: 'Password is required' }),
		MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_POLICY_MESSAGE }),
		IsStrongPassword(
			{
				minLength: PASSWORD_MIN_LENGTH,
				minLowercase: 1,
				minUppercase: 1,
				minNumbers: 1,
				minSymbols: 1,
			},
			{ message: PASSWORD_POLICY_MESSAGE },
		),
		Matches(/^\S+$/, { message: 'Password must not contain spaces' }),
	);
}

// Login pe policy check nahi hoti (purane passwords bhi chalne chahiye), sirf basic limits.
export function IsLoginPassword() {
	return applyDecorators(
		ApiProperty({
			description: 'Account password',
			example: 'Str0ng!Passw0rd',
			format: 'password',
			maxLength: PASSWORD_MAX_LENGTH,
		}),
		IsString({ message: 'Password must be a string' }),
		IsNotEmpty({ message: 'Password is required' }),
		MaxLength(PASSWORD_MAX_LENGTH, { message: 'Password is too long' }),
	);
}
