'use client';

import { useState } from 'react';
import type { FormField } from '@/lib/types-ext';

/** Renders a form (all fields) or a survey (one field per step). Used by the builder preview and hosted pages. */
export function FormRenderer({
  fields,
  kind,
  submitText,
  color,
  onSubmit,
  serverErrors,
  busy,
}: {
  fields: FormField[];
  kind: 'form' | 'survey';
  submitText?: string;
  color?: string;
  onSubmit?: (data: Record<string, any>) => void;
  serverErrors?: Record<string, string>;
  busy?: boolean;
}) {
  const [data, setData] = useState<Record<string, any>>({});
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const allErrors = { ...serverErrors, ...errors };
  const style = color ? ({ backgroundColor: color } as React.CSSProperties) : undefined;

  const validate = (list: FormField[]) => {
    const e: Record<string, string> = {};
    for (const f of list) {
      const v = data[f.key];
      const empty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || v === false;
      if (f.required && empty) e[f.key] = `${f.label} is required`;
      else if (f.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) e[f.key] = 'Enter a valid email address';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const visible = kind === 'survey' ? fields.slice(step, step + 1) : fields;
  const last = kind === 'form' || step >= fields.length - 1;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!validate(visible)) return;
        if (!last) setStep(step + 1);
        else onSubmit?.(data);
      }}
    >
      {kind === 'survey' && fields.length > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" aria-label={`Step ${step + 1} of ${fields.length}`}>
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${((step + 1) / fields.length) * 100}%`, ...(color ? { backgroundColor: color } : {}) }} />
        </div>
      )}
      {visible.map((f) => (
        <Field key={f.key} field={f} value={data[f.key]} error={allErrors[f.key]} onChange={(v) => setData({ ...data, [f.key]: v })} />
      ))}
      <div className="flex gap-2">
        {kind === 'survey' && step > 0 && <button type="button" className="btn-secondary" onClick={() => setStep(step - 1)}>Back</button>}
        <button className="btn-primary flex-1" style={style} disabled={busy || !onSubmit}>
          {busy ? 'Sending…' : last ? submitText || 'Submit' : 'Next'}
        </button>
      </div>
    </form>
  );
}

function Field({ field: f, value, error, onChange }: { field: FormField; value: any; error?: string; onChange: (v: any) => void }) {
  const id = `ff-${f.key}`;
  const common = { id, 'aria-invalid': !!error, 'aria-describedby': error ? `${id}-err` : undefined };
  const label = (
    <span className="label">
      {f.label}
      {f.required && <span className="text-rose-500"> *</span>}
    </span>
  );
  let control: React.ReactNode;
  switch (f.type) {
    case 'textarea':
      control = <textarea {...common} rows={4} className="input" placeholder={f.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'select':
      control = (
        <select {...common} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">{f.placeholder || 'Choose…'}</option>
          {f.options?.map((o) => <option key={o}>{o}</option>)}
        </select>
      );
      break;
    case 'radio':
      return (
        <fieldset>
          <legend>{label}</legend>
          <div className="space-y-1.5">
            {f.options?.map((o) => (
              <label key={o} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition ${value === o ? 'border-brand-500 bg-brand-50/60 font-medium text-slate-900' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}>
                <input type="radio" name={id} checked={value === o} onChange={() => onChange(o)} /> {o}
              </label>
            ))}
          </div>
          {error && <p id={`${id}-err`} className="mt-1.5 text-xs font-medium text-rose-600">{error}</p>}
        </fieldset>
      );
    case 'checkbox':
      if (f.options?.length) {
        const list: string[] = value ?? [];
        return (
          <fieldset>
            <legend>{label}</legend>
            <div className="space-y-1.5">
              {f.options.map((o) => (
                <label key={o} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition ${list.includes(o) ? 'border-brand-500 bg-brand-50/60 font-medium text-slate-900' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} /> {o}
                </label>
              ))}
            </div>
            {error && <p id={`${id}-err`} className="mt-1.5 text-xs font-medium text-rose-600">{error}</p>}
          </fieldset>
        );
      }
      return (
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input {...common} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
            {f.label}{f.required && <span className="text-rose-500"> *</span>}
          </label>
          {error && <p id={`${id}-err`} className="mt-1.5 text-xs font-medium text-rose-600">{error}</p>}
        </div>
      );
    default:
      control = (
        <input
          {...common}
          className="input"
          type={f.type === 'phone' ? 'tel' : f.type}
          autoComplete={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : undefined}
          placeholder={f.placeholder}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {control}
      {error && <p id={`${id}-err`} className="mt-1.5 text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}
