import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { createHash, randomBytes } from 'crypto';
import { DataSource, MoreThan, MoreThanOrEqual, Repository } from 'typeorm';
import { ChatSession, ChatWidget } from '../database/entities/chat.entity';
import { Conversation } from '../database/entities/conversation.entity';
import { Message } from '../database/entities/message.entity';
import { User } from '../database/entities/user.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { CommunicationModule } from '../communication/communication.module';
import { InboxService } from '../communication/inbox.service';
import { CrmModule } from '../crm/crm.module';
import { ContactsService } from '../crm/contacts.service';

class WidgetDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) title?: string;
  @IsOptional() @IsString() @MaxLength(300) greeting?: string;
  @IsOptional() @IsIn(['none', 'email', 'name_email']) askFor?: 'none' | 'email' | 'name_email';
  @IsOptional() @Matches(/^(#[0-9a-fA-F]{6})?$/) color?: string;
  @IsOptional() @IsIn(['right', 'left']) position?: 'right' | 'left';
}
class StartDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MaxLength(500) pageUrl?: string;
  /** First message, sent along with starting the chat. */
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
}
class PostDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) body: string;
}
class PollQuery {
  @IsOptional() @IsDateString() after?: string;
}

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const KEY_RE = /^[A-Za-z0-9_-]{16,32}$/;

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatWidget) private readonly widgets: Repository<ChatWidget>,
    @InjectRepository(ChatSession) private readonly sessions: Repository<ChatSession>,
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly inbox: InboxService,
    private readonly contacts: ContactsService,
    private readonly ds: DataSource,
  ) {}

  // ---- Settings (staff) ----
  async settings(workspaceId: string) {
    let w = await this.widgets.findOne({ where: { workspaceId } });
    if (!w) {
      // Created lazily (off) so every workspace has a stable embed key.
      await this.widgets.createQueryBuilder().insert().into(ChatWidget).values({ workspaceId, publicKey: randomBytes(16).toString('base64url') }).orIgnore().execute();
      w = await this.widgets.findOneOrFail({ where: { workspaceId } });
    }
    return w;
  }

  async update(workspaceId: string, dto: WidgetDto) {
    const w = await this.settings(workspaceId);
    for (const k of Object.keys(dto) as Array<keyof WidgetDto>) {
      if (dto[k] !== undefined) (w as any)[k] = typeof dto[k] === 'string' ? (dto[k] as string).trim() : dto[k];
    }
    w.color = (w.color || '').toLowerCase();
    return this.widgets.save(w);
  }

  // ---- Public (widget) ----
  private async widget(key: string) {
    if (!KEY_RE.test(key)) throw new NotFoundException('Chat not found');
    const w = await this.widgets.findOne({ where: { publicKey: key } });
    if (!w) throw new NotFoundException('Chat not found');
    return w;
  }

  async publicConfig(key: string) {
    const w = await this.widget(key);
    let color = w.color;
    let name = '';
    const [row] = await this.ds.query(
      `SELECT w.name, o.branding->>'primaryColor' AS color FROM workspaces w LEFT JOIN organizations o ON o.id = w.organization_id WHERE w.id = $1`,
      [w.workspaceId],
    );
    if (!color) color = row?.color || '#5847d7';
    name = row?.name ?? '';
    return { enabled: w.enabled, title: w.title, greeting: w.greeting, askFor: w.askFor, color, position: w.position, businessName: name };
  }

  async start(key: string, dto: StartDto) {
    const w = await this.widget(key);
    if (!w.enabled) throw new ForbiddenException('Chat is turned off');
    const email = dto.email?.trim().toLowerCase() || null;
    const name = dto.name?.trim() || '';
    if (w.askFor !== 'none' && !email) throw new BadRequestException('Please enter your email');
    if (w.askFor === 'name_email' && !name) throw new BadRequestException('Please enter your name');
    const [firstName, ...rest] = name ? name.split(/\s+/) : [];
    // Matching by email links the chat to the existing contact for staff; the visitor still only sees this session's messages.
    const { contact } = email
      ? await this.contacts.upsert(w.workspaceId, { firstName: firstName || undefined, lastName: rest.join(' ') || undefined, email, source: 'chat' })
      : { contact: await this.contacts.create(w.workspaceId, { firstName: firstName || 'Website visitor', lastName: rest.join(' '), source: 'chat' } as any) };
    let conv = await this.conversations.findOne({ where: { workspaceId: w.workspaceId, contactId: contact.id, channel: 'chat' } });
    if (!conv) conv = await this.conversations.save(this.conversations.create({ workspaceId: w.workspaceId, contactId: contact.id, channel: 'chat', subject: 'Web chat' }));
    const token = randomBytes(32).toString('base64url');
    const session = await this.sessions.save(
      this.sessions.create({ workspaceId: w.workspaceId, contactId: contact.id, conversationId: conv.id, tokenHash: hash(token), pageUrl: (dto.pageUrl ?? '').slice(0, 500) }),
    );
    if (dto.message?.trim()) await this.inbox.receive(w.workspaceId, { contactId: contact.id, channel: 'chat', body: dto.message.trim() } as any);
    return { sessionId: session.id, token, messages: await this.feed(session) };
  }

  private async session(id: string, token: string | undefined) {
    if (!token) throw new UnauthorizedException('Missing chat token');
    const s = await this.sessions.findOne({ where: { id } });
    // Same error either way, so ids can't be probed.
    if (!s || s.tokenHash !== hash(token)) throw new UnauthorizedException('This chat has ended. Start a new one.');
    return s;
  }

  /** What the visitor sees: only messages since their session started. */
  private async feed(s: ChatSession, after?: string) {
    // Never earlier than the session itself: a visitor must not see what was said in someone else's session.
    const cursor = after ? new Date(after) : null;
    const rows = await this.messages.find({
      where: { conversationId: s.conversationId, createdAt: cursor && cursor >= s.createdAt ? MoreThan(cursor) : MoreThanOrEqual(s.createdAt) },
      order: { createdAt: 'ASC' },
      take: 200,
    });
    const staff = [...new Set(rows.map((m) => m.sentBy).filter(Boolean))] as string[];
    const names = new Map(
      staff.length ? (await this.users.find({ where: staff.map((id) => ({ id })), select: { id: true, name: true } })).map((u) => [u.id, u.name.split(/\s+/)[0]]) : [],
    );
    return rows
      .filter((m) => m.status !== 'failed')
      .map((m) => ({
        id: m.id,
        from: m.direction === 'inbound' ? 'visitor' : m.sentByBot ? 'bot' : 'agent',
        agent: m.sentBy ? names.get(m.sentBy) ?? null : null,
        body: m.body,
        createdAt: m.createdAt,
      }));
  }

  async poll(id: string, token: string | undefined, after?: string) {
    const s = await this.session(id, token);
    await this.sessions.update({ id: s.id }, { lastSeenAt: new Date() });
    // The conversation is "read" once the visitor's widget has fetched staff replies — nothing to do for staff unread counts.
    return { messages: await this.feed(s, after) };
  }

  async post(id: string, token: string | undefined, dto: PostDto) {
    const s = await this.session(id, token);
    const w = await this.widgets.findOne({ where: { workspaceId: s.workspaceId } });
    if (!w?.enabled) throw new ForbiddenException('Chat is turned off');
    const msg = await this.inbox.receive(s.workspaceId, { contactId: s.contactId, channel: 'chat', body: dto.body.trim() } as any);
    return { id: msg.id, from: 'visitor', agent: null, body: msg.body, createdAt: msg.createdAt };
  }
}

@Controller('chat-widget')
export class ChatSettingsController {
  constructor(private readonly svc: ChatService) {}

  @Get()
  @Permissions('conversations:read')
  get(@Tenant('workspaceId') ws: string) {
    return this.svc.settings(ws);
  }

  @Put()
  @Permissions('conversations:write')
  update(@Tenant('workspaceId') ws: string, @Body() dto: WidgetDto) {
    return this.svc.update(ws, dto);
  }
}

@Controller('public/chat')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class PublicChatController {
  constructor(private readonly svc: ChatService) {}

  @Get('widgets/:key')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  config(@Param('key') key: string) {
    return this.svc.publicConfig(key);
  }

  @Post('widgets/:key/sessions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(@Param('key') key: string, @Body() dto: StartDto) {
    return this.svc.start(key, dto);
  }

  @Get('sessions/:id/messages')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  poll(@Param('id', ParseUUIDPipe) id: string, @Headers('x-chat-token') token: string | undefined, @Query() q: PollQuery) {
    return this.svc.poll(id, token, q.after);
  }

  @Post('sessions/:id/messages')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  post(@Param('id', ParseUUIDPipe) id: string, @Headers('x-chat-token') token: string | undefined, @Body() dto: PostDto) {
    return this.svc.post(id, token, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([ChatWidget, ChatSession, Conversation, Message, User]), CommunicationModule, CrmModule],
  controllers: [ChatSettingsController, PublicChatController],
  providers: [ChatService],
})
export class ChatModule {}
