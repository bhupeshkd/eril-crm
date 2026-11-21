import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { randomBytes } from 'crypto';
import type { Response } from 'express';
import { Repository } from 'typeorm';
import { QrCode, QrScan } from '../database/entities/blog.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { deviceOf, isSafeUrl, withUtm } from '../sites/blog-text';
import { qrSvg } from './encoder';

class QrFieldsDto {
  @IsOptional() @IsString() @MaxLength(2000) destination?: string;
  @IsOptional() @IsBoolean() utm?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsOptional() @IsIn(['L', 'M', 'Q', 'H']) ecLevel?: 'L' | 'M' | 'Q' | 'H';
}
class CreateQrDto extends QrFieldsDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) declare destination: string;
}
class UpdateQrDto extends QrFieldsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
}

const CODE_RE = /^[A-Za-z0-9]{8}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const newCode = () => [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join('');

@Injectable()
export class QrService {
  constructor(
    @InjectRepository(QrCode) private readonly codes: Repository<QrCode>,
    @InjectRepository(QrScan) private readonly scansRepo: Repository<QrScan>,
    private readonly config: ConfigService,
  ) {}

  /** The URL printed in the code (stable even when the destination changes). */
  scanUrl(code: string) {
    const base = this.config.get<string>('API_PUBLIC_URL') || `http://localhost:${this.config.get('API_PORT') || 3001}`;
    const prefix = this.config.get<string>('API_GLOBAL_PREFIX') || 'api/v1';
    return `${base.replace(/\/$/, '')}/${prefix}/public/qr/${code}`;
  }

  private view(q: QrCode) {
    return { ...q, scanUrl: this.scanUrl(q.code) };
  }

  list(workspaceId: string) {
    return this.codes.find({ where: { workspaceId }, order: { createdAt: 'DESC' } }).then((r) => r.map((q) => this.view(q)));
  }

  async get(workspaceId: string, id: string) {
    const q = await this.codes.findOne({ where: { id, workspaceId } });
    if (!q) throw new NotFoundException('QR code not found');
    return q;
  }

  private checkDestination(u: string) {
    if (!isSafeUrl(u.trim())) throw new BadRequestException('Destination must be a full http:// or https:// link');
    return u.trim();
  }

  async create(workspaceId: string, dto: CreateQrDto) {
    const q = this.codes.create({
      workspaceId,
      name: dto.name.trim(),
      destination: this.checkDestination(dto.destination),
      utm: dto.utm ?? true,
      isActive: dto.isActive ?? true,
      color: (dto.color ?? '#000000').toLowerCase(),
      ecLevel: dto.ecLevel ?? 'M',
      scans: 0,
    });
    for (let i = 0; i < 5; i++) {
      q.code = newCode();
      if (!(await this.codes.exist({ where: { code: q.code }, withDeleted: true }))) break;
    }
    return this.view(await this.codes.save(q));
  }

  async update(workspaceId: string, id: string, dto: UpdateQrDto) {
    const q = await this.get(workspaceId, id);
    if (dto.name !== undefined) q.name = dto.name.trim();
    if (dto.destination !== undefined) q.destination = this.checkDestination(dto.destination);
    if (dto.utm !== undefined) q.utm = dto.utm;
    if (dto.isActive !== undefined) q.isActive = dto.isActive;
    if (dto.color !== undefined) q.color = dto.color.toLowerCase();
    if (dto.ecLevel !== undefined) q.ecLevel = dto.ecLevel;
    return this.view(await this.codes.save(q));
  }

  async remove(workspaceId: string, id: string) {
    const q = await this.get(workspaceId, id);
    await this.scansRepo.delete({ qrCodeId: q.id });
    // Soft delete keeps the code reserved, so a printed code is never reused for something else.
    await this.codes.softRemove(q);
    return { id };
  }

  async svg(workspaceId: string, id: string) {
    const q = await this.get(workspaceId, id);
    return { svg: qrSvg(this.scanUrl(q.code), { ec: q.ecLevel, color: q.color }), name: q.name };
  }

  async stats(workspaceId: string, id: string) {
    const q = await this.get(workspaceId, id);
    const [days, devices] = await Promise.all([
      this.scansRepo.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(s.id)::int AS scans
           FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, interval '1 day') d
           LEFT JOIN qr_scans s ON s.qr_code_id = $1 AND s.created_at >= d AND s.created_at < d + interval '1 day' AND s.deleted_at IS NULL
          GROUP BY d ORDER BY d`,
        [q.id],
      ),
      this.scansRepo.query(`SELECT device, COUNT(*)::int AS scans FROM qr_scans WHERE qr_code_id = $1 AND deleted_at IS NULL GROUP BY device ORDER BY scans DESC`, [q.id]),
    ]);
    return { total: q.scans, lastScannedAt: q.lastScannedAt, days, devices };
  }

  /** Public scan: count it and return where to send the visitor (null = unknown or switched off). */
  async scan(code: string, ua: string | undefined): Promise<string | null> {
    if (!CODE_RE.test(code)) return null;
    const q = await this.codes.findOne({ where: { code } });
    if (!q || !q.isActive) return null;
    await this.codes.update({ id: q.id }, { scans: () => 'scans + 1', lastScannedAt: new Date() });
    await this.scansRepo.insert({ workspaceId: q.workspaceId, qrCodeId: q.id, device: deviceOf(ua) });
    return q.utm ? withUtm(q.destination, q.name) : q.destination;
  }
}

@Controller('qr-codes')
export class QrController {
  constructor(private readonly svc: QrService) {}

  @Get()
  @Permissions('campaigns:read')
  list(@Tenant('workspaceId') ws: string) {
    return this.svc.list(ws);
  }

  @Post()
  @Permissions('campaigns:write')
  create(@Tenant('workspaceId') ws: string, @Body() dto: CreateQrDto) {
    return this.svc.create(ws, dto);
  }

  @Put(':id')
  @Permissions('campaigns:write')
  update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQrDto) {
    return this.svc.update(ws, id, dto);
  }

  @Delete(':id')
  @Permissions('campaigns:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, id);
  }

  @Get(':id/stats')
  @Permissions('campaigns:read')
  stats(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.stats(ws, id);
  }

  /** The code as SVG (vector, prints at any size). ?download=1 saves it as a file. */
  @Get(':id/svg')
  @Permissions('campaigns:read')
  async svg(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Query('download') download: string, @Res() res: Response) {
    const { svg, name } = await this.svc.svg(ws, id);
    res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (download) res.set('Content-Disposition', `attachment; filename="${name.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'qr-code'}.svg"`);
    res.send(svg);
  }
}

@Controller('public/qr')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class PublicQrController {
  constructor(private readonly svc: QrService) {}

  @Get(':code')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async scan(@Param('code') code: string, @Headers('user-agent') ua: string, @Res() res: Response) {
    const target = await this.svc.scan(code, ua).catch(() => null);
    res.set('Cache-Control', 'no-store');
    if (!target) {
      res.status(404).type('text/html').send('<!doctype html><meta name="viewport" content="width=device-width"><title>QR code</title><p style="font-family:system-ui;margin:3rem auto;max-width:28rem;text-align:center;color:#334155">This QR code is no longer active.</p>');
      return;
    }
    res.redirect(302, target);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([QrCode, QrScan])],
  controllers: [QrController, PublicQrController],
  providers: [QrService],
})
export class QrModule {}
