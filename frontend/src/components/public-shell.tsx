'use client';

import { useEffect } from 'react';
import { Spinner } from './ui';
import { captureTouch } from '@/lib/attribution';
import { BrandMark, DEFAULT_BRANDING, usePublicBranding, type Branding } from '@/lib/branding';

/** Which link a public page was opened with, so it can show the owning agency's branding. */
export type BrandKey = { kind: string; key: string };

/** Backdrop for customer-facing pages: soft tinted gradient, centred column, quiet footer. */
export function PublicShell({ children, center, wide, brand }: { children: React.ReactNode; center?: boolean; wide?: boolean; brand?: BrandKey }) {
  const b = usePublicBranding(brand?.kind, brand?.key);
  // Remember where this visitor came from (UTM tags, ad click IDs, referrer) for attribution.
  useEffect(() => captureTouch(), []);
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f6f7f9] px-4 py-10 sm:py-14">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-brand-100/70 via-brand-50/40 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-brand-200/40 blur-3xl" />
      <div className={`relative mx-auto ${wide ? 'max-w-4xl' : 'max-w-3xl'} ${center ? 'flex min-h-[calc(100vh-7rem)] flex-col justify-center' : ''}`}>
        {children}
        <PoweredBy b={b} />
      </div>
    </main>
  );
}

/** "Powered by <brand>" footer; hidden when the agency turns it off. */
export function PoweredBy({ b = DEFAULT_BRANDING }: { b?: Branding }) {
  if (b.hidePoweredBy) return null;
  return (
    <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-slate-400">
      Powered by
      <span className="inline-flex items-center gap-1 font-medium text-slate-500">
        <BrandMark b={b} size="h-4 w-4 rounded text-[9px]" />
        {b.appName}
      </span>
    </p>
  );
}

/** Full-page loading spinner, or a friendly error card when the link is bad. */
export function PublicLoading({ error, brand }: { error?: string; brand?: BrandKey }) {
  return (
    <PublicShell center brand={brand}>
      {error ? (
        <div className="card mx-auto w-full max-w-md p-8 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-rose-50 text-rose-500 ring-1 ring-inset ring-rose-100">
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-6 w-6"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
          </div>
          <h1 className="font-semibold">This link isn’t working</h1>
          <p className="mt-1 text-sm text-slate-500">{error}</p>
        </div>
      ) : (
        <div className="grid place-items-center"><Spinner className="h-7 w-7" /></div>
      )}
    </PublicShell>
  );
}

/** Animated green check used on every "done" screen. */
export function SuccessMark() {
  return (
    <div className="relative mx-auto mb-4 grid h-14 w-14 animate-pop-in place-items-center">
      <span aria-hidden className="absolute inset-0 rounded-full bg-emerald-400/25 motion-safe:animate-ping [animation-iteration-count:1]" />
      <span className="relative grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-600/25">
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7"><path d="M20 6 9 17l-5-5" /></svg>
      </span>
    </div>
  );
}
