'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { REPEATABLE_WIDGETS, WIDGET_TYPES, type Widget, type WidgetType } from '@eril/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useUi } from '@/lib/appearance';
import { Modal, Spinner, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ColorField, Slider } from '@/components/color-field';
import { SPAN, WIDGET_META, WidgetBody, widgetSurface, type Overview } from '@/components/overview-widgets';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
const SIZE_LABELS: Array<[Widget['size'], string]> = [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL'], ['full', 'Full']];
const TINT_CHOICES: Array<[Widget['tint'], string, string]> = [
  ['none', 'Glass', 'var(--glass)'],
  ['sky', 'Sky', 'var(--tint-sky)'],
  ['sage', 'Sage', 'var(--tint-sage)'],
  ['peach', 'Peach', 'var(--tint-peach)'],
  ['neutral', 'Neutral', 'var(--tint-neutral)'],
  ['lime', 'Accent', 'color-mix(in srgb, var(--accent) 45%, var(--glass))'],
];

/** Overview: a bento of widgets each person arranges, sizes and colours for themselves. */
export default function OverviewPage() {
  const { me, can } = useAuth();
  const ui = useUi();
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [targetOpen, setTargetOpen] = useState(false);
  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [styling, setStyling] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dragId = useRef<string | null>(null);

  const load = useCallback(() => {
    api<Overview>('/dashboard/overview').then(setData).catch((e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  // The saved layout (kept in sync unless mid-edit).
  useEffect(() => {
    if (ui.prefs && !editing) setWidgets(ui.prefs.widgets);
  }, [ui.prefs, editing]);
  // ?customize=1 (from the Customize page) opens edit mode.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('customize') === '1') {
      setEditing(true);
      window.history.replaceState(null, '', '/dashboard');
    }
  }, []);

  async function complete(id: string) {
    setData((d) => (d ? { ...d, today: d.today.filter((t) => t.id !== id) } : d));
    try {
      await api(`/crm/tasks/${id}`, { method: 'PUT', body: { completed: true } });
      toast('Task done');
    } catch (e) {
      toast(errorText(e), 'error');
      load();
    }
  }

  if (error) return <div className="card p-6 text-sm text-rose-600">{error}</div>;
  if (!data || !me || !widgets) return <div className="grid h-64 place-items-center"><Spinner /></div>;
  const current = me.workspaceMemberships.find((m) => m.workspaceId === me.currentWorkspaceId);
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const activitiesToday = data.counts.tasksToday + data.counts.appointmentsToday;

  const patch = (id: string, p: Partial<Widget>) => setWidgets((ws) => ws!.map((w) => (w.id === id ? { ...w, ...p } : w)));
  const move = (id: string, dir: -1 | 1) =>
    setWidgets((ws) => {
      const list = [...ws!];
      const i = list.findIndex((w) => w.id === id);
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      [list[i], list[j]] = [list[j], list[i]];
      return list;
    });
  const dropOn = (targetId: string) =>
    setWidgets((ws) => {
      const from = dragId.current;
      if (!from || from === targetId) return ws;
      const list = [...ws!];
      const item = list.splice(list.findIndex((w) => w.id === from), 1)[0];
      list.splice(list.findIndex((w) => w.id === targetId), 0, item);
      return list;
    });
  const remove = (id: string) => setWidgets((ws) => ws!.filter((w) => w.id !== id));
  const add = (type: WidgetType) => {
    const m = WIDGET_META[type];
    const taken = new Set(widgets.map((w) => w.id));
    const id = !taken.has(type) ? type : `${type}-${Date.now().toString(36)}`;
    const w: Widget = { id, type, size: m.size, tint: m.tint, ...(type === 'note' ? { config: { text: '' } } : type === 'shortcuts' ? { config: { links: ['/pipeline', '/contacts', '/inbox', '/tasks'] } } : {}) };
    setWidgets([...widgets, w]);
    setLibraryOpen(false);
    toast(`${m.name} added`);
  };

  const save = async (list = widgets) => {
    setBusy(true);
    try {
      setWidgets(await ui.saveLayout(list));
      setEditing(false);
      setStyling(null);
      toast('Overview saved');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    setWidgets(ui.prefs!.widgets);
    setEditing(false);
    setStyling(null);
  };
  const reset = async () => {
    if (!confirm('Reset the Overview to the default widgets? Your notes and shortcuts will be removed.')) return;
    setBusy(true);
    try {
      setWidgets(await ui.resetLayout());
      setEditing(false);
      setStyling(null);
      toast('Overview reset');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  /** Notes edited outside customize mode save straight away. */
  const saveConfig = (id: string, config: Widget['config']) => {
    const next = widgets.map((w) => (w.id === id ? { ...w, config } : w));
    setWidgets(next);
    if (!editing) ui.saveLayout(next).then(setWidgets).catch((e) => toast(errorText(e), 'error'));
  };

  const present = new Set(widgets.map((w) => w.type));
  const available = WIDGET_TYPES.filter((t) => REPEATABLE_WIDGETS.includes(t) || !present.has(t));

  return (
    <div className="space-y-4">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3 pb-1 pt-2">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink md:text-[32px]">
            {greeting()}, {me.name.split(/\s+/)[0]}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {current?.workspaceName} · {date} · <span className={data.counts.overdue ? 'font-medium text-[#B4502F]' : ''}>{data.counts.overdue} overdue</span>, {activitiesToday} {activitiesToday === 1 ? 'activity' : 'activities'} today
          </p>
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary h-10" onClick={() => setEditing(true)}><Icon name="layers" className="h-4 w-4" /> Customize</button>
            {can('analytics:read') && <Link href="/reporting" className="btn-secondary h-10"><Icon name="reporting" className="h-4 w-4" /> Reports</Link>}
            {can('opportunities:write') && <Link href="/pipeline?new=1" className="btn-primary h-10"><Icon name="plus" className="h-4 w-4" /> New deal</Link>}
          </div>
        )}
      </div>

      {/* Customize toolbar */}
      {editing && (
        <div className="glass sticky top-[72px] z-20 flex flex-wrap items-center gap-2 rounded-full py-2 pl-5 pr-2 shadow-pop" role="toolbar" aria-label="Customize Overview">
          <span className="mr-auto text-[13px] text-ink"><b>Customizing</b> <span className="hidden text-muted sm:inline">· drag widgets to reorder, or use the arrows</span></span>
          <button className="btn-secondary h-9" onClick={() => setLibraryOpen(true)}><Icon name="plus" className="h-4 w-4" /> Add widget</button>
          <Link href="/appearance" className="btn-ghost h-9"><Icon name="sparkles" className="h-4 w-4" /> Theme</Link>
          <button className="btn-ghost h-9" disabled={busy} onClick={reset}>Reset</button>
          <button className="btn-ghost h-9" onClick={cancel}>Cancel</button>
          <button className="btn-primary h-9" disabled={busy} onClick={() => save()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}

      {widgets.length === 0 ? (
        <div className="card grid place-items-center gap-3 p-10 text-center">
          <p className="text-sm text-muted">Your Overview is empty.</p>
          <button className="btn-primary" onClick={() => { setEditing(true); setLibraryOpen(true); }}><Icon name="plus" className="h-4 w-4" /> Add a widget</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-6 lg:grid-cols-12">
          {widgets.map((w, i) => {
            const surf = widgetSurface(w);
            return (
              <section
                key={w.id}
                className={`relative flex flex-col p-5 ${surf.className} ${SPAN[w.size]} ${editing ? 'cursor-grab outline-dashed outline-2 outline-offset-2 outline-[var(--accent)] active:cursor-grabbing' : ''}`}
                style={surf.style}
                draggable={editing}
                onDragStart={(e) => { dragId.current = w.id; e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => editing && e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); dropOn(w.id); dragId.current = null; }}
                aria-label={editing ? `${w.title || WIDGET_META[w.type].name} widget` : undefined}
              >
                {editing && (
                  <div className="-mx-2 -mt-2 mb-3 flex items-center gap-0.5 rounded-2xl bg-[var(--pill)] p-1 text-ink shadow-sm" style={{ color: '#181a18', ['--ink' as string]: '#181a18', ['--muted' as string]: '#5c605c' }}>
                    <span className="shrink-0 px-1 text-muted" aria-hidden>⋮⋮</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{WIDGET_META[w.type].name}</span>
                    <button className="btn-ghost h-7 w-7 px-0" aria-label="Move earlier" disabled={i === 0} onClick={() => move(w.id, -1)}><Icon name="chevronDown" className="h-3.5 w-3.5 rotate-90" /></button>
                    <button className="btn-ghost h-7 w-7 px-0" aria-label="Move later" disabled={i === widgets.length - 1} onClick={() => move(w.id, 1)}><Icon name="chevronDown" className="h-3.5 w-3.5 -rotate-90" /></button>
                    <select aria-label="Widget size" className="h-7 rounded-full border border-black/10 bg-white px-2 text-[12px]" value={w.size} onChange={(e) => patch(w.id, { size: e.target.value as Widget['size'] })}>
                      {SIZE_LABELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <button className="btn-ghost h-7 w-7 px-0" aria-label="Colour and title" aria-expanded={styling === w.id} onClick={() => setStyling(styling === w.id ? null : w.id)}><Icon name="sparkles" className="h-3.5 w-3.5" /></button>
                    <button className="btn-ghost h-7 w-7 px-0" aria-label="Remove widget" onClick={() => remove(w.id)}><Icon name="close" className="h-3.5 w-3.5" /></button>
                  </div>
                )}
                {editing && styling === w.id && <StylePanel w={w} onChange={(p) => patch(w.id, p)} />}
                <WidgetBody w={w} data={data} editing={editing} onConfig={(cfg) => saveConfig(w.id, cfg)} onCompleteTask={complete} onEditTarget={() => setTargetOpen(true)} />
              </section>
            );
          })}
        </div>
      )}

      {libraryOpen && (
        <Modal open wide title="Add a widget" onClose={() => setLibraryOpen(false)}>
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map((t) => {
              const m = WIDGET_META[t];
              return (
                <button key={t} className="flex items-start gap-3 rounded-2xl border border-[var(--glass-line)] p-3 text-left transition hover:bg-[var(--track)]" onClick={() => add(t)}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent) 30%, transparent)' }}><Icon name={m.icon} className="h-4 w-4 text-ink" /></span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-ink">{m.name}</span>
                    <span className="block text-[12px] text-muted">{m.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {available.length === 0 && <p className="text-sm text-muted">Every widget is already on your Overview.</p>}
        </Modal>
      )}

      {targetOpen && <TargetModal current={data.target} currency={data.currency} onClose={() => setTargetOpen(false)} onSaved={() => { setTargetOpen(false); load(); }} />}
    </div>
  );
}

/** Per-widget colour (preset tint or own colour/gradient) and title. */
function StylePanel({ w, onChange }: { w: Widget; onChange: (p: Partial<Widget>) => void }) {
  const custom = w.tint === 'custom' && w.style;
  return (
    <div className="-mx-2 mb-3 space-y-3 rounded-2xl bg-[var(--glass-strong)] p-3 text-[#181a18] shadow-sm" style={{ ['--ink' as string]: '#181a18', ['--muted' as string]: '#5c605c' }}>
      <div>
        <label className="label" htmlFor={`wt-${w.id}`}>Title</label>
        <input id={`wt-${w.id}`} className="input h-8" maxLength={60} placeholder={WIDGET_META[w.type].name} value={w.title ?? ''} onChange={(e) => onChange({ title: e.target.value || undefined })} />
      </div>
      <div>
        <div className="mb-1.5 text-[13px] font-medium text-muted">Colour</div>
        <div className="flex flex-wrap gap-1.5">
          {TINT_CHOICES.map(([v, l, bg]) => (
            <button key={v} type="button" aria-pressed={w.tint === v} onClick={() => onChange({ tint: v, style: undefined })} className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px] ${w.tint === v ? 'border-[#181a18]' : 'border-black/10'}`}>
              <span className="h-3.5 w-3.5 rounded-full border border-black/10" style={{ background: bg }} /> {l}
            </button>
          ))}
          <button type="button" aria-pressed={!!custom} onClick={() => onChange({ tint: 'custom', style: w.style ?? { from: '#5b9ee1', to: '#a78bfa', angle: 135 } })} className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px] ${custom ? 'border-[#181a18]' : 'border-black/10'}`}>
            <span className="h-3.5 w-3.5 rounded-full" style={{ background: 'conic-gradient(#f43f5e, #facc15, #34d399, #38bdf8, #a78bfa, #f43f5e)' }} /> Custom
          </button>
        </div>
      </div>
      {custom && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ColorField id={`wf-${w.id}`} label="Colour" value={w.style!.from} swatches={false} onChange={(c) => onChange({ style: { ...w.style!, from: c } })} />
          <ColorField id={`wto-${w.id}`} label="Gradient to" value={w.style!.to} swatches={false} onChange={(c) => onChange({ style: { ...w.style!, to: c } })} onClear={() => onChange({ style: { ...w.style!, to: null } })} clearLabel="Solid" />
          {w.style!.to && <div className="sm:col-span-2"><Slider label="Direction" value={w.style!.angle} min={0} max={360} unit="°" onChange={(v) => onChange({ style: { ...w.style!, angle: v } })} /></div>}
        </div>
      )}
    </div>
  );
}

function TargetModal({ current, currency, onClose, onSaved }: { current: number | null; currency: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(current ? String(current) : '');
  const [busy, setBusy] = useState(false);
  async function save(value: number | null) {
    setBusy(true);
    try {
      await api('/dashboard/target', { method: 'PUT', body: { monthlyTarget: value } });
      toast(value === null ? 'Target removed' : 'Target saved');
      onSaved();
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Monthly revenue target" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(v.trim() ? Number(v) : null); }} className="space-y-4">
        <div>
          <label className="label" htmlFor="tg-v">Target per month ({currency})</label>
          <input id="tg-v" type="number" min={0} step="1" className="input" placeholder="50000" value={v} onChange={(e) => setV(e.target.value)} autoFocus />
          <p className="mt-1 text-xs text-muted">Shown on the Overview: progress this month and a line on the revenue chart.</p>
        </div>
        <div className="flex justify-between gap-2">
          {current !== null ? <button type="button" className="btn-ghost" disabled={busy} onClick={() => save(null)}>Remove target</button> : <span />}
          <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Save</button></div>
        </div>
      </form>
    </Modal>
  );
}
