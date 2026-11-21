'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact, Paged, Pipeline, StepType, Workflow, WorkflowRun, WorkflowStep } from '@/lib/types';
import {
  ACTION_META,
  CONDITION_FIELDS,
  OPERATOR_LABEL,
  Slot,
  TRIGGER_META,
  describeStep,
  findStep,
  insertStep,
  makeStep,
  removeStep,
  shiftStep,
  updateStep,
} from '@/lib/workflow-tree';
import { EditorBar, LiveBadge, Modal, PageLoader, StatusBadge, TitleInput, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

/** Line icon for each step type (replaces the emoji glyphs in ACTION_META). */
const STEP_ICON: Record<StepType, string> = {
  send_email: 'mail',
  send_sms: 'sms',
  add_tag: 'tag',
  remove_tag: 'tag',
  update_contact: 'userEdit',
  create_opportunity: 'pipeline',
  create_task: 'tasks',
  add_note: 'note',
  webhook: 'webhook',
  send_review_request: 'reputation',
  ai_generate: 'sparkles',
  enroll_in_course: 'courses',
  wait: 'clock',
  log: 'terminal',
  condition: 'split',
};

/** Chip + accent colours, keyed by the colour family ACTION_META already uses. */
const TONES: Record<string, { chip: string; bar: string }> = {
  brand: { chip: 'bg-gradient-to-br from-brand-500 to-brand-700 text-white', bar: 'bg-brand-500' },
  sky: { chip: 'bg-sky-100 text-sky-700', bar: 'bg-sky-400' },
  violet: { chip: 'bg-violet-100 text-violet-700', bar: 'bg-violet-400' },
  emerald: { chip: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-400' },
  amber: { chip: 'bg-amber-100 text-amber-700', bar: 'bg-amber-400' },
  orange: { chip: 'bg-orange-100 text-orange-700', bar: 'bg-orange-400' },
  slate: { chip: 'bg-slate-100 text-slate-600', bar: 'bg-slate-400' },
};
const toneOf = (t: StepType) => TONES[/border-(\w+)-/.exec(ACTION_META[t].color)?.[1] ?? 'slate'] ?? TONES.slate;

type Selection = { kind: 'trigger' } | { kind: 'step'; id: string } | null;
type Ref = { id: string; name: string };
type Refs = { forms: Ref[]; calendars: Ref[]; courses: Ref[]; templates: Ref[]; campaigns: Ref[]; orderForms: Ref[]; communities: Ref[] };

export default function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [wf, setWf] = useState<Workflow | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<Selection>({ kind: 'trigger' });
  const [adding, setAdding] = useState<Slot | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [refs, setRefs] = useState<Refs>({ forms: [], calendars: [], courses: [], templates: [], campaigns: [], orderForms: [], communities: [] });
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const editable = can('workflows:write');
  const loaded = !!wf;

  // Wide If/Else trees overflow the canvas; start scrolled to the centre so the trigger is visible.
  useEffect(() => {
    const el = canvasRef.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [loaded]);

  const loadRuns = useCallback(() => api<WorkflowRun[]>(`/automation/workflows/${id}/runs`).then(setRuns).catch(() => {}), [id]);

  useEffect(() => {
    api<Workflow>(`/automation/workflows/${id}`).then(setWf).catch((e) => toast(errorText(e), 'error'));
    api<Pipeline[]>('/sales/pipelines').then(setPipelines).catch(() => {});
    Promise.all([api('/forms').catch(() => []), api('/calendars').catch(() => []), api('/courses').catch(() => []), api('/email-templates').catch(() => []), api('/campaigns').catch(() => []), api('/payments/order-forms').catch(() => []), api('/communities').catch(() => [])]).then(([forms, calendars, courses, templates, campaigns, orderForms, communities]) =>
      setRefs({ forms, calendars, courses: courses.map((c: any) => ({ id: c.id, name: c.title })), templates, campaigns: campaigns.filter((c: any) => c.channel === 'email'), orderForms, communities }),
    );
    loadRuns();
  }, [id, toast, loadRuns]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = (patch: Partial<Workflow>) => {
    setWf((w) => (w ? { ...w, ...patch } : w));
    setDirty(true);
  };
  const setSteps = (fn: (s: WorkflowStep[]) => WorkflowStep[]) => {
    setWf((w) => (w ? { ...w, steps: fn(w.steps) } : w));
    setDirty(true);
  };

  async function save(extra: Partial<Workflow> = {}) {
    if (!wf) return;
    setSaving(true);
    try {
      const saved = await api<Workflow>(`/automation/workflows/${id}`, {
        method: 'PUT',
        body: {
          name: wf.name,
          triggerType: wf.triggerType,
          triggerConfig: wf.triggerConfig,
          steps: wf.steps,
          isPublished: extra.isPublished ?? wf.isPublished,
        },
      });
      setWf(saved);
      setDirty(false);
      toast(extra.isPublished === undefined ? 'Workflow saved' : extra.isPublished ? 'Workflow published' : 'Workflow unpublished');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  const selectedStep = useMemo(
    () => (wf && selected?.kind === 'step' ? findStep(wf.steps, selected.id) : null),
    [wf, selected],
  );

  if (!wf) return <PageLoader />;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <EditorBar
        back={{ href: '/workflows', label: 'Automation' }}
        title={<TitleInput label="Workflow name" value={wf.name} disabled={!editable} onChange={(name) => change({ name })} />}
        status={<LiveBadge on={wf.isPublished} />}
        dirty={dirty}
        actions={
          <>
            {editable && (
              <button
                className="btn-ghost h-9 w-9 px-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                aria-label="Delete workflow"
                title="Delete workflow"
                onClick={async () => {
                  if (!confirm('Delete this workflow?')) return;
                  await api(`/automation/workflows/${id}`, { method: 'DELETE' });
                  router.push('/workflows');
                }}
              >
                <Icon name="trash" />
              </button>
            )}
            {can('workflows:execute') && <button className="btn-secondary" onClick={() => setTesting(true)}><Icon name="play" /> Test run</button>}
            {editable && (
              <>
                <button className="btn-secondary" disabled={saving} onClick={() => save({ isPublished: !wf.isPublished })}>
                  {wf.isPublished ? 'Unpublish' : 'Publish'}
                </button>
                <button className="btn-primary" disabled={saving || !dirty} onClick={() => save()}>{saving ? 'Saving…' : 'Save'}</button>
              </>
            )}
          </>
        }
      />

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Canvas */}
        <div
          ref={canvasRef}
          className="card min-w-0 flex-1 overflow-auto bg-slate-50/60 bg-[radial-gradient(circle,#cbd5e1_1px,transparent_1px)] [background-size:20px_20px] p-10"
          aria-label="Workflow canvas"
        >
          <div className="mx-auto flex w-max min-w-full flex-col items-center">
            <NodeCard
              selected={selected?.kind === 'trigger'}
              onClick={() => setSelected({ kind: 'trigger' })}
              tone={TONES.brand}
              icon="automation"
              eyebrow="Trigger"
              title={TRIGGER_META[wf.triggerType] ?? wf.triggerType}
            />
            <StepList
              steps={wf.steps}
              parentId={null}
              branch="root"
              editable={editable}
              selectedId={selected?.kind === 'step' ? selected.id : null}
              onSelect={(sid) => setSelected({ kind: 'step', id: sid })}
              onAdd={setAdding}
            />
            <div className="mt-1 flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-300" /> End
            </div>
          </div>
        </div>

        {/* Properties panel */}
        <aside className="card w-80 shrink-0 overflow-y-auto p-4" aria-label="Properties">
          {selected?.kind === 'trigger' ? (
            <TriggerPanel wf={wf} pipelines={pipelines} refs={refs} editable={editable} onChange={change} />
          ) : selectedStep ? (
            <StepPanel
              step={selectedStep}
              pipelines={pipelines}
              editable={editable}
              courses={refs.courses}
              templates={refs.templates}
              onChange={(config) => setSteps((s) => updateStep(s, selectedStep.id, (x) => ({ ...x, config: { ...x.config, ...config } })))}
              onMove={(dir) => setSteps((s) => shiftStep(s, selectedStep.id, dir))}
              onDelete={() => {
                setSteps((s) => removeStep(s, selectedStep.id));
                setSelected({ kind: 'trigger' });
              }}
            />
          ) : (
            <p className="text-sm text-slate-500">Select a node to edit it.</p>
          )}

          <div className="mt-6 border-t border-slate-100 pt-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recent runs</h3>
            {runs.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">No runs yet. Use Test run to try it.</p>
            ) : (
              <ul className="space-y-2">
                {runs.slice(0, 10).map((r) => (
                  <li key={r.id} className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <StatusBadge status={r.status} />
                      <span className="text-slate-400">{fmtDate(r.createdAt)}</span>
                    </div>
                    <ol className="mt-2 space-y-1 border-l border-slate-200 pl-3 text-slate-600">
                      {r.log.map((l, i) => (
                        <li key={i} className="relative before:absolute before:-left-[15px] before:top-1.5 before:h-1.5 before:w-1.5 before:rounded-full before:bg-slate-300">
                          <span className="font-medium text-slate-700">{ACTION_META[l.type as StepType]?.label ?? l.type}</span>: {l.result}
                        </li>
                      ))}
                    </ol>
                    {r.error && <p className="mt-1.5 rounded bg-rose-50 px-2 py-1 text-rose-700">{r.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <Modal open={!!adding} title="Add a step" onClose={() => setAdding(null)}>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(ACTION_META) as StepType[]).map((t) => (
            <button
              key={t}
              className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 text-left text-sm font-medium text-slate-800 transition hover:border-brand-300 hover:bg-brand-50/40 hover:shadow-sm"
              onClick={() => {
                const step = makeStep(t);
                setSteps((s) => insertStep(s, adding!, step));
                setSelected({ kind: 'step', id: step.id });
                setAdding(null);
              }}
            >
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${toneOf(t).chip}`}><Icon name={STEP_ICON[t]} className="h-4 w-4" /></span>
              {ACTION_META[t].label}
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={testing} title="Test run" onClose={() => setTesting(false)}>
        {testing && (
          <TestRun
            workflowId={id}
            dirty={dirty}
            onDone={(run) => {
              setTesting(false);
              toast(`Run ${run.status}`, run.status === 'failed' ? 'error' : 'ok');
              loadRuns();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function NodeCard({
  selected,
  onClick,
  tone,
  icon,
  eyebrow,
  title,
}: {
  selected: boolean;
  onClick: () => void;
  tone: { chip: string; bar: string };
  icon: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`group relative flex w-64 items-center gap-3 overflow-hidden rounded-xl border bg-white py-2.5 pl-3.5 pr-3 text-left shadow-card transition ${selected ? 'border-brand-500 shadow-glow' : 'border-slate-200 hover:-translate-y-px hover:border-slate-300 hover:shadow-card-hover'}`}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} />
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone.chip}`}><Icon name={icon} className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">{eyebrow}</span>
        <span className="block truncate text-[13px] font-medium text-slate-800">{title}</span>
      </span>
    </button>
  );
}

function Connector({ onAdd, editable }: { onAdd: () => void; editable: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div className="h-4 w-px bg-slate-300" />
      {editable ? (
        <button
          onClick={onAdd}
          aria-label="Add step here"
          className="grid h-6 w-6 place-items-center rounded-full border border-slate-300 bg-white text-slate-400 shadow-sm transition hover:scale-110 hover:border-brand-500 hover:bg-brand-600 hover:text-white"
        >
          <Icon name="plus" className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      ) : (
        <div className="h-2 w-px bg-slate-300" />
      )}
      <div className="h-4 w-px bg-slate-300" />
    </div>
  );
}

function StepList({
  steps,
  parentId,
  branch,
  editable,
  selectedId,
  onSelect,
  onAdd,
}: {
  steps: WorkflowStep[];
  parentId: string | null;
  branch: Slot['branch'];
  editable: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (slot: Slot) => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <Connector editable={editable} onAdd={() => onAdd({ parentId, branch, index: 0 })} />
      {steps.map((s, i) => {
        const meta = ACTION_META[s.type];
        return (
          <div key={s.id} className="flex flex-col items-center">
            <NodeCard
              selected={selectedId === s.id}
              onClick={() => onSelect(s.id)}
              tone={toneOf(s.type)}
              icon={STEP_ICON[s.type]}
              eyebrow={meta.label}
              title={describeStep(s)}
            />
            {s.type === 'condition' && (
              <div className="relative mt-0 flex gap-8 pt-4">
                <div className="absolute left-1/2 top-0 h-4 w-px bg-slate-300" />
                {(['then', 'else'] as const).map((b) => (
                  <div key={b} className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-5 pb-3 pt-2.5">
                    <span className={`badge ${b === 'then' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-rose-50 text-rose-700 ring-rose-600/15'}`}>
                      <Icon name={b === 'then' ? 'check' : 'close'} className="h-3 w-3" strokeWidth={2.5} />
                      {b === 'then' ? 'Yes' : 'No'}
                    </span>
                    <StepList
                      steps={s[b] ?? []}
                      parentId={s.id}
                      branch={b}
                      editable={editable}
                      selectedId={selectedId}
                      onSelect={onSelect}
                      onAdd={onAdd}
                    />
                  </div>
                ))}
              </div>
            )}
            <Connector editable={editable} onAdd={() => onAdd({ parentId, branch, index: i + 1 })} />
          </div>
        );
      })}
    </div>
  );
}

function TriggerPanel({
  wf,
  pipelines,
  refs,
  editable,
  onChange,
}: {
  wf: Workflow;
  pipelines: Pipeline[];
  refs: Refs;
  editable: boolean;
  onChange: (p: Partial<Workflow>) => void;
}) {
  const cfg = wf.triggerConfig ?? {};
  const setCfg = (patch: Record<string, any>) => {
    const next = { ...cfg, ...patch };
    Object.keys(next).forEach((k) => (next[k] === '' || next[k] == null) && delete next[k]);
    onChange({ triggerConfig: next });
  };
  const stages = pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, pipeline: p.name })));
  return (
    <fieldset disabled={!editable} className="space-y-4">
      <PanelHead tone={TONES.brand} icon="automation" title="Trigger" hint="What starts this workflow" />
      <div>
        <label className="label" htmlFor="tr-type">When…</label>
        <select id="tr-type" className="input" value={wf.triggerType} onChange={(e) => onChange({ triggerType: e.target.value, triggerConfig: {} })}>
          {Object.entries(TRIGGER_META).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {wf.triggerType === 'contact.tag_added' && (
        <div>
          <label className="label" htmlFor="tr-tag">Only for tag</label>
          <input id="tr-tag" className="input" placeholder="Any tag" value={cfg.tag ?? ''} onChange={(e) => setCfg({ tag: e.target.value })} />
        </div>
      )}
      {wf.triggerType === 'opportunity.stage_changed' && (
        <div>
          <label className="label" htmlFor="tr-stage">Moved into stage</label>
          <select id="tr-stage" className="input" value={cfg.stageId ?? ''} onChange={(e) => setCfg({ stageId: e.target.value })}>
            <option value="">Any stage</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.pipeline} · {s.name}</option>)}
          </select>
        </div>
      )}
      {wf.triggerType === 'message.received' && (
        <div>
          <label className="label" htmlFor="tr-ch">Channel</label>
          <select id="tr-ch" className="input" value={cfg.channel ?? ''} onChange={(e) => setCfg({ channel: e.target.value })}>
            <option value="">Any</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>
        </div>
      )}
      {wf.triggerType === 'form.submitted' && (
        <div>
          <label className="label" htmlFor="tr-form">Form</label>
          <select id="tr-form" className="input" value={cfg.formId ?? ''} onChange={(e) => setCfg({ formId: e.target.value })}>
            <option value="">Any form</option>
            {refs.forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      )}
      {wf.triggerType.startsWith('community.') && (
        <div>
          <label className="label" htmlFor="tr-comm">Community</label>
          <select id="tr-comm" className="input" value={cfg.communityId ?? ''} onChange={(e) => setCfg({ communityId: e.target.value })}>
            <option value="">Any community</option>
            {refs.communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {wf.triggerType === 'community.post_created' && <p className="mt-1 text-xs text-slate-500">Runs for member posts (not team posts).</p>}
        </div>
      )}
      {wf.triggerType.startsWith('order.') && (
        <div>
          <label className="label" htmlFor="tr-oform">Order form</label>
          <select id="tr-oform" className="input" value={cfg.formId ?? ''} onChange={(e) => setCfg({ formId: e.target.value })}>
            <option value="">Any order form</option>
            {refs.orderForms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {wf.triggerType === 'order.submitted' && <p className="mt-1 text-xs text-slate-500">Fires when the buyer submits, before paying. Use “Order is paid” for completed purchases.</p>}
        </div>
      )}
      {wf.triggerType.startsWith('appointment.') && (
        <div>
          <label className="label" htmlFor="tr-cal">Calendar</label>
          <select id="tr-cal" className="input" value={cfg.calendarId ?? ''} onChange={(e) => setCfg({ calendarId: e.target.value })}>
            <option value="">Any calendar</option>
            {refs.calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {wf.triggerType.startsWith('course.') && (
        <div>
          <label className="label" htmlFor="tr-course">Course</label>
          <select id="tr-course" className="input" value={cfg.courseId ?? ''} onChange={(e) => setCfg({ courseId: e.target.value })}>
            <option value="">Any course</option>
            {refs.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {wf.triggerType.startsWith('email.') && (
        <>
          <div>
            <label className="label" htmlFor="tr-camp">From campaign</label>
            <select id="tr-camp" className="input" value={cfg.campaignId ?? ''} onChange={(e) => setCfg({ campaignId: e.target.value })}>
              <option value="">Any tracked email</option>
              {refs.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {wf.triggerType === 'email.clicked' && (
            <div>
              <label className="label" htmlFor="tr-url">Link contains (optional)</label>
              <input id="tr-url" className="input" placeholder="e.g. /pricing" value={cfg.urlContains ?? ''} onChange={(e) => setCfg({ urlContains: e.target.value })} />
            </div>
          )}
          <p className="text-xs text-slate-500">Runs once per recipient per email{wf.triggerType === 'email.clicked' ? ' and link' : ''}. Only designed emails are tracked.</p>
        </>
      )}
      {wf.triggerType === 'appointment.status_changed' && (
        <div>
          <label className="label" htmlFor="tr-st">New status</label>
          <select id="tr-st" className="input" value={cfg.status ?? ''} onChange={(e) => setCfg({ status: e.target.value })}>
            <option value="">Any</option>
            {['confirmed', 'cancelled', 'showed', 'noshow'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Workflows only run automatically while <strong>published</strong>. Use “Test run” to try a draft.
      </p>
    </fieldset>
  );
}

function StepPanel({
  step,
  pipelines,
  courses,
  templates,
  editable,
  onChange,
  onMove,
  onDelete,
}: {
  step: WorkflowStep;
  pipelines: Pipeline[];
  courses: Ref[];
  templates: Ref[];
  editable: boolean;
  onChange: (config: Record<string, any>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const c = step.config;
  const meta = ACTION_META[step.type];
  const text = (key: string, label: string, opts: { multiline?: boolean; placeholder?: string; type?: string } = {}) => (
    <div>
      <label className="label" htmlFor={`f-${key}`}>{label}</label>
      {opts.multiline ? (
        <textarea id={`f-${key}`} rows={5} className="input font-mono text-xs" value={c[key] ?? ''} placeholder={opts.placeholder} onChange={(e) => onChange({ [key]: e.target.value })} />
      ) : (
        <input id={`f-${key}`} type={opts.type ?? 'text'} className="input" value={c[key] ?? ''} placeholder={opts.placeholder} onChange={(e) => onChange({ [key]: opts.type === 'number' ? Number(e.target.value) : e.target.value })} />
      )}
    </div>
  );

  return (
    <fieldset disabled={!editable} className="space-y-4">
      <PanelHead
        tone={toneOf(step.type)}
        icon={STEP_ICON[step.type]}
        title={meta.label}
        hint="Step settings"
        actions={
          <div className="flex rounded-lg border border-slate-200">
            <button type="button" className="btn-ghost h-7 w-7 rounded-r-none px-0" aria-label="Move step up" title="Move up" onClick={() => onMove(-1)}>
              <Icon name="chevronDown" className="h-4 w-4 rotate-180" />
            </button>
            <button type="button" className="btn-ghost h-7 w-7 rounded-l-none border-l border-slate-200 px-0" aria-label="Move step down" title="Move down" onClick={() => onMove(1)}>
              <Icon name="chevronDown" className="h-4 w-4" />
            </button>
          </div>
        }
      />

      {step.type === 'send_email' && (
        <>
          <div>
            <label className="label" htmlFor="f-tpl">Design</label>
            <select id="f-tpl" className="input" value={c.templateId ?? ''} onChange={(e) => onChange({ templateId: e.target.value || undefined })}>
              <option value="">Plain text</option>
              {templates.map((x) => <option key={x.id} value={x.id}>Template: {x.name}</option>)}
            </select>
          </div>
          {text('subject', c.templateId ? 'Subject (blank = template subject)' : 'Subject')}
          {!c.templateId && text('body', 'Body', { multiline: true })}
        </>
      )}
      {step.type === 'send_sms' && text('body', 'Message', { multiline: true })}
      {(step.type === 'add_tag' || step.type === 'remove_tag') && text('tag', 'Tag', { placeholder: 'e.g. vip' })}
      {step.type === 'log' && text('message', 'Log message', { multiline: true })}
      {step.type === 'add_note' && text('body', 'Note on contact', { multiline: true })}
      {step.type === 'create_task' && (
        <>
          {text('title', 'Task title')}
          {text('description', 'Details', { multiline: true })}
          {text('dueInDays', 'Due in (days)', { type: 'number' })}
        </>
      )}
      {step.type === 'webhook' && (
        <>
          {text('url', 'POST to URL', { placeholder: 'https://hooks.example.com/…' })}
          <p className="text-xs text-slate-500">Sends the contact and trigger data as JSON. Private/internal addresses are blocked.</p>
        </>
      )}
      {step.type === 'enroll_in_course' && (
        <>
          <div>
            <label className="label" htmlFor="f-course">Course</label>
            <select id="f-course" className="input" value={c.courseId ?? ''} onChange={(e) => onChange({ courseId: e.target.value })}>
              <option value="">Choose a published course…</option>
              {courses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.notify !== false} onChange={(e) => onChange({ notify: e.target.checked })} /> Send the access link</label>
        </>
      )}
      {step.type === 'send_review_request' && (
        <div>
          <label className="label" htmlFor="f-rch">Send via</label>
          <select id="f-rch" className="input" value={c.channel ?? 'email'} onChange={(e) => onChange({ channel: e.target.value })}>
            <option value="email">Email</option><option value="sms">SMS</option>
          </select>
        </div>
      )}
      {step.type === 'ai_generate' && (
        <>
          {text('prompt', 'Instructions for the AI', { multiline: true })}
          <p className="text-xs text-slate-500">The result is available to later steps as <code className="rounded bg-slate-100 px-1">{'{{ai.text}}'}</code> — e.g. as the body of a Send email step. Requires ANTHROPIC_API_KEY on the server.</p>
        </>
      )}
      {step.type === 'wait' && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="label" htmlFor="f-amount">Wait for</label>
            <input id="f-amount" type="number" min={0} className="input" value={c.amount ?? 0} onChange={(e) => onChange({ amount: Number(e.target.value) })} />
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="f-unit">Unit</label>
            <select id="f-unit" className="input" value={c.unit ?? 'minutes'} onChange={(e) => onChange({ unit: e.target.value })}>
              <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
            </select>
          </div>
        </div>
      )}
      {step.type === 'update_contact' && (
        <>
          <div>
            <label className="label" htmlFor="f-field">Field</label>
            <select id="f-field" className="input" value={c.field} onChange={(e) => onChange({ field: e.target.value, value: e.target.value === 'status' ? 'customer' : '' })}>
              {['status', 'firstName', 'lastName', 'phone', 'notes'].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          {c.field === 'status' ? (
            <div>
              <label className="label" htmlFor="f-value">Value</label>
              <select id="f-value" className="input" value={c.value} onChange={(e) => onChange({ value: e.target.value })}>
                <option value="lead">lead</option>
                <option value="customer">customer</option>
                <option value="churned">churned</option>
              </select>
            </div>
          ) : (
            text('value', 'Value')
          )}
        </>
      )}
      {step.type === 'create_opportunity' && (
        <>
          {text('title', 'Deal name')}
          {text('value', 'Value ($)', { type: 'number' })}
          <div>
            <label className="label" htmlFor="f-stage">Stage</label>
            <select
              id="f-stage"
              className="input"
              value={c.stageId ?? ''}
              onChange={(e) => {
                const p = pipelines.find((x) => x.stages.some((s) => s.id === e.target.value));
                onChange({ stageId: e.target.value || undefined, pipelineId: p?.id });
              }}
            >
              <option value="">First stage of default pipeline</option>
              {pipelines.flatMap((p) => p.stages.map((s) => <option key={s.id} value={s.id}>{p.name} · {s.name}</option>))}
            </select>
          </div>
        </>
      )}
      {step.type === 'condition' && (
        <>
          <div>
            <label className="label" htmlFor="f-cfield">If field</label>
            <input id="f-cfield" list="cond-fields" className="input" value={c.field} onChange={(e) => onChange({ field: e.target.value })} />
            <datalist id="cond-fields">{CONDITION_FIELDS.map((f) => <option key={f} value={f} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="f-op">Operator</label>
            <select id="f-op" className="input" value={c.operator} onChange={(e) => onChange({ operator: e.target.value })}>
              {Object.entries(OPERATOR_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {!['exists', 'not_exists'].includes(c.operator) && text('value', 'Value')}
          <p className="text-xs text-slate-500">Matching runs the <strong>Yes</strong> branch, otherwise <strong>No</strong>.</p>
        </>
      )}

      {!['condition', 'wait', 'webhook'].includes(step.type) && (
        <p className="text-xs text-slate-500">
          Insert data with placeholders like <code className="rounded bg-slate-100 px-1">{'{{contact.firstName}}'}</code>,{' '}
          <code className="rounded bg-slate-100 px-1">{'{{opportunity.title}}'}</code>.
        </p>
      )}
      <button type="button" className="btn-danger w-full" onClick={onDelete}>
        <Icon name="trash" /> Delete step{step.type === 'condition' ? ' and its branches' : ''}
      </button>
    </fieldset>
  );
}

function PanelHead({ tone, icon, title, hint, actions }: { tone: { chip: string }; icon: string; title: string; hint: string; actions?: React.ReactNode }) {
  return (
    <div className="-mx-4 -mt-4 mb-4 flex items-center gap-3 border-b border-slate-100 px-4 py-3">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone.chip}`}><Icon name={icon} className="h-[18px] w-[18px]" /></span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        <p className="text-[11px] text-slate-500">{hint}</p>
      </div>
      {actions}
    </div>
  );
}

function TestRun({ workflowId, dirty, onDone }: { workflowId: string; dirty: boolean; onDone: (r: WorkflowRun) => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Paged<Contact>>('/crm/contacts?limit=100').then((r) => {
      setContacts(r.items);
      setContactId(r.items[0]?.id ?? '');
    });
  }, []);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          onDone(await api<WorkflowRun>(`/automation/workflows/${workflowId}/trigger`, { method: 'POST', body: { contactId: contactId || undefined } }));
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {dirty && <p className="flex items-start gap-2 rounded-lg border border-amber-200/70 bg-amber-50 px-3 py-2 text-sm text-amber-800"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />You have unsaved changes — the last saved version will run.</p>}
      <div>
        <label className="label" htmlFor="tr-contact">Run for contact</label>
        <select id="tr-contact" className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">— No contact —</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
        </select>
      </div>
      <p className="text-xs text-slate-500">Actions are real: emails/SMS are sent and contacts are updated.</p>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy}>{busy ? 'Running…' : 'Run now'}</button>
      </div>
    </form>
  );
}
