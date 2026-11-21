'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { AuthShell } from '@/components/auth-shell';
import { errorText } from '@/components/ui';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', organizationName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register({ ...form, organizationName: form.organizationName || undefined });
      router.replace('/dashboard');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Create your workspace">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input id="name" required className="input" value={form.name} onChange={set('name')} autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="org">Company / agency <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="org" className="input" value={form.organizationName} onChange={set('organizationName')} autoComplete="organization" />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" required className="input" value={form.email} onChange={set('email')} autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" required minLength={8} className="input" value={form.password} onChange={set('password')} autoComplete="new-password" />
          <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
        </div>
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="text-center text-sm text-slate-600">
          Already registered? <Link href="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
