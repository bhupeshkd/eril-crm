'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorText, useToast } from './ui';

export function TrackingSettings() {
  const toast = useToast();
  const { can } = useAuth();
  const [s, setS] = useState<{ opens: boolean; clicks: boolean } | null>(null);

  useEffect(() => {
    api('/tracking/settings').then(setS).catch(() => {});
  }, []);
  if (!s) return null;
  const editable = can('workspaces:write');

  async function save(next: { opens: boolean; clicks: boolean }) {
    setS(next);
    try {
      setS(await api('/tracking/settings', { method: 'PUT', body: next }));
      toast('Tracking settings saved');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <section className="card mb-6 p-5">
      <h2 className="-mx-5 -mt-5 mb-3 border-b border-slate-100 px-5 py-4 font-semibold">Email tracking</h2>
      <p className="mb-3 text-sm text-slate-500">Applies to designed emails (templates) sent from campaigns, automations and test sends. Plain-text emails are never tracked.</p>
      <fieldset disabled={!editable} className="space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={s.opens} onChange={(e) => save({ ...s, opens: e.target.checked })} />
          <span><span className="font-medium">Track opens</span><span className="block text-slate-500">Adds an invisible image. Some mail apps load images automatically or block them, so opens are estimates.</span></span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={s.clicks} onChange={(e) => save({ ...s, clicks: e.target.checked })} />
          <span><span className="font-medium">Track link clicks</span><span className="block text-slate-500">Links pass through a signed redirect. Unsubscribe links are never tracked; security-scanner clicks are ignored.</span></span>
        </label>
      </fieldset>
    </section>
  );
}
