'use client';

import { API_URL, api, tokens } from './api';

export interface LiveEvent {
  type: string;
  title?: string;
  href?: string;
  contactId?: string | null;
  at: string;
}

/**
 * Subscribes to the workspace event stream. Uses fetch (not EventSource) so the
 * bearer token goes in the Authorization header. Reconnects with backoff.
 * Returns a stop function. Also re-broadcasts each event as a window
 * `eril:live` CustomEvent so any page can react (e.g. the inbox reloads).
 */
export function startLiveStream(onEvent: (e: LiveEvent) => void): () => void {
  let stopped = false;
  let ctrl: AbortController | null = null;
  let attempt = 0;

  const run = async () => {
    while (!stopped) {
      ctrl = new AbortController();
      try {
        const res = await fetch(`${API_URL}/realtime/stream`, {
          headers: { Authorization: `Bearer ${tokens.access ?? ''}`, Accept: 'text/event-stream' },
          signal: ctrl.signal,
        });
        if (res.status === 401) {
          await api('/auth/me').catch(() => {}); // triggers token refresh (or redirect to login)
          throw new Error('unauthorized');
        }
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        attempt = 0;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (!chunk.includes('event: domain')) continue;
            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as LiveEvent;
              onEvent(ev);
              window.dispatchEvent(new CustomEvent('eril:live', { detail: ev }));
            } catch {
              /* ignore malformed chunk */
            }
          }
        }
      } catch {
        if (stopped) return;
      }
      attempt++;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))));
    }
  };
  run();
  return () => {
    stopped = true;
    ctrl?.abort();
  };
}
