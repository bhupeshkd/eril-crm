'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600 ${className}`}
    />
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    // Focus the first form field; fall back to the first button (the header's close button
    // comes first in the DOM, so it must not win when there's a field to type in).
    const body = ref.current;
    (body?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([readonly]),textarea,select') ?? body?.querySelector<HTMLElement>('button'))?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[8vh] backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`w-full animate-pop-in rounded-2xl border border-slate-200/80 bg-white shadow-pop ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 id="modal-title" className="text-base font-semibold">
            {title}
          </h2>
          <button className="btn-ghost -mr-2 h-8 w-8 px-0 text-slate-400" onClick={onClose} aria-label="Close">
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 border-dashed px-6 py-14 text-center">
      <div className="mb-1 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-brand-600 ring-1 ring-inset ring-brand-200/60">
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>
      </div>
      <p className="font-semibold text-slate-800">{title}</p>
      {children && <div className="max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, actions, subtitle }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const OK = 'bg-emerald-50 text-emerald-700 ring-emerald-600/15';
const INFO = 'bg-sky-50 text-sky-700 ring-sky-600/15';
const WARN = 'bg-amber-50 text-amber-700 ring-amber-600/20';
const BAD = 'bg-rose-50 text-rose-700 ring-rose-600/15';
const MUTED = 'bg-slate-100 text-slate-600 ring-slate-500/10';
const VIOLET = 'bg-violet-50 text-violet-700 ring-violet-600/15';

const STATUS_STYLES: Record<string, string> = {
  testing: WARN,
  lead: WARN,
  customer: OK,
  churned: MUTED,
  open: INFO,
  won: OK,
  lost: BAD,
  succeeded: OK,
  failed: BAD,
  running: INFO,
  sent: OK,
  received: INFO,
  booked: INFO,
  confirmed: VIOLET,
  showed: OK,
  noshow: WARN,
  cancelled: MUTED,
  draft: MUTED,
  scheduled: VIOLET,
  sending: INFO,
  paid: OK,
  void: MUTED,
  waiting: WARN,
  trial: VIOLET,
  'past due': BAD,
  canceled: MUTED,
  active: OK,
  trialing: VIOLET,
  unpaid: WARN,
  overdue: BAD,
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge capitalize ${STATUS_STYLES[status] ?? MUTED}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

export function Tag({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <span className="badge gap-1 bg-brand-50 text-brand-700 ring-brand-600/15">
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} className="hover:text-brand-900" aria-label={`Remove tag ${children}`}>
          ×
        </button>
      )}
    </span>
  );
}

/** Pill-style segmented control used for tabs and filters. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className = '',
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<readonly [T, string] | readonly [T, string, number | undefined]>;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-200/60 p-1 ${className}`} role="tablist" aria-label={label}>
      {options.map(([v, l, n]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium transition ${value === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
        >
          {l}
          {n != null && n > 0 && <span className={`rounded-full px-1.5 text-[10px] font-semibold leading-4 ${value === v ? 'bg-brand-100 text-brand-700' : 'bg-slate-300/60 text-slate-600'}`}>{n}</span>}
        </button>
      ))}
    </div>
  );
}

/** Small KPI tile with a gradient icon chip. */
export function StatTile({ label, value, hint, icon, tint }: { label: string; value: React.ReactNode; hint?: string; icon: React.ReactNode; tint: string }) {
  return (
    <div className="card flex items-center gap-4 px-4 py-3.5">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${tint} text-white shadow-sm`}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-slate-500">{label}</div>
        <div className="text-xl font-semibold leading-tight tracking-tight tabular-nums">{value}</div>
        {hint && <div className="truncate text-[11px] text-slate-400">{hint}</div>}
      </div>
    </div>
  );
}

export function LiveBadge({ on, onLabel = 'Live', offLabel = 'Draft' }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return (
    <span className={`badge ${on ? OK : MUTED}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full bg-current ${on ? 'animate-pulse' : 'opacity-70'}`} />
      {on ? onLabel : offLabel}
    </span>
  );
}

/** Sticky top bar for full-page editors: back link, title, status chips, actions. */
export function EditorBar({
  back,
  title,
  status,
  dirty,
  actions,
}: {
  back: { href: string; label: string };
  title: React.ReactNode;
  status?: React.ReactNode;
  dirty?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Link href={back.href} className="btn-ghost h-8 w-8 shrink-0 px-0 text-slate-500" aria-label={`Back to ${back.label}`} title={`Back to ${back.label}`}>
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{back.label}</div>
          {title}
        </div>
        {status}
        {dirty && (
          <span className="badge bg-amber-50 text-amber-700 ring-amber-600/20">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Unsaved
          </span>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Inline-editable heading used as the title in EditorBar. */
export function TitleInput({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled?: boolean; label: string }) {
  return (
    <input
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      size={Math.min(48, Math.max(12, value.length + 2))}
      className="-ml-1.5 block max-w-full truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-lg font-semibold tracking-tight text-slate-900 transition hover:border-slate-200 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:hover:border-transparent"
    />
  );
}

/** Underline tabs for sections inside an editor. */
export function Tabs<T extends string>({ value, onChange, options, className = '' }: { value: T; onChange: (v: T) => void; options: ReadonlyArray<readonly [T, string] | readonly [T, string, number | undefined]>; className?: string }) {
  return (
    <div className={`mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 ${className}`} role="tablist">
      {options.map(([v, l, n]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition ${value === v ? 'border-brand-600 text-slate-900' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}
        >
          {l}
          {n != null && <span className={`rounded-full px-1.5 text-[10px] font-semibold leading-4 ${value === v ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>{n}</span>}
        </button>
      ))}
    </div>
  );
}

/** Section title inside editor side panels. */
export function PanelTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</h2>
      {action}
    </div>
  );
}

export function PageLoader() {
  return <div className="grid h-48 place-items-center"><Spinner /></div>;
}

// ---- Toasts -----------------------------------------------------------------
type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastContext = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-[70] flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="flex animate-pop-in items-start gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-800 shadow-pop">
            <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-white ${t.kind === 'error' ? 'bg-rose-500' : 'bg-emerald-500'}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">{t.kind === 'error' ? <path d="M12 7v6M12 17h.01" /> : <path d="M20 6 9 17l-5-5" />}</svg>
            </span>
            <span className="flex-1">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function errorText(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong';
}
