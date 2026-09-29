import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@supabase/supabase-js';
import { AttemptCounter } from '../common/security/attempt-counter.js';
import { PASSWORD_POLICY_MESSAGE } from '../common/validation/auth-fields.js';
import {
  describeAuthError,
  getAuthMethods,
  isServiceFailure,
  serviceUnavailable,
} from '../supabase/supabase-errors.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { ChangeEmailDto } from './dto/change-email.dto.js';
import { ForgotPasswordDto } from './dto/forgot.password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SignupDto } from './dto/signup.dto.js';

// Brute-force: ek IP + email pe 15 minute me 5 ghalat attempts ke baad lock.
const MAX_FAILED_LOGINS = 5;
const FAILED_LOGIN_WINDOW_MS = 15 * 60_000;
// Forgot/resend: ek email pe 15 minute me 3 emails; us ke baad chup chaap ignore.
const MAX_EMAIL_REQUESTS = 3;
const EMAIL_REQUEST_WINDOW_MS = 15 * 60_000;
// Reset password sirf un tokens se jo email ke zariye mile hon (normal login token se nahi).
const RESET_AUTH_METHODS = ['recovery', 'otp', 'magiclink'];

const SIGNUP_MESSAGE =
  'Account created. Please check your email and verify your account before logging in.';
const FORGOT_PASSWORD_MESSAGE =
  'If an account exists for this email, a password reset link has been sent.';
const RESEND_MESSAGE =
  'If an unverified account exists for this email, a confirmation email has been sent.';
const INVALID_RESET_MESSAGE =
  'This password reset link is invalid, expired or has already been used. Please request a new one.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly failedLogins = new AttemptCounter(
    MAX_FAILED_LOGINS,
    FAILED_LOGIN_WINDOW_MS,
  );
  private readonly emailRequests = new AttemptCounter(
    MAX_EMAIL_REQUESTS,
    EMAIL_REQUEST_WINDOW_MS,
  );

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  // Signup Supabase Auth se hota hai; password kabhi hamare database me store nahi hota.
  // Profile row database trigger (003_profile_auth_trigger.sql) khud banata hai.
  async signup(signupDto: SignupDto) {
    const { data, error } = await this.supabaseService
      .createAuthClient()
      .auth.signUp({
        email: signupDto.email,
        password: signupDto.password,
        options: { emailRedirectTo: this.frontendUrl('/login') },
      });

    if (error) {
      this.logger.warn(`Signup failed: ${describeAuthError(error)}`);

      if (isServiceFailure(error)) throw serviceUnavailable();
      if (error.status === 429) {
        throw new HttpException(
          'Too many signup attempts. Please try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (error.code === 'signup_disabled') {
        throw new ForbiddenException(
          'New account registration is currently disabled',
        );
      }
      if (error.code === 'weak_password') {
        throw new BadRequestException(PASSWORD_POLICY_MESSAGE);
      }
      if (error.code === 'email_address_invalid') {
        throw new BadRequestException('Please enter a valid email address');
      }
      // Sirf tab aata hai jab "Confirm email" band ho; confirm ON me Supabase
      // duplicate pe bhi success jaisa jawab deta hai (neeche handle hai).
      if (error.code === 'user_already_exists' || error.code === 'email_exists') {
        throw new ConflictException('An account with this email already exists');
      }
      throw new BadRequestException('Unable to create account');
    }

    if (!data.user) throw serviceUnavailable();

    // Session mila = Supabase me "Confirm email" band hai (startup log me warning aati hai).
    // Ye session client ko nahi dete, is liye server pe bhi khatam kar dete hain.
    if (data.session) {
      await this.revokeSession(data.session.access_token, 'local');
      return {
        message: 'Account created successfully. You can now log in.',
        requiresEmailConfirmation: false,
      };
    }

    // Duplicate email (confirm ON): Supabase identities khali bhejta hai.
    // Account enumeration se bachne ke liye jawab bilkul naye account jaisa hi hai.
    return { message: SIGNUP_MESSAGE, requiresEmailConfirmation: true };
  }

  async resendConfirmation(email: string) {
    if (!this.emailRequests.hit(`resend:${email}`).allowed) {
      return { message: RESEND_MESSAGE };
    }

    const { error } = await this.supabaseService.getClient().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: this.frontendUrl('/login') },
    });

    if (error) {
      this.logger.warn(`Resend confirmation failed: ${describeAuthError(error)}`);
      // Sirf network failure batate hain; baaki errors (rate limit, email failure)
      // account ke hone/na hone par depend karte hain, is liye generic jawab.
      if (!error.status || error.name === 'AuthRetryableFetchError') {
        throw serviceUnavailable();
      }
    }

    return { message: RESEND_MESSAGE };
  }

  async login(loginDto: LoginDto, clientIp: string) {
    const attemptKey = `${clientIp}|${loginDto.email}`;
    const lock = this.failedLogins.isBlocked(attemptKey);
    if (lock.blocked) throw this.tooManyLoginAttempts(lock.retryAfterSeconds);

    const { data, error } = await this.supabaseService
      .createAuthClient()
      .auth.signInWithPassword({
        email: loginDto.email,
        password: loginDto.password,
      });

    if (error) {
      if (isServiceFailure(error)) {
        this.logger.error(`Login failed: ${describeAuthError(error)}`);
        throw serviceUnavailable();
      }
      if (error.status === 429) {
        throw new HttpException(
          'Too many login attempts. Please try again later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      // Supabase ye sirf sahi password ke baad batata hai, is liye enumeration nahi.
      if (error.code === 'email_not_confirmed') {
        throw new ForbiddenException(
          'Please verify your email before logging in',
        );
      }

      // Ghalat password, na-mojood, deleted ya banned account: sab ka ek hi jawab.
      const attempt = this.failedLogins.hit(attemptKey);
      if (!attempt.allowed) throw this.tooManyLoginAttempts(attempt.retryAfterSeconds);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!data.user || !data.session) throw serviceUnavailable();

    // Defense in depth: agar kabhi unverified user ko session mil jaye to bhi rok do.
    if (!data.user.email_confirmed_at) {
      await this.revokeSession(data.session.access_token, 'local');
      throw new ForbiddenException('Please verify your email before logging in');
    }

    this.failedLogins.reset(attemptKey);
    return {
      message: 'Login successful',
      user: this.toPublicUser(data.user),
      session: this.toPublicSession(data.session),
    };
  }

  // Jawab hamesha same, chahe email registered ho ya na ho.
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const email = forgotPasswordDto.email;
    if (!this.emailRequests.hit(`forgot:${email}`).allowed) {
      return { message: FORGOT_PASSWORD_MESSAGE };
    }

    const { error } = await this.supabaseService
      .getClient()
      .auth.resetPasswordForEmail(email, {
        redirectTo: this.frontendUrl('/reset-password'),
      });

    if (error) {
      this.logger.error(`Password reset email failed: ${describeAuthError(error)}`);
      // Network failure har email pe same hota hai, is liye batana safe hai.
      if (!error.status || error.name === 'AuthRetryableFetchError') {
        throw serviceUnavailable();
      }
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  // Reset link ka recovery token validate karke naya password set karta hai,
  // phir us user ke saare sessions (reset session samet) khatam kar deta hai,
  // taake wahi link dobara use na ho sake.
  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const token = resetPasswordDto.accessToken;
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.getUser(token);

    if (error) {
      if (isServiceFailure(error)) {
        this.logger.error(`Reset token check failed: ${describeAuthError(error)}`);
        throw serviceUnavailable();
      }
      throw new UnauthorizedException(INVALID_RESET_MESSAGE);
    }
    if (!data.user) throw new UnauthorizedException(INVALID_RESET_MESSAGE);

    const methods = getAuthMethods(token);
    if (!methods.some((method) => RESET_AUTH_METHODS.includes(method))) {
      throw new UnauthorizedException(INVALID_RESET_MESSAGE);
    }

    // Password user ke recovery token se hi update hota hai (service-role key ke baghair)
    const update = await this.supabaseService.updatePassword(
      token,
      resetPasswordDto.password,
    );

    if (update.status < 200 || update.status >= 300) {
      if (update.code === 'same_password') {
        throw new BadRequestException(
          'New password must be different from your current password',
        );
      }
      if (update.code === 'weak_password') {
        throw new BadRequestException(PASSWORD_POLICY_MESSAGE);
      }
      if (!update.status || update.status >= 500) {
        this.logger.error(`Password update failed: status=${update.status} code=${update.code ?? 'none'}`);
        throw serviceUnavailable();
      }
      // Session beech me khatam ho gaya ya user delete ho gaya
      if ([401, 403, 404].includes(update.status) || update.code === 'reauthentication_needed') {
        throw new UnauthorizedException(INVALID_RESET_MESSAGE);
      }
      this.logger.warn(`Password update rejected: status=${update.status} code=${update.code ?? 'none'}`);
      throw new BadRequestException('Unable to reset password');
    }

    await this.revokeSession(token, 'global');

    return {
      message: 'Password reset successfully. Please log in with your new password.',
    };
  }

  async refreshSession(refreshTokenDto: RefreshTokenDto) {
    const { data, error } = await this.supabaseService
      .createAuthClient()
      .auth.refreshSession({ refresh_token: refreshTokenDto.refreshToken });

    if (error) {
      if (isServiceFailure(error)) {
        this.logger.error(`Session refresh failed: ${describeAuthError(error)}`);
        throw serviceUnavailable();
      }
      // Expired, revoked, already-used ya ghalat refresh token
      throw new UnauthorizedException(
        'Your session has expired. Please log in again',
      );
    }

    if (!data.user || !data.session) {
      throw new UnauthorizedException(
        'Your session has expired. Please log in again',
      );
    }

    return {
      message: 'Session refreshed successfully',
      user: this.toPublicUser(data.user),
      session: this.toPublicSession(data.session),
    };
  }

  // Sirf is device ka session server pe khatam hota hai (scope "local").
  // Pehle se expired/invalid session bhi "logout successful" hi deta hai.
  async logout(logoutDto: LogoutDto, bearerToken?: string) {
    let accessToken: string | undefined;

    if (logoutDto.refreshToken) {
      const { data, error } = await this.supabaseService
        .createAuthClient()
        .auth.refreshSession({ refresh_token: logoutDto.refreshToken });

      if (error && isServiceFailure(error)) {
        this.logger.error(`Logout refresh failed: ${describeAuthError(error)}`);
        throw serviceUnavailable();
      }
      accessToken = data.session?.access_token;
    }

    accessToken ??= bearerToken;
    if (accessToken) await this.revokeSession(accessToken, 'local');

    return { message: 'Logout successful' };
  }

  // Email profile update se nahi, Supabase ke confirm-link flow se badalta hai.
  async changeEmail(user: User, accessToken: string, changeEmailDto: ChangeEmailDto) {
    if (changeEmailDto.newEmail === user.email?.toLowerCase()) {
      throw new BadRequestException(
        'New email must be different from your current email',
      );
    }

    const result = await this.supabaseService.requestEmailChange(
      accessToken,
      changeEmailDto.newEmail,
      this.frontendUrl('/login'),
    );

    if (result.status >= 200 && result.status < 300) {
      return {
        message:
          'Confirmation email sent. Your email will change only after you confirm the link sent to your email.',
      };
    }

    if (!result.status || result.status >= 500) {
      this.logger.error(`Email change failed: status=${result.status} code=${result.code ?? 'none'}`);
      throw serviceUnavailable();
    }
    if (result.code === 'email_exists' || result.code === 'user_already_exists') {
      throw new ConflictException('This email address is already in use');
    }
    if (result.code === 'email_address_invalid') {
      throw new BadRequestException('Please enter a valid email address');
    }
    if (result.status === 429) {
      throw new HttpException(
        'Too many email change requests. Please try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (result.status === 401 || result.status === 403) {
      throw new UnauthorizedException('Your session has expired. Please log in again');
    }
    this.logger.warn(`Email change rejected: status=${result.status} code=${result.code ?? 'none'}`);
    throw new BadRequestException('Unable to change email');
  }

  private async revokeSession(accessToken: string, scope: 'local' | 'global') {
    const result = await this.supabaseService.signOut(accessToken, scope);
    // Pehle se expired/revoked session (401/403/404): kuch karna nahi
    if (!result.status || result.status >= 500) {
      this.logger.error(`Session revoke failed: status=${result.status} code=${result.code ?? 'none'}`);
    }
  }

  private tooManyLoginAttempts(retryAfterSeconds: number) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    return new HttpException(
      `Too many failed login attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private frontendUrl(path: string): string {
    const base = (
      this.configService.get<string>('app.frontendUrl') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private toPublicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      emailConfirmedAt: user.email_confirmed_at ?? null,
    };
  }

  private toPublicSession(session: {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
    expires_in: number;
  }) {
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at,
      expiresIn: session.expires_in,
    };
  }
}
