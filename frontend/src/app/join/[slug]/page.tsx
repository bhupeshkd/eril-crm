'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { errorText } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PublicLoading, PublicShell, SuccessMark } from '@/components/public-shell';

export default function JoinCommunity() {
  const { slug } = useParams<{ slug: string }>();
  const [info, setInfo] = useState<{ name: string; description: string; members: number } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [f, setF] = useState({ name: '', email: '' });
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<typeof info>(`/public/communities/${slug}`, { auth: false }).then(setInfo).catch((e) => setLoadError(errorText(e)));
  }, [slug]);

  if (!info) return <PublicLoading error={loadError} brand={{ kind: 'join', key: slug }} />;

  return (
    <PublicShell center brand={{ kind: 'join', key: slug }}>
      <div className="card mx-auto w-full max-w-md overflow-hidden shadow-pop">
        <div className="relative bg-gradient-to-br from-brand-600 to-brand-800 px-8 pb-8 pt-9 text-white">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.18),transparent_55%)]" />
          <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-white/15 text-2xl font-semibold ring-1 ring-white/25 backdrop-blur">
            {info.name.trim().charAt(0).toUpperCase()}
          </span>
          <h1 className="relative mt-4 text-2xl font-semibold tracking-tight">{info.name}</h1>
          <p className="relative mt-1 flex items-center gap-1.5 text-sm text-brand-100">
            <Icon name="communities" className="h-4 w-4" />
            {info.members} member{info.members === 1 ? '' : 's'}
          </p>
        </div>
        <div className="p-8">
          {info.description && <p className="mb-6 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{info.description}</p>}
          {done ? (
            <div className="text-center" role="status">
              <SuccessMark />
              <p className="font-semibold">Check your inbox</p>
              <p className="mt-1 text-sm text-slate-600">{done}</p>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  const r = await api<{ message: string }>(`/public/communities/${slug}/join`, { method: 'POST', auth: false, body: f });
                  setDone(r.message);
                } catch (err) {
                  setError(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div><label className="label" htmlFor="j-name">Your name *</label><input id="j-name" required autoComplete="name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div><label className="label" htmlFor="j-email">Email *</label><input id="j-email" required type="email" autoComplete="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
              {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
              <button className="btn-primary h-11 w-full text-[15px]" disabled={busy}>{busy ? 'Sending…' : 'Join the community'}</button>
              <p className="flex items-start gap-2 text-xs text-slate-500">
                <Icon name="mail" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                We’ll email you a personal link — no password needed. Already a member? Enter your email to get your link again.
              </p>
            </form>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
