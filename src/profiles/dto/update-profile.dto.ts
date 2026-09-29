import { Transform } from 'class-transformer';
import {
	IsOptional,
	IsString,
	IsUrl,
	Matches,
	MaxLength,
} from 'class-validator';

// Null aur khali string ("" ya sirf spaces) dono ka matlab: field clear karo (null).
const trimToNull = ({ value }: { value: unknown }) => {
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
};

// "+92 300-123 4567" -> "+923001234567" (spaces, dashes, dots, brackets hata kar)
const normalizePhone = ({ value }: { value: unknown }) => {
	const trimmed = trimToNull({ value });
	return typeof trimmed === 'string' ? trimmed.replace(/[\s().-]/g, '') : trimmed;
};

// Control characters (newline ke ilawa) text fields me allowed nahi; regex jaan boojh kar control chars match karta hai
// oxlint-disable-next-line no-control-regex
const NO_CONTROL_CHARS = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/;
// oxlint-disable-next-line no-control-regex
const NO_CONTROL_CHARS_SINGLE_LINE = /^[^\u0000-\u001F\u007F]*$/;

export class UpdateProfileDto {
	@IsOptional()
	@Transform(trimToNull)
	@IsString({ message: 'Full name must be a string' })
	@MaxLength(100, { message: 'Full name must be at most 100 characters' })
	@Matches(NO_CONTROL_CHARS_SINGLE_LINE, {
		message: 'Full name contains invalid characters',
	})
	fullName?: string | null;

	@IsOptional()
	@Transform(normalizePhone)
	@IsString({ message: 'Phone number must be a string' })
	@Matches(/^\+[1-9]\d{6,14}$/, {
		message:
			'Phone number must be in international format, for example +923001234567',
	})
	phone?: string | null;

	@IsOptional()
	@Transform(trimToNull)
	@IsString({ message: 'Avatar URL must be a string' })
	@MaxLength(2048, { message: 'Avatar URL must be at most 2048 characters' })
	@IsUrl(
		{ protocols: ['http', 'https'], require_protocol: true },
		{ message: 'Avatar URL must be a valid http or https URL' },
	)
	avatarUrl?: string | null;

	@IsOptional()
	@Transform(trimToNull)
	@IsString({ message: 'Bio must be a string' })
	@MaxLength(500, { message: 'Bio must be at most 500 characters' })
	@Matches(NO_CONTROL_CHARS, { message: 'Bio contains invalid characters' })
	bio?: string | null;
}
