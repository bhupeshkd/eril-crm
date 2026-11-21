'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

/** Single-series chart primitives: thin marks, recessive axes, hover/focus tooltips, table view. */
// Matches the brand palette (tailwind brand-600 / slate).
const C = {
  series: '#5847d7',
  seriesSoft: 'rgba(88,71,215,0.10)',
  grid: '#eef0f4',
  axis: '#94a3b8',
  text2: '#475569',
  text3: '#64748b',
  surface: '#ffffff',
};

type Point = { label: string; value: number };

function niceMax(max: number) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function Tooltip({ x, y, value, label, width }: { x: number; y: number; value: string; label: string; width: number }) {
  const left = Math.min(Math.max(x, 60), width - 60);
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
      style={{ left, top: y - 8 }}
    >
      <div className="font-semibold tabular-nums text-slate-900">{value}</div>
      <div className="text-slate-500">{label}</div>
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  children,
  table,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  table: { columns: [string, string]; rows: Array<[string, string]> };
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        <button className="btn-ghost h-7 px-2 text-xs" aria-pressed={showTable} onClick={() => setShowTable(!showTable)}>
          {showTable ? 'Chart' : 'Table'}
        </button>
      </div>
      {showTable ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-slate-500">
              <tr><th className="py-1">{table.columns[0]}</th><th className="py-1 text-right">{table.columns[1]}</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {table.rows.map(([a, b], i) => <tr key={i}><td className="py-1">{a}</td><td className="py-1 text-right tabular-nums">{b}</td></tr>)}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/** Vertical bars over time (e.g. new leads per day). */
export function ColumnChart({ data, format = (v) => String(v), height = 200, ariaLabel }: { data: Point[]; format?: (v: number) => string; height?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const pad = { l: 36, r: 8, t: 12, b: 24 };
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const band = (width - pad.l - pad.r) / Math.max(data.length, 1);
  const barW = Math.min(24, Math.max(2, band - 2)); // <=24px, 2px air between bars
  const y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const every = Math.ceil(data.length / 6);
  const r = Math.min(4, barW / 2);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.axis : C.grid} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill={C.text3}>{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + band * i + band / 2;
          const top = y(d.value);
          const base = y(0);
          const h = base - top;
          return (
            <g key={i}>
              {h > 0 && (
                <path
                  d={`M${cx - barW / 2},${base} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${base} Z`}
                  fill={C.series}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {/* Hit target: the full band, taller than the mark */}
              <rect
                x={pad.l + band * i}
                y={pad.t}
                width={band}
                height={height - pad.t - pad.b}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.label}: ${format(d.value)}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {i % every === 0 && (
                <text x={cx} y={height - 6} textAnchor="middle" fontSize={10} fill={C.text3}>{d.label.slice(5)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <TooltipAt svgWidth={width} height={height} x={pad.l + band * hover + band / 2} y={y(data[hover].value)} value={format(data[hover].value)} label={data[hover].label} />
      )}
    </div>
  );
}

/** Converts SVG viewBox coordinates to the rendered box for tooltip placement. */
function TooltipAt({ svgWidth, height, x, y, value, label }: { svgWidth: number; height: number; x: number; y: number; value: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      {w > 0 && <Tooltip x={(x / svgWidth) * w} y={(y / height) * ((w / svgWidth) * height)} value={value} label={label} width={w} />}
    </div>
  );
}

/** Line + soft area over time with crosshair (e.g. revenue per day). */
export function LineChart({ data, format = (v) => String(v), height = 200, ariaLabel }: { data: Point[]; format?: (v: number) => string; height?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, '');
  const width = 640;
  const pad = { l: 48, r: 12, t: 12, b: 24 };
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const x = (i: number) => pad.l + ((width - pad.l - pad.r) * i) / Math.max(data.length - 1, 1);
  const y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
  const path = useMemo(() => data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' '), [data, max]);
  const every = Math.ceil(data.length / 6);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    const i = Math.round(((px - pad.l) / (width - pad.l - pad.r)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full touch-none"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHover((h) => Math.min(data.length - 1, (h ?? -1) + 1));
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? data.length) - 1));
        }}
        onBlur={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={C.series} stopOpacity={0.18} />
            <stop offset="1" stopColor={C.series} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.axis : C.grid} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill={C.text3}>{format(t)}</text>
          </g>
        ))}
        {data.length > 1 && <path d={`${path} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${gid})`} />}
        <path d={path} fill="none" stroke={C.series} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => i % every === 0 && <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={10} fill={C.text3}>{d.label.slice(5)}</text>)}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} stroke={C.axis} strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(data[hover].value)} r={5} fill={C.series} stroke={C.surface} strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && <TooltipAt svgWidth={width} height={height} x={x(hover)} y={y(data[hover].value)} value={format(data[hover].value)} label={data[hover].label} />}
    </div>
  );
}

/** Horizontal bars for a handful of categories, value labels at the bar end. */
export function BarList({ data, format = (v) => String(v), ariaLabel }: { data: Point[]; format?: (v: number) => string; ariaLabel: string }) {
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  if (!data.length) return <p className="py-6 text-center text-sm text-slate-500">No data in this period.</p>;
  return (
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {data.map((d, i) => (
        <li key={`${i}-${d.label}`} className="grid grid-cols-[minmax(5rem,9rem)_1fr_auto] items-center gap-3 text-sm" title={`${d.label}: ${format(d.value)}`}>
          <span className="truncate text-slate-600">{d.label}</span>
          <span className="h-3 rounded-r bg-slate-50" aria-hidden>
            <span className="block h-3 rounded-r" style={{ width: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%`, backgroundColor: C.series }} />
          </span>
          <span className="tabular-nums text-slate-700">{format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}
