import { Transform } from 'class-transformer';
import {
	IsOptional,
	IsString,
	IsUrl,
	MaxLength,
	Matches,
} from 'class-validator';

export class UpdateProfileDto {
	@IsOptional()
	@Transform(({ value }) =>
		typeof value === 'string' ? value.trim() : value,
	)
	@IsString()
	@MaxLength(100)
	fullName?: string;

	@IsOptional()
	@Transform(({ value }) =>
		typeof value === 'string' ? value.trim() : value,
	)
	@IsString()
	@MaxLength(30)
	@Matches(/^[+\d\s().-]+$/, {
		message: 'Phone number format is invalid',
	})
	phone?: string;

	@IsOptional()
	@Transform(({ value }) =>
		typeof value === 'string' ? value.trim() : value,
	)
	@IsUrl({ protocols: ['http', 'https'], require_protocol: true })
	@MaxLength(2048)
	avatarUrl?: string;

	@IsOptional()
	@Transform(({ value }) =>
		typeof value === 'string' ? value.trim() : value,
	)
	@IsString()
	@MaxLength(500)
	bio?: string;
}
