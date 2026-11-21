import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsArray, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { EMAIL_BLOCK_TYPES, EMAIL_STARTERS, EmailBlock, EmailDesign, EmailTheme, renderEmail } from '@eril/shared';
import { EmailTemplate } from '../database/entities/email-template.entity';
import { Contact } from '../database/entities/contact.entity';
import { Workspace } from '../database/entities/workspace.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { CommunicationModule } from '../communication/communication.module';
import { InboxService } from '../communication/inbox.service';
import { interpolate } from '../automation/conditions';

class TemplateFieldsDto {
  @IsOptional() @IsString() @MaxLength(255) subject?: string;
  @IsOptional() @IsString() @MaxLength(255) previewText?: string;
  @IsOptional() @IsObject() theme?: EmailTheme;
  @IsOptional() @IsArray() blocks?: EmailBlock[];
}
export class CreateTemplateDto extends TemplateFieldsDto {
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;
  @IsOptional() @IsIn(Object.keys(EMAIL_STARTERS)) starter?: string;
}
export class UpdateTemplateDto extends TemplateFieldsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
}
class PreviewDto extends TemplateFieldsDto {
  @IsOptional() @IsUUID() contactId?: string;
}
class TestSendDto {
  @IsUUID() contactId: string;
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Structural validation; the renderer escapes all content, this just bounds size and shape. */
export function sanitizeBlocks(blocks: any[]): EmailBlock[] {
  if (!Array.isArray(blocks)) throw new BadRequestException('blocks must be an array');
  if (blocks.length > 80) throw new BadRequestException('A template can have at most 80 blocks');
  return blocks.map((b, i) => {
    if (!b || !EMAIL_BLOCK_TYPES.includes(b.type)) throw new BadRequestException(`Block ${i + 1}: unknown type "${b?.type}"`);
    const props: Record<string, any> = {};
    for (const [k, v] of Object.entries(b.props ?? {}).slice(0, 20)) {
      if (typeof v === 'string') props[k] = v.slice(0, 10_000);
      else if (typeof v === 'number' && Number.isFinite(v)) props[k] = v;
    }
    return { id: typeof b.id === 'string' && /^[\w-]{1,40}$/.test(b.id) ? b.id : randomUUID().slice(0, 8), type: b.type, props };
  });
}

function sanitizeTheme(t: EmailTheme = {}): EmailTheme {
  const c = (v?: string) => (v && COLOR_RE.test(v) ? v : undefined);
  return { background: c(t.background), contentBackground: c(t.contentBackground), primaryColor: c(t.primaryColor), textColor: c(t.textColor), font: t.font === 'serif' ? 'serif' : 'sans' };
}

@Injectable()
export class EmailTemplatesService {
  constructor(
    @InjectRepository(EmailTemplate) private readonly templates: Repository<EmailTemplate>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
    private readonly inbox: InboxService,
  ) {}

  starters() {
    return Object.entries(EMAIL_STARTERS).map(([key, s]) => ({ key, name: s.name, description: s.description, design: s.design }));
  }

  list(workspaceId: string) {
    return this.templates.find({ where: { workspaceId }, order: { updatedAt: 'DESC' } });
  }

  async get(workspaceId: string, id: string) {
    const t = await this.templates.findOne({ where: { id, workspaceId } });
    if (!t) throw new NotFoundException('Email template not found');
    return t;
  }

  create(workspaceId: string, dto: CreateTemplateDto) {
    const base: EmailDesign = dto.starter ? JSON.parse(JSON.stringify(EMAIL_STARTERS[dto.starter].design)) : EMAIL_STARTERS.blank.design;
    return this.templates.save(
      this.templates.create({
        workspaceId,
        name: dto.name,
        subject: dto.subject ?? base.subject ?? '',
        previewText: dto.previewText ?? base.previewText ?? '',
        theme: sanitizeTheme(dto.theme ?? base.theme),
        blocks: sanitizeBlocks(dto.blocks ?? base.blocks),
      }),
    );
  }

  async update(workspaceId: string, id: string, dto: UpdateTemplateDto) {
    const t = await this.get(workspaceId, id);
    if (dto.name !== undefined) t.name = dto.name;
    if (dto.subject !== undefined) t.subject = dto.subject;
    if (dto.previewText !== undefined) t.previewText = dto.previewText;
    if (dto.theme !== undefined) t.theme = sanitizeTheme(dto.theme);
    if (dto.blocks !== undefined) t.blocks = sanitizeBlocks(dto.blocks);
    return this.templates.save(t);
  }

  async duplicate(workspaceId: string, id: string) {
    const t = await this.get(workspaceId, id);
    return this.templates.save(this.templates.create({ workspaceId, name: `${t.name} (copy)`, subject: t.subject, previewText: t.previewText, theme: t.theme, blocks: t.blocks }));
  }

  async remove(workspaceId: string, id: string) {
    const t = await this.get(workspaceId, id);
    await this.templates.softRemove(t);
    return { id };
  }

  private async businessName(workspaceId: string) {
    const ws = await this.workspaces.findOne({ where: { id: workspaceId }, relations: { organization: true } });
    return ws?.organization?.name ?? ws?.name ?? '';
  }

  /** Renders a design for one contact (merge fields filled, everything escaped). */
  async renderFor(workspaceId: string, design: EmailDesign, contact: Partial<Contact> | null, opts: { unsubscribeUrl?: string; extra?: Record<string, any> } = {}) {
    const ctx = { contact: contact ?? {}, business: { name: await this.businessName(workspaceId) }, ...(opts.extra ?? {}) };
    return renderEmail(design, { merge: (s) => interpolate(s, ctx), unsubscribeUrl: opts.unsubscribeUrl });
  }

  async preview(workspaceId: string, id: string | null, dto: PreviewDto) {
    const saved = id ? await this.get(workspaceId, id) : null;
    const design: EmailDesign = {
      subject: dto.subject ?? saved?.subject ?? '',
      previewText: dto.previewText ?? saved?.previewText ?? '',
      theme: sanitizeTheme(dto.theme ?? saved?.theme),
      blocks: sanitizeBlocks(dto.blocks ?? saved?.blocks ?? []),
    };
    const contact = dto.contactId
      ? await this.contacts.findOne({ where: { id: dto.contactId, workspaceId } })
      : ({ firstName: 'Alex', lastName: 'Sample', email: 'alex@example.com' } as Partial<Contact>);
    if (dto.contactId && !contact) throw new NotFoundException('Contact not found');
    return this.renderFor(workspaceId, design, contact);
  }

  async testSend(workspaceId: string, id: string, contactId: string, userId?: string | null) {
    const t = await this.get(workspaceId, id);
    const contact = await this.contacts.findOne({ where: { id: contactId, workspaceId } });
    if (!contact) throw new NotFoundException('Contact not found');
    if (!contact.email) throw new BadRequestException('That contact has no email address');
    const r = await this.renderFor(workspaceId, t, contact);
    const msg = await this.inbox.send(workspaceId, { contactId, channel: 'email', subject: `[Test] ${r.subject || t.name}`, body: r.text }, userId, { html: r.html });
    if (msg.status === 'failed') throw new BadRequestException(`Send failed: ${msg.error}`);
    return { ok: true, to: contact.email };
  }
}

@Controller('email-templates')
export class EmailTemplatesController {
  constructor(private readonly svc: EmailTemplatesService) {}

  @Get('starters')
  @Permissions('campaigns:read')
  starters() {
    return this.svc.starters();
  }

  @Post('preview')
  @Permissions('campaigns:read')
  previewUnsaved(@Tenant('workspaceId') ws: string, @Body() dto: PreviewDto) {
    return this.svc.preview(ws, null, dto);
  }

  @Get()
  @Permissions('campaigns:read')
  list(@Tenant('workspaceId') ws: string) {
    return this.svc.list(ws);
  }

  @Post()
  @Permissions('campaigns:write')
  create(@Tenant('workspaceId') ws: string, @Body() dto: CreateTemplateDto) {
    return this.svc.create(ws, dto);
  }

  @Get(':id')
  @Permissions('campaigns:read')
  get(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ws, id);
  }

  @Put(':id')
  @Permissions('campaigns:write')
  update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTemplateDto) {
    return this.svc.update(ws, id, dto);
  }

  @Post(':id/duplicate')
  @Permissions('campaigns:write')
  duplicate(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.duplicate(ws, id);
  }

  @Delete(':id')
  @Permissions('campaigns:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, id);
  }

  @Post(':id/preview')
  @Permissions('campaigns:read')
  preview(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PreviewDto) {
    return this.svc.preview(ws, id, dto);
  }

  @Post(':id/test')
  @Permissions('campaigns:send')
  test(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TestSendDto) {
    return this.svc.testSend(ws, id, dto.contactId, userId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([EmailTemplate, Contact, Workspace]), CommunicationModule],
  controllers: [EmailTemplatesController],
  providers: [EmailTemplatesService],
  exports: [EmailTemplatesService],
})
export class EmailTemplatesModule {}
