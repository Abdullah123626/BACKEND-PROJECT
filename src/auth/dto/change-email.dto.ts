import { IsNormalizedEmail } from '../../common/validation/auth-fields.js';

export class ChangeEmailDto {
	@IsNormalizedEmail()
	newEmail!: string;
}
