'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

let cached: Promise<{ enabled: boolean; model: string }> | null = null;

/** Whether the server has AI configured (cached for the session). */
export function useAiEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    cached ??= api<{ enabled: boolean; model: string }>('/ai/status').catch(() => ({ enabled: false, model: '' }));
    cached.then((s) => setEnabled(s.enabled));
  }, []);
  return enabled;
}

/** Small "✨ AI" action button with its own busy state. */
export function AiButton({ label, onClick, className = '' }: { label: string; onClick: () => Promise<void>; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`btn-secondary border-violet-200 text-violet-700 hover:bg-violet-50 ${className}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      <span aria-hidden>✨</span> {busy ? 'Writing…' : label}
    </button>
  );
}
