import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
	@Transform(({ value }) =>
		typeof value === 'string' ? value.trim().toLowerCase() : value,
	)
	@IsEmail({},{
        message:"please enter a valid email address"
    })
	@IsNotEmpty({
        message:"email is required"
    })
	@MaxLength(254,{
        message:"Email is too long"
    })
	email!: string;
}

