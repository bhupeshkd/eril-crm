'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { FormField } from '@/lib/types-ext';
import { captureTouch, getAttribution } from '@/lib/attribution';
import { FormRenderer } from '@/components/form-renderer';
import { Spinner, errorText } from '@/components/ui';
import { PublicLoading, PublicShell, SuccessMark } from '@/components/public-shell';

interface PublicForm {
  name: string;
  kind: 'form' | 'survey';
  description: string;
  fields: FormField[];
  settings: { submitText?: string; color?: string };
}

export default function PublicFormPage() {
  return (
    <Suspense fallback={<PublicLoading />}>
      <PublicForm />
    </Suspense>
  );
}

function PublicForm() {
  const { slug } = useParams<{ slug: string }>();
  const embed = useSearchParams().get('embed') === '1';
  const [form, setForm] = useState<PublicForm | null>(null);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  // Embedded forms skip PublicShell, so capture attribution here too.
  useEffect(() => captureTouch(), []);
  useEffect(() => {
    api<PublicForm>(`/public/forms/${slug}`, { auth: false }).then(setForm).catch((e) => setError(errorText(e)));
  }, [slug]);

  async function submit(data: Record<string, any>) {
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      const res = await api(`/public/forms/${slug}/submit`, { method: 'POST', auth: false, body: { data, attribution: getAttribution() } });
      if (res.redirectUrl && /^https?:\/\//.test(res.redirectUrl)) {
        (embed ? window.top ?? window : window).location.href = res.redirectUrl;
        return;
      }
      setDone(res.message);
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors((err.body as any)?.errors ?? {});
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!embed && !form) return <PublicLoading error={error} brand={{ kind: 'form', key: slug }} />;

  const content = !form ? (
    error ? <p className="text-center text-slate-600">{error}</p> : <div className="grid place-items-center p-8"><Spinner /></div>
  ) : done ? (
    <div className="py-8 text-center" role="status">
      <SuccessMark />
      <p className="text-lg font-semibold tracking-tight">{done}</p>
    </div>
  ) : (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{form.name}</h1>
      {form.description && <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-600">{form.description}</p>}
      <div className="mt-6">
        <FormRenderer fields={form.fields} kind={form.kind} submitText={form.settings.submitText} color={form.settings.color} onSubmit={submit} serverErrors={fieldErrors} busy={busy} />
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
    </>
  );

  if (embed) return <main className="bg-white p-4">{content}</main>;
  return (
    <PublicShell brand={{ kind: 'form', key: slug }}>
      <div className="card mx-auto max-w-lg p-7 shadow-pop sm:p-8">{content}</div>
    </PublicShell>
  );
}
