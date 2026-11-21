import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from './health.service';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';

@Controller('health')
@Public()
@SkipTenant()
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async check() {
    const db = await this.db.ping();
    return {
      status: db ? 'ok' : 'degraded',
      database: db ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
