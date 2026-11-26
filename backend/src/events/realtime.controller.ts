import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Tenant } from '../common/decorators/tenant.decorator';
import { DomainEvent, EventsService } from './events.service';

const fullName = (c: any) => (c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() : '');

/** Short, safe, human-readable summary of a domain event for live notifications. */
export function describeEvent(e: DomainEvent): { title: string; href?: string } | null {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'message.received':
      return { title: `New ${p.message?.channel ?? 'message'} from ${fullName(p.contact)}`, href: `/inbox?c=${p.conversationId}` };
    case 'conversation.handed_off':
      return { title: 'The AI assistant handed a conversation to your team', href: `/inbox?c=${p.conversationId}` };
    case 'call.missed':
      return { title: `Missed call from ${fullName(p.contact) || p.call?.from}${p.textedBack ? ' — texted back' : ''}`, href: '/calls' };
    case 'contact.created':
      return { title: `New contact: ${fullName(p.contact)}`, href: `/contacts/${e.contactId}` };
    case 'form.submitted':
      return { title: `Form submitted: ${p.form?.name}`, href: e.contactId ? `/contacts/${e.contactId}` : '/forms' };
    case 'appointment.booked':
      return { title: `Appointment booked: ${p.calendar?.name}${p.host ? ` with ${p.host.name}` : ''}`, href: '/calendars' };
    case 'community.post_created':
      return { title: `${p.author} posted in ${p.community?.name} #${p.channel?.name}`, href: `/communities/${p.community?.id}` };
    case 'community.member_joined':
      return { title: `${fullName(p.contact)} joined ${p.community?.name}`, href: `/communities/${p.community?.id}?tab=members` };
    case 'order.submitted':
      return { title: `New order on “${p.form?.name}” (${p.invoice?.currency} ${p.invoice?.total})`, href: '/payments?tab=orders' };
    case 'order.paid':
      return { title: `Order paid: ${p.invoice?.currency} ${p.invoice?.total}${p.form?.name ? ` via “${p.form.name}”` : ''}`, href: '/payments?tab=orders' };
    case 'appointment.status_changed':
      return { title: `Appointment marked ${p.status}`, href: '/calendars' };
    case 'invoice.paid':
      return { title: `Invoice ${p.invoice?.number} paid (${p.invoice?.currency} ${p.invoice?.total})`, href: '/payments' };
    case 'opportunity.stage_changed':
      return { title: `Deal "${p.opportunity?.title}" → ${p.toStage?.name}`, href: '/pipeline' };
    case 'opportunity.created':
      return { title: `New deal: ${p.opportunity?.title}`, href: '/pipeline' };
    case 'review.received':
      return { title: `New ${p.review?.rating}★ review from ${fullName(p.contact)}`, href: '/reputation' };
    case 'course.enrolled':
      return { title: `${fullName(p.contact) || 'A contact'} enrolled in "${p.course?.title}"`, href: e.contactId ? `/contacts/${e.contactId}` : '/courses' };
    case 'course.completed':
      return { title: `${fullName(p.contact) || "A member"} completed "${p.course?.title}" 🎓`, href: e.contactId ? `/contacts/${e.contactId}` : '/courses' };
    case 'subscription.created':
      return { title: `New subscription: ${p.subscription?.name} (${p.subscription?.currency} ${p.subscription?.price}/${p.subscription?.interval})`, href: '/payments' };
    case 'subscription.canceled':
      return { title: `Subscription canceled: ${p.subscription?.name}`, href: '/payments' };
    case 'invoice.overdue':
      return { title: `Invoice ${p.invoice?.number} is overdue`, href: '/payments' };
    case 'email.clicked':
      return { title: `Link clicked in “${p.message?.subject}”`, href: e.contactId ? `/contacts/${e.contactId}` : '/campaigns' };
    case 'task.completed':
      return { title: `Task completed: ${p.task?.title}`, href: '/tasks' };
    default:
      return null; // contact.updated etc. are too noisy for notifications
  }
}

/**
 * Server-sent events for the active workspace. The web app reads it with fetch()
 * so the bearer token travels in the Authorization header, never in the URL.
 */
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly events: EventsService) {}

  @Get('stream')
  stream(@Tenant('workspaceId') workspaceId: string, @Req() req: Request, @Res() res: Response) {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`event: ready\ndata: {}\n\n`);

    const unsubscribe = this.events.subscribe((e) => {
      if (e.workspaceId !== workspaceId) return;
      const info = describeEvent(e);
      const data = { type: e.type, contactId: e.contactId ?? null, at: new Date().toISOString(), ...(info ?? {}) };
      res.write(`event: domain\ndata: ${JSON.stringify(data)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
