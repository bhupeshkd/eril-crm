import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SwitchWorkspaceDto } from './dto/switch-workspace.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';

@Controller('auth')
@UseGuards(JwtAuthGuard)
@SkipTenant()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('verify-email')
  @Public()
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.authService.verifyEmail(dto.token);
    return { message: 'Email verified' };
  }

  @Post('forgot-password')
  @Public()
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If the email exists, a reset token has been issued' };
  }

  @Post('reset-password')
  @Public()
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password reset successful' };
  }

  @Get('invitations/:token')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async invitation(@Param('token') token: string) {
    return this.authService.invitationInfo(token);
  }

  /** Takes a password, so it gets a tight limit against guessing. */
  @Post('invitations/:token/accept')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(@Param('token') token: string, @Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvitation(token, dto);
  }

  @Post('switch-workspace')
  async switchWorkspace(
    @CurrentUser('id') userId: string,
    @Body() dto: SwitchWorkspaceDto,
  ) {
    return this.authService.switchWorkspace(userId, dto);
  }

  @Post('refresh')
  @Public()
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @Post('logout')
  async logout(@Body('refreshToken') refreshToken: string) {
    await this.authService.logout(refreshToken);
    return { message: 'Logged out' };
  }

  @Post('mfa/enable')
  async enableMfa(@CurrentUser('id') userId: string) {
    return this.authService.enableMfa(userId);
  }

  @Post('mfa/disable')
  async disableMfa(
    @CurrentUser('id') userId: string,
    @Body('code') code: string,
  ) {
    await this.authService.disableMfa(userId, code);
    return { message: 'MFA disabled' };
  }

  @Post('mfa/verify')
  async verifyMfa(
    @CurrentUser('id') userId: string,
    @Body('code') code: string,
  ) {
    return { accessToken: await this.authService.verifyMfaToken(userId, code) };
  }

  @Get('me')
  async me(@CurrentUser() user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      currentOrganizationId: user.currentOrganizationId,
      currentWorkspaceId: user.currentWorkspaceId,
      workspaceMemberships: user.workspaceMemberships,
      permissions: user.permissions,
    };
  }
}
