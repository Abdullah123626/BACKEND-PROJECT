import {
	IsLoginPassword,
	IsNormalizedEmail,
} from '../../common/validation/auth-fields.js';

export class LoginDto {
	@IsNormalizedEmail()
	email!: string;

	@IsLoginPassword()
	password!: string;
}
