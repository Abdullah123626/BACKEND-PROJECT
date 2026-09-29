import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
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
import { AuthService } from './auth.service.js';
import { ChangeEmailDto } from './dto/change-email.dto.js';
import { ForgotPasswordDto } from './dto/forgot.password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SignupDto } from './dto/signup.dto.js';

const MINUTE = 60_000;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Public: Supabase Auth account banata hai (email verification ke saath).
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 5, windowMs: 15 * MINUTE })
  signup(@Body() signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  // Public: login karke Supabase session deta hai.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: MINUTE })
  login(@Body() loginDto: LoginDto, @Req() request: Request) {
    return this.authService.login(loginDto, getClientIp(request));
  }

  @Post('resend-confirmation')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 15 * MINUTE })
  resendConfirmation(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.resendConfirmation(forgotPasswordDto.email);
  }

  // Public: account ke hone ya na hone ka pata nahi chalne deta.
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 15 * MINUTE })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  // Public: reset link wale recovery token se naya password set karta hai.
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 15 * MINUTE })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  // Public: refresh token se naya access token.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowMs: MINUTE })
  refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshSession(refreshTokenDto);
  }

  // Expired/invalid session pe bhi safe; refresh token ya Bearer token dono chalte hain.
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowMs: MINUTE })
  logout(@Body() logoutDto: LogoutDto, @Req() request: Request) {
    return this.authService.logout(logoutDto, extractBearerToken(request));
  }

  // Protected: email change sirf Supabase ke confirmation flow se.
  @Post('change-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SupabaseAuthGuard)
  @RateLimit({ limit: 5, windowMs: 15 * MINUTE })
  changeEmail(
    @CurrentUser() user: User,
    @AccessToken() accessToken: string,
    @Body() changeEmailDto: ChangeEmailDto,
  ) {
    return this.authService.changeEmail(user, accessToken, changeEmailDto);
  }
}
