import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

/** Domain events published by modules and consumed by the automation engine. */
export interface DomainEvent {
  type: string;
  workspaceId: string;
  userId?: string | null;
  contactId?: string | null;
  payload: Record<string, any>;
}

/**
 * In-process event bus (modular monolith). Listeners run asynchronously so a
 * failing workflow never breaks the request that emitted the event.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly emitter = new EventEmitter();

  constructor() {
    // One listener per open live stream plus a few internal consumers.
    this.emitter.setMaxListeners(1000);
  }

  emit(event: DomainEvent): void {
    setImmediate(() => {
      for (const listener of this.emitter.listeners('*')) {
        Promise.resolve((listener as (e: DomainEvent) => unknown)(event)).catch((err) =>
          this.logger.error(`Listener failed for ${event.type}: ${err?.message ?? err}`),
        );
      }
    });
  }

  onAny(listener: (e: DomainEvent) => unknown): void {
    this.emitter.on('*', listener);
  }

  /** Like onAny but returns an unsubscribe function (used by live streams). */
  subscribe(listener: (e: DomainEvent) => unknown): () => void {
    this.emitter.on('*', listener);
    return () => this.emitter.off('*', listener);
  }
}
