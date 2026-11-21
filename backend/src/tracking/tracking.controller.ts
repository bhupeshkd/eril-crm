import { Body, Controller, Get, Headers, Param, Put, Query, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { IsBoolean, IsOptional } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { TrackingService } from './tracking.service';

// 1×1 transparent GIF
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

class TrackingSettingsDto {
  @IsOptional() @IsBoolean() opens?: boolean;
  @IsOptional() @IsBoolean() clicks?: boolean;
}

/** Public endpoints hit from recipients' mail clients. */
@Controller('t')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
@SkipThrottle() // mail clients/proxies share IPs; the endpoints are cheap and idempotent
export class TrackingPublicController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('o/:file')
  async open(@Param('file') file: string, @Headers('user-agent') ua: string, @Res() res: Response) {
    const token = file.replace(/\.gif$/, '');
    // Always answer with the pixel, even when the token is unknown (don't leak validity).
    await this.tracking.recordOpen(token, ua).catch(() => {});
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, private', Pragma: 'no-cache' });
    res.send(PIXEL);
  }

  @Get('c/:token')
  async click(@Param('token') token: string, @Query('u') url: string, @Query('s') sig: string, @Headers('user-agent') ua: string, @Res() res: Response) {
    try {
      const target = await this.tracking.recordClick(token, url, sig, ua);
      res.redirect(302, target);
    } catch {
      res.status(404).type('text/plain').send('This link is not valid.');
    }
  }
}

@Controller('tracking')
export class TrackingSettingsController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('settings')
  @Permissions('campaigns:read')
  get(@Tenant('workspaceId') ws: string) {
    return this.tracking.settings(ws);
  }

  @Put('settings')
  @Permissions('workspaces:write')
  save(@Tenant('workspaceId') ws: string, @Body() dto: TrackingSettingsDto) {
    return this.tracking.saveSettings(ws, dto);
  }
}
