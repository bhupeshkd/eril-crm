'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fmtMoney } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Board, Contact, Opportunity, Paged, Pipeline } from '@/lib/types';
import { Modal, PageHeader, Spinner, StatusBadge, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

/** One accent per stage position (dot, bar). */
const STAGE_COLORS = [
  // Pastel stage badges; bars run sand (early) → sky (working) → lime (won).
  { dot: 'bg-[#D8C380]', bar: '#D8C380', soft: 'bg-[#F1E7C4] text-[#5C4D1C]' },
  { dot: 'bg-[#5B9EE1]', bar: '#5B9EE1', soft: 'bg-[#CBE1F6] text-[#1E4569]' },
  { dot: 'bg-[#8FB65A]', bar: '#5B9EE1', soft: 'bg-[#D4E7B5] text-[#33461A]' },
  { dot: 'bg-[#E0936F]', bar: '#5B9EE1', soft: 'bg-[#F1C7B8] text-[#5E2E1C]' },
  { dot: 'bg-[#9C88D6]', bar: '#5B9EE1', soft: 'bg-[#DDD5F3] text-[#3C2F66]' },
  { dot: 'bg-[#5FB3A3]', bar: '#5B9EE1', soft: 'bg-[#CBE8E2] text-[#1F4E45]' },
];
const colorAt = (i: number, name = '') =>
  /won/i.test(name)
    ? { dot: 'bg-[#A3D929]', bar: '#A3D929', soft: 'bg-[#E3F4B5] text-[#33461A]' }
    : /lost/i.test(name)
      ? { dot: 'bg-[#D5788F]', bar: '#D5788F', soft: 'bg-[#F3D2DA] text-[#6A2537]' }
      : STAGE_COLORS[i % STAGE_COLORS.length];

const HUES = ['bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-fuchsia-500'];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const contactName = (c: Contact | null) => (c ? `${c.firstName} ${c.lastName}`.trim() : '');

function MiniAvatar({ c }: { c: Contact }) {
  const n = contactName(c) || '?';
  return <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white ${hue(n)}`}>{(c.firstName?.[0] ?? '') + (c.lastName?.[0] ?? '') || '?'}</span>;
}

function closeChip(date: string | null, status: Opportunity['status']) {
  if (!date) return null;
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  const days = Math.round((d.getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
  const overdue = status === 'open' && days < 0;
  const soon = status === 'open' && days >= 0 && days <= 7;
  const label = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${overdue ? 'bg-rose-50 text-rose-700' : soon ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`} title={overdue ? 'Expected close date has passed' : 'Expected close'}>
      <Icon name="calendar" className="h-3 w-3" />
      {overdue ? `${label} · overdue` : label}
    </span>
  );
}

type StatusFilter = 'all' | 'open' | 'won' | 'lost';

export default function PipelinePage() {
  const toast = useToast();
  const { can } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [board, setBoard] = useState<Board | null>(null);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Opportunity | { new: true; stageId?: string } | null>(null);
  const [managing, setManaging] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const loadPipelines = useCallback(async () => {
    const list = await api<Pipeline[]>('/sales/pipelines');
    setPipelines(list);
    setPipelineId((cur) => (list.some((p) => p.id === cur) ? cur : list[0]?.id ?? ''));
  }, []);

  const loadBoard = useCallback(async () => {
    if (!pipelineId) return;
    try {
      setBoard(await api<Board>(`/sales/pipelines/${pipelineId}/opportunities`));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }, [pipelineId, toast]);

  useEffect(() => {
    loadPipelines().catch((e) => toast(errorText(e), 'error'));
  }, [loadPipelines, toast]);

  // Deep links: ?new=1 opens a new deal; ?deal=<id> opens that deal (on its own pipeline).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dealId = params.get('deal');
    if (params.get('new') === '1') setEditing({ new: true });
    else if (dealId && /^[0-9a-f-]{36}$/i.test(dealId)) {
      api<Opportunity>(`/sales/opportunities/${dealId}`)
        .then((o) => { setPipelineId(o.pipelineId); setEditing(o); })
        .catch((e) => toast(errorText(e), 'error'));
    }
    if (dealId || params.has('new')) window.history.replaceState(null, '', '/pipeline');
  }, [toast]);
  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  /** Optimistically move the card, then persist; reload on failure. */
  async function move(oppId: string, stageId: string, position?: number) {
    if (!board) return;
    const opp = board.stages.flatMap((s) => s.opportunities).find((o) => o.id === oppId);
    if (!opp) return;
    const next: Board = {
      ...board,
      stages: board.stages.map((s) => {
        let items = s.opportunities.filter((o) => o.id !== oppId);
        if (s.id === stageId) {
          const idx = Math.min(position ?? items.length, items.length);
          items = [...items.slice(0, idx), { ...opp, stageId }, ...items.slice(idx)];
        }
        return { ...s, opportunities: items, totalValue: items.reduce((t, o) => t + Number(o.value), 0) };
      }),
    };
    setBoard(next);
    try {
      await api(`/sales/opportunities/${oppId}/stage`, { method: 'PUT', body: { stageId, position } });
      if (opp.stageId !== stageId) {
        toast(`Moved "${opp.title}" to ${board.stages.find((s) => s.id === stageId)?.name}`);
      }
      loadBoard();
    } catch (e) {
      toast(errorText(e), 'error');
      loadBoard();
    }
  }

  function dropIndex(e: React.DragEvent) {
    const column = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-card]');
    let idx = 0;
    for (const el of column) {
      if (el.dataset.card === dragId) continue;
      const r = el.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) idx++;
    }
    return idx;
  }

  const canWrite = can('opportunities:write');
  const stageIndex = useMemo(() => new Map(board?.stages.map((s, i) => [s.id, i]) ?? []), [board]);
  const all = useMemo(() => board?.stages.flatMap((s) => s.opportunities.map((o) => ({ ...o, stageName: s.name, stageProbability: s.probability }))) ?? [], [board]);

  const matches = useCallback(
    (o: Opportunity) => {
      if (status !== 'all' && o.status !== status) return false;
      const t = q.trim().toLowerCase();
      return !t || o.title.toLowerCase().includes(t) || contactName(o.contact).toLowerCase().includes(t);
    },
    [q, status],
  );
  const filtering = status !== 'all' || !!q.trim();

  const summary = useMemo(() => {
    const open = all.filter((o) => o.status === 'open');
    const won = all.filter((o) => o.status === 'won');
    const lost = all.filter((o) => o.status === 'lost');
    const openValue = open.reduce((t, o) => t + Number(o.value), 0);
    const weighted = open.reduce((t, o) => t + Number(o.value) * ((o.probability ?? o.stageProbability ?? 0) / 100), 0);
    return {
      openValue,
      openCount: open.length,
      weighted,
      wonValue: won.reduce((t, o) => t + Number(o.value), 0),
      wonCount: won.length,
      winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    };
  }, [all]);
  const maxStageValue = Math.max(1, ...(board?.stages.map((s) => s.totalValue) ?? [1]));

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={board ? `${board.pipeline.name} · ${all.length} deal${all.length === 1 ? '' : 's'}` : 'Your sales pipeline'}
        actions={
          <>
            {pipelines.length > 1 && (
              <select aria-label="Pipeline" className="input h-9 w-auto py-0" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {can('pipelines:write') && (
              <button className="btn-secondary" onClick={() => setManaging(true)}>
                <Icon name="settings" className="h-4 w-4" /> Stages
              </button>
            )}
            {canWrite && (
              <button className="btn-primary" onClick={() => setEditing({ new: true })}>
                <Icon name="plus" className="h-4 w-4" /> New deal
              </button>
            )}
          </>
        }
      />

      {!board ? (
        <div className="grid h-64 place-items-center"><Spinner /></div>
      ) : (
        <>
          {/* Summary */}
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Open pipeline', value: fmtMoney(summary.openValue), hint: `${summary.openCount} open deal${summary.openCount === 1 ? '' : 's'}`, icon: 'pipeline', tint: 'from-brand-500 to-brand-700' },
              { label: 'Weighted forecast', value: fmtMoney(Math.round(summary.weighted)), hint: 'value × win probability', icon: 'trendUp', tint: 'from-sky-500 to-indigo-500' },
              { label: 'Won', value: fmtMoney(summary.wonValue), hint: `${summary.wonCount} deal${summary.wonCount === 1 ? '' : 's'} closed`, icon: 'check', tint: 'from-emerald-500 to-teal-500' },
              { label: 'Win rate', value: summary.winRate === null ? '—' : `${summary.winRate}%`, hint: 'won vs. lost in this pipeline', icon: 'reputation', tint: 'from-amber-500 to-orange-500' },
            ].map((k) => (
              <div key={k.label} className="card flex items-center gap-4 px-4 py-3.5">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${k.tint} text-white shadow-sm`}>
                  <Icon name={k.icon} className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-slate-500">{k.label}</div>
                  <div className="text-xl font-semibold leading-tight tracking-tight tabular-nums">{k.value}</div>
                  <div className="truncate text-[11px] text-slate-400">{k.hint}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" aria-label="Search deals" placeholder="Search deals or contacts…" className="input h-9 pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex gap-1 rounded-lg bg-slate-200/60 p-1" role="tablist" aria-label="Deal status">
              {(['all', 'open', 'won', 'lost'] as const).map((s) => (
                <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)} className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition ${status === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  {s}
                </button>
              ))}
            </div>
            <div className="ml-auto flex gap-1 rounded-lg bg-slate-200/60 p-1" role="tablist" aria-label="View">
              {([['board', 'pipeline', 'Board'], ['list', 'menu', 'List']] as const).map(([v, icon, l]) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition ${view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  <Icon name={icon} className="h-3.5 w-3.5" /> {l}
                </button>
              ))}
            </div>
          </div>

          {view === 'board' ? (
            <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-6 md:-mx-6 md:px-6">
              {board.stages.map((stage, si) => {
                const color = colorAt(si, stage.name);
                const cards = stage.opportunities.filter(matches);
                const over = overStage === stage.id;
                return (
                  <section
                    key={stage.id}
                    aria-label={`${stage.name} column`}
                    className={`glass flex w-[300px] shrink-0 flex-col rounded-[20px] transition ${over ? 'ring-4 ring-[#B6E633]/60' : ''}`}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      setOverStage(stage.id);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = dragId;
                      const idx = dropIndex(e);
                      setDragId(null);
                      setOverStage(null);
                      if (id) move(id, stage.id, idx);
                    }}
                  >
                    <header className="px-3.5 pb-2 pt-3">
                      <div className="flex items-center gap-2">
                        <h2 className={`inline-flex min-w-0 items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-[12px] font-semibold ${color.soft}`}>
                          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${color.dot}`} />
                          {stage.name}
                        </h2>
                        <span className="flex-1" />
                        <span className="chip">{stage.opportunities.length}</span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                        <span className="text-[15px] font-bold tracking-tight text-ink num">{fmtMoney(stage.totalValue)}</span>
                        <span>{stage.probability}% win chance</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--track)' }}>
                        <div className="h-full rounded-full" style={{ background: color.bar, width: `${stage.totalValue ? Math.max(4, (stage.totalValue / maxStageValue) * 100) : 0}%` }} />
                      </div>
                    </header>
                    <div className="flex min-h-[140px] flex-1 flex-col gap-2 px-2.5 pb-2.5 pt-1">
                      {cards.map((o) => (
                        <DealCard
                          key={o.id}
                          o={o}
                          stageProbability={stage.probability}
                          dragging={dragId === o.id}
                          canWrite={canWrite}
                          stages={board.stages}
                          currentStageId={stage.id}
                          onOpen={() => setEditing(o)}
                          onMove={(sid) => move(o.id, sid)}
                          onDragStart={(e) => {
                            setDragId(o.id);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', o.id);
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setOverStage(null);
                          }}
                        />
                      ))}
                      {cards.length === 0 && (
                        <div className={`grid flex-1 place-items-center rounded-2xl border-2 border-dashed px-3 py-6 text-center text-xs ${over ? 'border-[#A3D929] text-ink' : 'border-[var(--glass-line)] text-muted'}`}>
                          {filtering && stage.opportunities.length ? 'No matching deals' : over ? 'Drop here' : 'No deals yet'}
                        </div>
                      )}
                      {canWrite && (
                        <button className="mt-0.5 flex items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-medium text-muted transition hover:bg-[var(--pill)] hover:text-ink" onClick={() => setEditing({ new: true, stageId: stage.id })}>
                          <Icon name="plus" className="h-3.5 w-3.5" /> Add deal
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Deal</th>
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Close</th>
                    <th className="px-4 py-3 text-right">Probability</th>
                    <th className="px-4 py-3 text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {all.filter(matches).map((o) => {
                    const prob = o.probability ?? o.stageProbability;
                    return (
                      <tr key={o.id} className="cursor-pointer hover:bg-slate-50/80" onClick={() => setEditing(o)}>
                        <td className="px-4 py-3 font-medium text-slate-900">{o.title}</td>
                        <td className="px-4 py-3">
                          {o.contact ? (
                            <span className="flex items-center gap-2"><MiniAvatar c={o.contact} /><span className="truncate">{contactName(o.contact)}</span></span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`badge ${colorAt(stageIndex.get(o.stageId) ?? 0).soft}`}>{o.stageName}</span>
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                        <td className="px-4 py-3">{closeChip(o.expectedCloseDate, o.status) ?? <span className="text-slate-400">—</span>}</td>
                        <td className="px-4 py-3">
                          <span className="ml-auto flex w-28 items-center justify-end gap-2">
                            <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${prob}%` }} /></span>
                            <span className="w-8 text-right text-xs tabular-nums text-slate-500">{prob}%</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtMoney(o.value)}</td>
                      </tr>
                    );
                  })}
                  {all.filter(matches).length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">{filtering ? 'No deals match these filters.' : 'No deals yet.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal open={editing !== null} title={editing && 'new' in editing ? 'New deal' : 'Deal details'} onClose={() => setEditing(null)}>
        {editing !== null && board && (
          <OpportunityForm
            opp={'new' in editing ? null : editing}
            initialStageId={'new' in editing ? editing.stageId : undefined}
            board={board}
            canDelete={can('opportunities:delete')}
            onDone={(msg) => {
              setEditing(null);
              toast(msg);
              loadBoard();
            }}
          />
        )}
      </Modal>
      <Modal open={managing} title="Pipeline stages" onClose={() => setManaging(false)}>
        {managing && board && (
          <StageEditor
            pipeline={pipelines.find((p) => p.id === pipelineId)!}
            onSaved={async () => {
              setManaging(false);
              toast('Stages saved');
              await loadPipelines();
              loadBoard();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function DealCard({
  o,
  stageProbability,
  dragging,
  canWrite,
  stages,
  currentStageId,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  o: Opportunity;
  stageProbability: number;
  dragging: boolean;
  canWrite: boolean;
  stages: Board['stages'];
  currentStageId: string;
  onOpen: () => void;
  onMove: (stageId: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const prob = o.probability ?? stageProbability;
  const closed = o.status !== 'open';
  return (
    <article
      data-card={o.id}
      draggable={canWrite}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group relative rounded-2xl border p-3 transition hover:-translate-y-px hover:shadow-[0_10px_24px_-18px_rgba(24,26,24,0.45)] ${canWrite ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging ? 'rotate-1 opacity-40' : ''} ${
        o.status === 'won' ? 'border-[#A3D929]/60' : o.status === 'lost' ? 'border-rose-200 opacity-80' : 'border-[var(--glass-border)]'
      }`}
      style={{ background: 'var(--glass-strong)' }}
    >
      <div className="flex items-start gap-2">
        <button className="min-w-0 flex-1 text-left text-[14px] font-semibold leading-snug text-ink hover:underline" onClick={onOpen}>
          {o.title}
        </button>
        {closed && <StatusBadge status={o.status} />}
      </div>
      <div className="mt-2 text-lg font-semibold tracking-tight tabular-nums text-slate-900">{fmtMoney(o.value)}</div>
      {o.contact && (
        <Link href={`/contacts/${o.contact.id}`} className="mt-2 flex items-center gap-1.5 text-xs text-slate-600 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>
          <MiniAvatar c={o.contact} />
          <span className="truncate">{contactName(o.contact)}</span>
        </Link>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        {closeChip(o.expectedCloseDate, o.status)}
        {!closed && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500" title="Win probability">
            <span className="h-1 w-10 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${prob}%` }} /></span>
            <span className="tabular-nums">{prob}%</span>
          </span>
        )}
      </div>
      {canWrite && (
        <label className="mt-2.5 block opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
          <span className="sr-only">Move {o.title} to stage</span>
          <select className="w-full cursor-pointer rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 focus:border-brand-400 focus:outline-none" value={currentStageId} onChange={(e) => onMove(e.target.value)}>
            {stages.map((s) => <option key={s.id} value={s.id}>Move to: {s.name}</option>)}
          </select>
        </label>
      )}
    </article>
  );
}

function OpportunityForm({
  opp,
  initialStageId,
  board,
  canDelete,
  onDone,
}: {
  opp: Opportunity | null;
  initialStageId?: string;
  board: Board;
  canDelete: boolean;
  onDone: (msg: string) => void;
}) {
  const [title, setTitle] = useState(opp?.title ?? '');
  const [value, setValue] = useState(String(opp?.value ?? ''));
  const [stageId, setStageId] = useState(opp?.stageId ?? initialStageId ?? board.stages[0]?.id);
  const [contactId, setContactId] = useState(opp?.contactId ?? '');
  const [probability, setProbability] = useState(opp?.probability != null ? String(opp.probability) : '');
  const [closeDate, setCloseDate] = useState(opp?.expectedCloseDate ? opp.expectedCloseDate.slice(0, 10) : '');
  const [status, setStatus] = useState<Opportunity['status']>(opp?.status ?? 'open');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const stageDefault = board.stages.find((s) => s.id === stageId)?.probability ?? 0;

  useEffect(() => {
    api<Paged<Contact>>('/crm/contacts?limit=100').then((r) => setContacts(r.items)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const body = {
      title,
      value: Number(value) || 0,
      contactId: contactId || null,
      probability: probability === '' ? null : Number(probability),
      expectedCloseDate: closeDate || null,
      ...(opp ? { status } : {}),
    };
    try {
      if (opp) {
        await api(`/sales/opportunities/${opp.id}`, { method: 'PUT', body });
        if (stageId !== opp.stageId) await api(`/sales/opportunities/${opp.id}/stage`, { method: 'PUT', body: { stageId } });
        onDone('Deal updated');
      } else {
        await api('/sales/opportunities', { method: 'POST', body: { ...body, contactId: contactId || undefined, expectedCloseDate: closeDate || undefined, pipelineId: board.pipeline.id, stageId } });
        onDone('Deal created');
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="op-title">Deal name *</label>
        <input id="op-title" required className="input" placeholder="e.g. Website redesign for Acme" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="op-value">Value</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
            <input id="op-value" type="number" min="0" step="0.01" className="input pl-7 tabular-nums" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="op-close">Expected close</label>
          <input id="op-close" type="date" className="input" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="op-stage">Stage</label>
          <select id="op-stage" className="input" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {board.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="op-prob">Win probability</label>
          <div className="relative">
            <input id="op-prob" type="number" min="0" max="100" className="input pr-8 tabular-nums" placeholder={`${stageDefault} (stage default)`} value={probability} onChange={(e) => setProbability(e.target.value)} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
          </div>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="op-contact">Contact</label>
        <select id="op-contact" className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">— None —</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.email ? ` (${c.email})` : ''}</option>)}
        </select>
      </div>
      {opp && (
        <fieldset>
          <legend className="label">Outcome</legend>
          <div className="grid grid-cols-3 gap-2">
            {([['open', 'Open', 'pipeline', 'border-brand-500 bg-brand-50/60 text-brand-800 ring-brand-500'], ['won', 'Won', 'check', 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-emerald-500'], ['lost', 'Lost', 'close', 'border-rose-500 bg-rose-50 text-rose-800 ring-rose-500']] as const).map(([v, l, icon, on]) => (
              <label key={v} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${status === v ? `${on} ring-1` : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                <input type="radio" name="op-status" className="sr-only" checked={status === v} onChange={() => setStatus(v)} />
                <Icon name={icon} className="h-4 w-4" /> {l}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
        {opp && canDelete ? (
          <button
            type="button"
            className="btn-ghost text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            onClick={async () => {
              if (!confirm('Delete this deal?')) return;
              await api(`/sales/opportunities/${opp.id}`, { method: 'DELETE' });
              onDone('Deal deleted');
            }}
          >
            Delete deal
          </button>
        ) : <span />}
        <button className="btn-primary" disabled={busy}>{opp ? 'Save changes' : 'Create deal'}</button>
      </div>
    </form>
  );
}

function StageEditor({ pipeline, onSaved }: { pipeline: Pipeline; onSaved: () => void }) {
  const [name, setName] = useState(pipeline.name);
  const [stages, setStages] = useState(pipeline.stages.map((s) => ({ id: s.id as string | undefined, name: s.name, probability: s.probability })));
  const [error, setError] = useState('');
  const update = (i: number, patch: Partial<(typeof stages)[number]>) => setStages(stages.map((s, j) => (i === j ? { ...s, ...patch } : s)));
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    [next[i], next[j]] = [next[j], next[i]];
    setStages(next);
  };
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/sales/pipelines/${pipeline.id}`, { method: 'PUT', body: { name, stages } });
          onSaved();
        } catch (err) {
          setError(errorText(err));
        }
      }}
    >
      <div>
        <label className="label" htmlFor="pl-name">Pipeline name</label>
        <input id="pl-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-slate-400">
          <span>Stage</span>
          <span className="mr-[104px]">Win %</span>
        </div>
        <ul className="space-y-2">
          {stages.map((s, i) => (
            <li key={s.id ?? `new-${i}`} className="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/60 p-1.5 pl-3">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${colorAt(i).dot}`} />
              <input aria-label="Stage name" className="input h-8 py-1" value={s.name} required onChange={(e) => update(i, { name: e.target.value })} />
              <input aria-label="Probability" type="number" min={0} max={100} className="input h-8 w-20 py-1 tabular-nums" value={s.probability} onChange={(e) => update(i, { probability: Number(e.target.value) })} />
              <button type="button" className="btn-ghost h-8 w-8 px-0" aria-label="Move up" disabled={i === 0} onClick={() => swap(i, i - 1)}>↑</button>
              <button type="button" className="btn-ghost h-8 w-8 px-0" aria-label="Move down" disabled={i === stages.length - 1} onClick={() => swap(i, i + 1)}>↓</button>
              <button type="button" className="btn-ghost h-8 w-8 px-0 text-slate-400 hover:text-rose-600" aria-label="Remove stage" disabled={stages.length <= 1} onClick={() => setStages(stages.filter((_, j) => j !== i))}>
                <Icon name="close" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <button type="button" className="btn-secondary w-full border-dashed" onClick={() => setStages([...stages, { id: undefined, name: 'New stage', probability: 0 }])}>
        <Icon name="plus" className="h-4 w-4" /> Add stage
      </button>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end border-t border-slate-100 pt-4">
        <button className="btn-primary">Save stages</button>
      </div>
    </form>
  );
}
