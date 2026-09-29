import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@supabase/supabase-js';
import {
  AccessToken,
  CurrentUser,
} from '../common/decorators/current-user.decorator.js';
import { RateLimit } from '../common/guards/rate-limit.guard.js';
import {
  extractBearerToken,
  SupabaseAuthGuard,
} from '../common/guards/supabase-auth.guard.js';
import { getClientIp } from '../common/security/client-ip.js';
import { ApiErrors } from '../common/swagger/api-docs.decorators.js';
import {
  AuthSessionResponse,
  MessageResponse,
  SignupResponse,
} from '../common/swagger/api-responses.js';
import { AuthService } from './auth.service.js';
import { ChangeEmailDto } from './dto/change-email.dto.js';
import { ForgotPasswordDto } from './dto/forgot.password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SignupDto } from './dto/signup.dto.js';

const MINUTE = 60_000;

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Public: Supabase Auth account banata hai (email verification ke saath).
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 5, windowMs: 15 * MINUTE })
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Creates a Supabase Auth account and sends a verification email. No session is returned; the user must verify the email before logging in. If the email is registered but not verified, a new verification email is sent and the message says so. Rate limit: 5 per 15 minutes per IP.',
  })
  @ApiCreatedResponse({ type: SignupResponse, description: 'Account created (or verification email re-sent for an unverified account)' })
  @ApiErrors({
    400: 'Validation failed (invalid email, weak password, unexpected fields)',
    403: 'New signups are disabled in Supabase',
    409: 'A verified account with this email already exists',
    429: 'Too many requests, or a verification email was sent moments ago',
    503: 'Verification email could not be sent, or Supabase is unavailable',
  })
  signup(@Body() signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  // Public: login karke Supabase session deta hai.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: MINUTE })
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Returns the user and a session (access + refresh token). 5 failed attempts for the same email from the same IP lock that pair for 15 minutes. Rate limit: 10 per minute per IP.',
  })
  @ApiOkResponse({ type: AuthSessionResponse })
  @ApiErrors({
    400: 'Validation failed',
    401: 'Invalid email or password (same message for unknown, deleted or disabled accounts)',
    403: 'Email not verified yet',
    429: 'Too many requests or too many failed attempts',
    503: 'Supabase is unavailable',
  })
  login(@Body() loginDto: LoginDto, @Req() request: Request) {
    return this.authService.login(loginDto, getClientIp(request));
  }

  @Post('resend-confirmation')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 15 * MINUTE })
  @ApiOperation({
    summary: 'Resend the verification email',
    description:
      'Always returns the same message, whether or not the account exists. Rate limit: 5 per 15 minutes per IP, 3 per email.',
  })
  @ApiOkResponse({ type: MessageResponse })
  @ApiErrors({ 400: 'Validation failed', 429: 'Too many requests', 503: 'Supabase is unavailable' })
  resendConfirmation(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.resendConfirmation(forgotPasswordDto.email);
  }

  // Public: account ke hone ya na hone ka pata nahi chalne deta.
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 15 * MINUTE })
  @ApiOperation({
    summary: 'Send a password reset email',
    description:
      'Sends a reset link to FRONTEND_URL/reset-password. Always returns the same message, so it never reveals whether the email is registered. Only the newest link works.',
  })
  @ApiOkResponse({ type: MessageResponse })
  @ApiErrors({ 400: 'Validation failed', 429: 'Too many requests', 503: 'Supabase is unavailable' })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  // Public: reset link wale recovery token se naya password set karta hai.
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 15 * MINUTE })
  @ApiOperation({
    summary: 'Set a new password using the reset link token',
    description:
      'Uses the access_token from the reset link. On success all sessions of the user are logged out, so the link cannot be reused.',
  })
  @ApiOkResponse({ type: MessageResponse })
  @ApiErrors({
    400: 'Weak password, same as the current password, or invalid body',
    401: 'Reset link invalid, expired, already used, or not a reset token',
    429: 'Too many requests',
    503: 'Supabase is unavailable',
  })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  // Public: refresh token se naya access token.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowMs: MINUTE })
  @ApiOperation({
    summary: 'Get a new access token',
    description: 'Returns a new session. The refresh token rotates: replace both stored tokens.',
  })
  @ApiOkResponse({ type: AuthSessionResponse })
  @ApiErrors({
    400: 'Validation failed',
    401: 'Refresh token invalid, expired, revoked or already used',
    429: 'Too many requests',
    503: 'Supabase is unavailable',
  })
  refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshSession(refreshTokenDto);
  }

  // Expired/invalid session pe bhi safe; refresh token ya Bearer token dono chalte hain.
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowMs: MINUTE })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Log out (end this session)',
    description:
      'Send the refresh token in the body and/or the access token as Bearer. The session is revoked on Supabase. Already expired sessions also return 200.',
  })
  @ApiOkResponse({ type: MessageResponse })
  @ApiErrors({ 429: 'Too many requests', 503: 'Supabase is unavailable' })
  logout(@Body() logoutDto: LogoutDto, @Req() request: Request) {
    return this.authService.logout(logoutDto, extractBearerToken(request));
  }

  // Protected: email change sirf Supabase ke confirmation flow se.
  @Post('change-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupabaseAuthGuard)
  @RateLimit({ limit: 5, windowMs: 15 * MINUTE })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Request an email change',
    description:
      'Sends a confirmation link. The email changes only after the user confirms it.',
  })
  @ApiOkResponse({ type: MessageResponse })
  @ApiErrors({
    400: 'Same as the current email, or invalid email',
    401: 'Missing, invalid or expired access token',
    409: 'Email already used by another account',
    429: 'Too many requests',
    503: 'Supabase is unavailable',
  })
  changeEmail(
    @CurrentUser() user: User,
    @AccessToken() accessToken: string,
    @Body() changeEmailDto: ChangeEmailDto,
  ) {
    return this.authService.changeEmail(user, accessToken, changeEmailDto);
  }
}
