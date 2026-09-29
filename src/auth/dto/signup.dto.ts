import {
	IsNormalizedEmail,
	IsStrongAppPassword,
} from '../../common/validation/auth-fields.js';

export class SignupDto {
	@IsNormalizedEmail()
	email!: string;

	@IsStrongAppPassword()
	password!: string;
}
