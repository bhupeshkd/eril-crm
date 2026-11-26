'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isIos, isStandalone } from '@/lib/pwa';
import { Spinner, errorText, useToast } from './ui';
import { Icon } from './icons';

type Topic = { key: string; label: string };
type Config = { enabled: boolean; publicKey: string | null; topics: Topic[] };
type Device = { id: string; label: string; topics: string[]; endpointHash: string; createdAt: string; lastSentAt: string | null };

function keyBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function hashEndpoint(endpoint: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function registration() {
  return navigator.serviceWorker.register(process.env.NODE_ENV !== 'production' ? '/sw.js?dev=1' : '/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready);
}

/** Settings → Notifications: push alerts on this phone or computer, per kind of event. Belongs to the user, not the workspace. */
export function PushSettings() {
  const toast = useToast();
  const [config, setConfig] = useState<Config | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [thisHash, setThisHash] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [busy, setBusy] = useState<string | null>(null);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);

  const load = useCallback(async () => {
    const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
    setPermission(supported ? Notification.permission : 'unsupported');
    setIosNeedsInstall(isIos() && !isStandalone());
    const [c, d] = await Promise.all([api<Config>('/push/config'), api<Device[]>('/push/subscriptions')]);
    setConfig(c);
    setDevices(d);
    if (supported) {
      const sub = await (await registration()).pushManager.getSubscription();
      setThisHash(sub ? await hashEndpoint(sub.endpoint) : null);
    }
  }, []);

  useEffect(() => {
    load().catch((e) => toast(errorText(e), 'error'));
  }, [load, toast]);

  const current = devices.find((d) => d.endpointHash === thisHash) ?? null;
  const others = devices.filter((d) => d !== current);

  async function enable() {
    if (!config?.publicKey) return;
    setBusy('enable');
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== 'granted') {
        toast(p === 'denied' ? 'Notifications are blocked. Allow them in your browser’s site settings.' : 'Notifications not allowed', 'error');
        return;
      }
      const reg = await registration();
      let sub = await reg.pushManager.getSubscription();
      // A subscription made with a different server key can't be reused.
      if (sub && sub.options.applicationServerKey) {
        const k = new Uint8Array(sub.options.applicationServerKey);
        const want = keyBytes(config.publicKey);
        if (k.length !== want.length || k.some((v, i) => v !== want[i])) {
          await sub.unsubscribe();
          sub = null;
        }
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api('/push/subscriptions', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } });
      await load();
      toast('Notifications are on for this device');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function disable(d: Device) {
    setBusy(d.id);
    try {
      if (d === current) {
        const sub = await (await registration()).pushManager.getSubscription();
        await sub?.unsubscribe();
      }
      await api(`/push/subscriptions/${d.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(d: Device, key: string) {
    const topics = d.topics.includes(key) ? d.topics.filter((t) => t !== key) : [...d.topics, key];
    setDevices((all) => all.map((x) => (x.id === d.id ? { ...x, topics } : x)));
    try {
      await api(`/push/subscriptions/${d.id}`, { method: 'PATCH', body: { topics } });
    } catch (e) {
      toast(errorText(e), 'error');
      load().catch(() => {});
    }
  }

  async function test(d: Device) {
    setBusy(`test-${d.id}`);
    try {
      const r = await api<{ sent: number }>('/push/test', { method: 'POST', body: { id: d.id } });
      toast(r.sent ? 'Test notification sent' : 'Couldn’t reach this device. Try turning notifications off and on.', r.sent ? undefined : 'error');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card mb-6" aria-labelledby="push-title">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 id="push-title" className="flex items-center gap-2 font-semibold"><Icon name="bell" className="h-4 w-4 text-slate-400" />Notifications</h2>
        <p className="mt-0.5 text-[13px] text-slate-500">Get an alert on your phone or computer when something needs you, even when the app is closed. These settings are yours and apply to every workspace you belong to.</p>
      </div>
      <div className="space-y-4 p-5">
        {!config ? (
          <div className="grid h-16 place-items-center"><Spinner /></div>
        ) : !config.enabled ? (
          <p className="text-sm text-slate-500">Push notifications aren’t set up on this server.</p>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">This device</p>
                  <p className="text-[13px] text-slate-500">
                    {current
                      ? `On: ${current.label}`
                      : permission === 'unsupported'
                        ? 'This browser can’t receive push notifications.'
                        : iosNeedsInstall
                          ? 'On iPhone and iPad, install the app first: Share → Add to Home Screen, then open it from your home screen.'
                          : permission === 'denied'
                            ? 'Blocked in your browser. Allow notifications for this site, then try again.'
                            : 'Off'}
                  </p>
                </div>
                {current ? (
                  <>
                    <button className="btn-secondary h-9 text-[13px]" disabled={!!busy} onClick={() => test(current)}>{busy === `test-${current.id}` ? 'Sending…' : 'Send test'}</button>
                    <button className="btn-ghost h-9 text-[13px]" disabled={!!busy} onClick={() => disable(current)}>Turn off</button>
                  </>
                ) : (
                  permission !== 'unsupported' && !iosNeedsInstall && (
                    <button className="btn-primary h-9 text-[13px]" disabled={busy === 'enable' || permission === 'denied'} onClick={enable}>{busy === 'enable' ? 'Turning on…' : 'Turn on'}</button>
                  )
                )}
              </div>
              {current && (
                <fieldset className="mt-4 grid gap-2 sm:grid-cols-2">
                  <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Notify me about</legend>
                  {config.topics.map((t) => (
                    <label key={t.key} className="flex items-center gap-2.5 text-sm">
                      <input type="checkbox" checked={current.topics.includes(t.key)} onChange={() => toggle(current, t.key)} />
                      {t.label}
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
            {others.length > 0 && (
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Other devices</p>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {others.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{d.label || 'Browser'}</span>
                      <span className="hidden text-[12px] text-slate-400 sm:inline">{d.topics.length} of {config.topics.length} alerts</span>
                      <button className="btn-ghost h-8 text-[13px] text-rose-600" disabled={busy === d.id} onClick={() => disable(d)}>Remove</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
