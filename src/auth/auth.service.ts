import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ForgotPasswordDto } from './dto/forgot.password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SignupDto } from './dto/signup.dto.js';
import { SupabaseService } from '../supabase/supabase.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService?: ConfigService,
  ) {}

  // Signup sends credentials to Supabase Auth; the application never stores passwords.
  async signup(signupDto: SignupDto) {
    const { data, error } = await this.supabaseService.getClient().auth.signUp({
      email: signupDto.email,
      password: signupDto.password,
    });
    if (error) {
      if (error.status === 0 || !error.status) {
        throw new ServiceUnavailableException(
          'Authentication service is unavailable. Check the Supabase configuration or network connection',
        );
      }

      if (error.status === 429) {
        throw new HttpException(
          'Too many signup attempts. Please try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (error.status && error.status >= 500) {
        throw new ServiceUnavailableException(
          'Authentication service is temporarily unavailable',
        );
      }

      throw new BadRequestException(
        error.message || 'Unable to create account',
      );
    }

    if (!data.user) {
      throw new ServiceUnavailableException(
        'Authentication service is temporarily unavailable',
      );
    }

    return {
      message: 'Account created. Please verify your email before logging in.',
      user: {
        id: data.user.id,
        email: data.user.email,
        emailConfirmedAt: data.user.email_confirmed_at,
      },
      requiresEmailConfirmation: true,
    };
  }

  async resendConfirmation(email: string) {
    const { error } = await this.supabaseService
      .getClient()
      .auth.resend({ type: 'signup', email });

    if (error) {
      if (error.status === 429) {
        throw new HttpException(
          'Too many confirmation email requests. Please try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (error.status === 0 || !error.status || error.status >= 500) {
        throw new ServiceUnavailableException(
          'Authentication service is temporarily unavailable',
        );
      }
    }

    return {
      message: 'If the account exists, a confirmation email has been sent.',
    };
  }

  // Login delegates credential verification and session creation to Supabase Auth.
  async login(loginDto: LoginDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.signInWithPassword({
        email: loginDto.email,
        password: loginDto.password,
      });

    if (error) {
      if (error.status === 0 || !error.status) {
        throw new ServiceUnavailableException(
          'Authentication service is unavailable. Check the Supabase configuration or network connection',
        );
      }

      if (error.status === 429) {
        throw new HttpException(
          'Too many login attempts. Please try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (error.status && error.status >= 500) {
        throw new ServiceUnavailableException(
          'Authentication service is temporarily unavailable',
        );
      }

      if (
        error.message?.toLowerCase().includes('email not confirmed') ||
        error.code === 'email_not_confirmed'
      ) {
        throw new ForbiddenException(
          'Please verify your email before logging in',
        );
      }

      // Keep credential and account-existence details generic.
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!data.user || !data.session) {
      throw new UnauthorizedException('Unable to create a session');
    }

    return {
      message: 'Login successful',
      user: {
        id: data.user.id,
        email: data.user.email,
        emailConfirmedAt: data.user.email_confirmed_at,
      },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
        expiresIn: data.session.expires_in,
      },
    };
  }

  // forgot password service
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const frontendUrl =
      this.configService?.get<string>('app.frontendUrl') ??
      'http://localhost:3001';
    const redirectTo = `${frontendUrl}/reset-password`;

    const { error } = await this.supabaseService
      .getClient()
      .auth.resetPasswordForEmail(forgotPasswordDto.email, { redirectTo });

    if (error) {
      if (error.status === 0 || !error.status) {
        throw new ServiceUnavailableException(
          'Authentication service is unavailable. Check the Supabase configuration or network connection',
        );
      }

      if (error.status === 429) {
        throw new HttpException(
          'Too many password reset requests. Please try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (error.status && error.status >= 500) {
        throw new ServiceUnavailableException(
          'Authentication service is temporarily unavailable',
        );
      }

      throw new BadRequestException('Unable to process password reset request');
    }

    return {
      message: 'If an account exists, a password reset email has been sent.',
    };
  }

  // reset password service
  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.getUser(resetPasswordDto.accessToken);

    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const { error: updateError } = await this.supabaseService
      .getAdminClient()
      .auth.admin.updateUserById(data.user.id, {
        password: resetPasswordDto.password,
      });

    if (updateError) {
      if (updateError.status === 0 || !updateError.status) {
        throw new ServiceUnavailableException(
          'Authentication service is unavailable. Check the Supabase configuration or network connection',
        );
      }

      if (updateError.status === 429) {
        throw new HttpException(
          'Too many password reset attempts. Please try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (updateError.status && updateError.status >= 500) {
        throw new ServiceUnavailableException(
          'Authentication service is temporarily unavailable',
        );
      }

      throw new BadRequestException('Unable to reset password');
    }

    return {
     message: 'Password reset successfully',
    };
  }

  // Refresh rotates the Supabase session without exposing the refresh token in logs.
   async refreshSession(refreshTokenDto: RefreshTokenDto) {
     const { data, error } = await this.supabaseService
       .getClient()
       .auth.refreshSession({ refresh_token: refreshTokenDto.refreshToken });

     if (error || !data.user || !data.session) {
       throw new UnauthorizedException('Invalid or expired refresh token');
     }

     return {
       message: 'Session refreshed successfully',
       user: {
         id: data.user.id,
         email: data.user.email,
       },
       session: {
         accessToken: data.session.access_token,
         refreshToken: data.session.refresh_token,
         expiresAt: data.session.expires_at,
         expiresIn: data.session.expires_in,
       },
     };
   }

   // Logout invalidates the refreshed Supabase session; invalid sessions are treated as logged out.
  async logout(refreshTokenDto: RefreshTokenDto) {
     const { error: refreshError } = await this.supabaseService
       .getClient()
       .auth.refreshSession({ refresh_token: refreshTokenDto.refreshToken });
     if (!refreshError) {
       await this.supabaseService.getClient().auth.signOut({ scope: 'global' });
     }
     return { message: 'Logout successful' };
   }
 }

