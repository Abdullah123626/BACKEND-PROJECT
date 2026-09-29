import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Ye classes sirf Swagger documentation ke liye hain (response ka shape dikhane ke liye).

export class MessageResponse {
	@ApiProperty({ example: 'Logout successful' })
	message!: string;
}

export class SignupResponse {
	@ApiProperty({
		example:
			'Account created. Please check your email and verify your account before logging in.',
	})
	message!: string;

	@ApiProperty({
		example: true,
		description: 'true = user must click the verification email before logging in',
	})
	requiresEmailConfirmation!: boolean;
}

export class PublicUser {
	@ApiProperty({ example: '6f1c2d3e-1111-4a2b-9c3d-123456789abc', format: 'uuid' })
	id!: string;

	@ApiProperty({ example: 'user@example.com', format: 'email' })
	email!: string;

	@ApiProperty({
		example: '2026-09-18T10:00:00.000Z',
		format: 'date-time',
		nullable: true,
		type: String,
	})
	emailConfirmedAt!: string | null;
}

export class PublicSession {
	@ApiProperty({
		example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
		description: 'Send as `Authorization: Bearer <accessToken>`',
	})
	accessToken!: string;

	@ApiProperty({
		example: 'v1.MRjcyQ3...',
		description: 'Use with /auth/refresh. Rotates: always store the newest one.',
	})
	refreshToken!: string;

	@ApiPropertyOptional({ example: 1790000000, description: 'Unix time (seconds) when the access token expires' })
	expiresAt?: number;

	@ApiProperty({ example: 3600, description: 'Access token lifetime in seconds' })
	expiresIn!: number;
}

export class AuthSessionResponse {
	@ApiProperty({ example: 'Login successful' })
	message!: string;

	@ApiProperty({ type: PublicUser })
	user!: PublicUser;

	@ApiProperty({ type: PublicSession })
	session!: PublicSession;
}

export class ProfileResponse {
	@ApiProperty({ example: '6f1c2d3e-1111-4a2b-9c3d-123456789abc', format: 'uuid' })
	id!: string;

	@ApiProperty({ example: 'user@example.com', nullable: true, type: String })
	email!: string | null;

	@ApiProperty({ example: 'user', description: 'Read-only, from Supabase app_metadata' })
	role!: string;

	@ApiProperty({ example: 'Ayesha Khan', nullable: true, type: String })
	full_name!: string | null;

	@ApiProperty({ example: '+923001234567', nullable: true, type: String })
	phone!: string | null;

	@ApiProperty({ example: 'https://example.com/avatar.png', nullable: true, type: String })
	avatar_url!: string | null;

	@ApiProperty({ example: 'Backend developer', nullable: true, type: String })
	bio!: string | null;

	@ApiProperty({ example: '2026-09-18T10:00:00.000Z', format: 'date-time' })
	created_at!: string;

	@ApiProperty({ example: '2026-09-18T10:00:00.000Z', format: 'date-time' })
	updated_at!: string;
}

export class ErrorResponse {
	@ApiProperty({ example: 400 })
	statusCode!: number;

	@ApiProperty({
		oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
		example: ['Please enter a valid email address'],
		description: 'A safe message, or a list of validation messages',
	})
	message!: string | string[];

	@ApiProperty({ example: 'Bad Request' })
	error!: string;

	@ApiProperty({ example: '/auth/signup' })
	path!: string;

	@ApiProperty({ example: '2026-09-29T10:00:00.000Z', format: 'date-time' })
	timestamp!: string;
}
