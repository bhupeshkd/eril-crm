'use client';

import { useEffect, useState } from 'react';

/** Quick-pick colours shown under every colour field. */
export const SWATCHES = ['#b6e633', '#84cc16', '#34d399', '#22d3ee', '#38bdf8', '#5b9ee1', '#6366f1', '#a78bfa', '#f0abfc', '#f472b6', '#f43f5e', '#fb923c', '#facc15', '#d8c380', '#181a18', '#ffffff'];

const HEX = /^#[0-9a-f]{6}$/i;

/** Colour picker + hex input + swatches. `value` null means "default" (shown when `onClear` is given). */
export function ColorField({
  label,
  value,
  onChange,
  onClear,
  clearLabel = 'Default',
  swatches = true,
  id,
}: {
  label: string;
  value: string | null;
  onChange: (hex: string) => void;
  onClear?: () => void;
  clearLabel?: string;
  swatches?: boolean;
  id?: string;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const fid = id ?? `c-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-[13px] font-medium text-muted" htmlFor={fid}>{label}</label>
        {onClear && value && <button type="button" className="text-[12px] text-muted hover:text-ink" onClick={onClear}>{clearLabel}</button>}
      </div>
      <div className="flex items-center gap-2">
        <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-[var(--glass-line)]" style={{ background: value ?? 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0/10px 10px' }}>
          <input aria-label={`${label} picker`} type="color" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </span>
        <input
          id={fid}
          className="input h-9 font-mono text-[13px] uppercase"
          value={text}
          placeholder={onClear ? clearLabel : '#RRGGBB'}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setText(e.target.value);
            if (HEX.test(v)) onChange(v.toLowerCase());
          }}
          onBlur={() => setText(value ?? '')}
        />
      </div>
      {swatches && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`${label} presets`}>
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              aria-label={`Use ${c}`}
              aria-pressed={value === c}
              onClick={() => onChange(c)}
              className={`h-5 w-5 rounded-full border border-black/10 transition hover:scale-110 ${value === c ? 'ring-2 ring-offset-1 ring-[var(--ink)]' : ''}`}
              style={{ background: c }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Labelled range slider with its value. */
export function Slider({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (n: number) => void }) {
  const id = `s-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[13px]">
        <label htmlFor={id} className="font-medium text-muted">{label}</label>
        <span className="num text-ink">{unit === '%' ? Math.round(value * 100) : value}{unit}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full cursor-pointer" style={{ accentColor: 'var(--accent)' }} />
    </div>
  );
}
