'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { errorText } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PublicLoading, PublicShell, SuccessMark } from '@/components/public-shell';

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<PublicLoading />}>
      <Unsubscribe />
    </Suspense>
  );
}

function Unsubscribe() {
  const params = useSearchParams();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState('');
  return (
    <PublicShell center brand={{ kind: 'contact', key: params.get('c') ?? '' }}>
      <div className="card mx-auto w-full max-w-sm p-8 text-center shadow-pop">
        {state === 'done' ? (
          <div role="status">
            <SuccessMark />
            <h1 className="text-lg font-semibold">You've been unsubscribed</h1>
            <p className="mt-1.5 text-sm text-slate-600">You won't receive marketing messages from us anymore.</p>
          </div>
        ) : (
          <>
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200">
              <Icon name="mail" className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-lg font-semibold">Unsubscribe</h1>
            <p className="mt-1.5 text-sm text-slate-600">Stop receiving marketing emails and texts from this business?</p>
            <button
              className="btn-primary mt-6 h-11 w-full"
              disabled={state === 'busy'}
              onClick={async () => {
                setState('busy');
                try {
                  await api('/public/unsubscribe', { method: 'POST', auth: false, body: { c: params.get('c'), t: params.get('t') } });
                  setState('done');
                } catch (e) {
                  setError(errorText(e));
                  setState('idle');
                }
              }}
            >
              {state === 'busy' ? 'Unsubscribing…' : 'Unsubscribe me'}
            </button>
            <p className="mt-3 text-xs text-slate-400">You'll still get messages about bookings and payments.</p>
            {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
          </>
        )}
      </div>
    </PublicShell>
  );
}
