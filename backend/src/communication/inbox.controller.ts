import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { InboxService } from './inbox.service';
import { TrackingService } from '../tracking/tracking.service';
import { InboundMessageDto, SendMessageDto } from './dto';

@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService, private readonly tracking: TrackingService) {}

  @Get('conversations')
  @Permissions('conversations:read')
  list(
    @Tenant('workspaceId') ws: string,
    @Query('channel') channel?: string,
    @Query('search') search?: string,
  ) {
    return this.inbox.list(ws, { channel, search });
  }

  @Get('conversations/:id')
  @Permissions('conversations:read')
  get(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.get(ws, id);
  }

  @Get('messages/:id/html')
  @Permissions('conversations:read')
  html(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.messageHtml(ws, id);
  }

  /** Dev/test only: the html as delivered (with tracking). Disabled in production. */
  @Get('messages/:id/delivered-html')
  @Permissions('conversations:read')
  delivered(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    return this.tracking.deliveredHtml(ws, id);
  }

  @Put('conversations/:id/read')
  @Permissions('conversations:read')
  read(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.markRead(ws, id);
  }

  @Post('messages')
  @Permissions('conversations:write')
  async send(
    @Tenant('workspaceId') ws: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SendMessageDto,
  ) {
    const message = await this.inbox.send(ws, dto, userId);
    // A person is handling this thread now, so the AI assistant stops replying in it.
    await this.inbox.pauseBotForHuman(ws, message.conversationId);
    return message;
  }

  @Put('conversations/:id/bot')
  @Permissions('conversations:write')
  setBot(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body('paused') paused: boolean) {
    return this.inbox.setBot(ws, id, paused === true);
  }

  /** Records an inbound message (provider webhook bridge / manual logging). */
  @Post('inbound')
  @Permissions('conversations:write')
  inbound(@Tenant('workspaceId') ws: string, @Body() dto: InboundMessageDto) {
    return this.inbox.receive(ws, dto);
  }
}
