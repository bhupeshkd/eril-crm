'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, tokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorText } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PublicLoading, PublicShell } from '@/components/public-shell';
import { ROLES } from '@/components/team-settings';

interface InviteInfo {
  email: string;
  role: string;
  workspaceName: string;
  organizationName: string | null;
  invitedBy: string | null;
  hasAccount: boolean;
  status: 'pending' | 'accepted' | 'expired';
}

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { me } = useAuth();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needMfa, setNeedMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<InviteInfo>(`/auth/invitations/${token}`, { auth: false }).then(setInfo).catch((e) => setLoadError(errorText(e)));
  }, [token]);

  if (!info) return <PublicLoading error={loadError} brand={{ kind: 'invite', key: token }} />;
  const role = ROLES.find((r) => r.id === info.role);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ accessToken: string; refreshToken: string }>(`/auth/invitations/${token}/accept`, {
        method: 'POST',
        auth: false,
        body: { password, ...(info!.hasAccount ? {} : { name }), ...(mfaCode ? { mfaCode } : {}) },
      });
      tokens.set(res.accessToken, res.refreshToken);
      location.href = '/dashboard';
    } catch (err) {
      const msg = errorText(err);
      if (/MFA code required/i.test(msg)) setNeedMfa(true);
      else setError(msg);
      setBusy(false);
    }
  }

  const closed = info.status !== 'pending';

  return (
    <PublicShell center brand={{ kind: 'invite', key: token }}>
      <div className="card mx-auto w-full max-w-md overflow-hidden shadow-pop">
        <div className="relative bg-gradient-to-br from-brand-600 to-brand-800 px-8 pb-7 pt-8 text-white">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(255,255,255,0.18),transparent_55%)]" />
          <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-xl font-semibold ring-1 ring-white/25 backdrop-blur">
            {info.workspaceName.trim().charAt(0).toUpperCase()}
          </span>
          <p className="relative mt-4 text-sm text-brand-100">{info.invitedBy ? `${info.invitedBy} invited you to join` : 'You’re invited to join'}</p>
          <h1 className="relative text-2xl font-semibold tracking-tight">{info.workspaceName}</h1>
          {info.organizationName && <p className="relative mt-0.5 text-sm text-brand-100">{info.organizationName}</p>}
        </div>

        <div className="p-8">
          {role && (
            <div className="mb-6 flex items-start gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200/70">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-brand-600 ring-1 ring-slate-200"><Icon name="contacts" className="h-4 w-4" /></span>
              <p className="text-sm"><span className="font-medium text-slate-900">Your role: {role.label}</span><span className="block text-[13px] text-slate-500">{role.desc}</span></p>
            </div>
          )}

          {closed ? (
            <div className="text-center">
              <p className="font-semibold">{info.status === 'accepted' ? 'This invitation has already been used' : 'This invitation has expired'}</p>
              <p className="mt-1 text-sm text-slate-500">{info.status === 'accepted' ? 'Sign in to open the workspace.' : `Ask ${info.invitedBy ?? 'the person who invited you'} to send a new one.`}</p>
              <Link href="/login" className="btn-primary mt-5 w-full">Go to sign in</Link>
            </div>
          ) : (
            <form onSubmit={accept} className="space-y-4">
              {me && me.email !== info.email && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-200/70 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                  <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>You’re signed in as {me.email}. Accepting will sign you in as {info.email} instead.</span>
                </p>
              )}
              <div>
                <label className="label" htmlFor="ai-email">Email</label>
                <input id="ai-email" className="input bg-slate-50 text-slate-600" value={info.email} readOnly />
              </div>
              {!info.hasAccount && (
                <div>
                  <label className="label" htmlFor="ai-name">Your name</label>
                  <input id="ai-name" required autoComplete="name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              )}
              <div>
                <label className="label" htmlFor="ai-pw">{info.hasAccount ? 'Your ERIL password' : 'Choose a password'}</label>
                <input
                  id="ai-pw"
                  type="password"
                  required
                  minLength={info.hasAccount ? undefined : 8}
                  autoComplete={info.hasAccount ? 'current-password' : 'new-password'}
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {!info.hasAccount && <p className="mt-1.5 text-xs text-slate-500">At least 8 characters.</p>}
              </div>
              {needMfa && (
                <div>
                  <label className="label" htmlFor="ai-mfa">Authentication code</label>
                  <input id="ai-mfa" required inputMode="numeric" autoComplete="one-time-code" className="input tracking-widest" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
                </div>
              )}
              {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
              <button className="btn-primary h-11 w-full text-[15px]" disabled={busy}>
                {busy ? 'Joining…' : info.hasAccount ? 'Join workspace' : 'Create account & join'}
              </button>
              {info.hasAccount && (
                <p className="text-center text-xs text-slate-500">
                  Forgot your password? <Link href="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link> and reset it first.
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
