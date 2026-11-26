'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CustomField } from '@/lib/types-ext';
import { PageHeader, Spinner, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { DeveloperSettings } from '@/components/developer-settings';
import { TrackingSettings } from '@/components/tracking-settings';
import { TeamSettings } from '@/components/team-settings';
import { AssistantSettings } from '@/components/assistant-settings';
import { PushSettings } from '@/components/push-settings';
import { PlanUsageCard } from '@/components/plan-banner';
import { ChatWidgetSettings } from '@/components/chat-widget-settings';
import { PhoneSettings } from '@/components/phone-settings';
import { MetaSettings } from '@/components/meta-settings';

const TYPES: CustomField['type'][] = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'];

export default function SettingsPage() {
  const toast = useToast();
  const { me, can } = useAuth();
  const [fields, setFields] = useState<CustomField[] | null>(null);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomField['type']>('text');
  const [options, setOptions] = useState('');

  const load = useCallback(() => api<CustomField[]>('/crm/custom-fields').then(setFields).catch((e) => toast(errorText(e), 'error')), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const current = me?.workspaceMemberships.find((m) => m.workspaceId === me.currentWorkspaceId);

  async function remove(f: CustomField) {
    if (!confirm(`Delete field "${f.label}"? Existing values stay on contacts.`)) return;
    try {
      await api(`/crm/custom-fields/${f.id}`, { method: 'DELETE' });
      toast('Field deleted');
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" subtitle="Your workspace, contact data and integrations" />

      <section className="card mb-6 overflow-hidden">
        <div className="flex items-center gap-4 border-b border-slate-100 bg-gradient-to-r from-brand-50/80 via-white to-white px-5 py-4">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-semibold text-white shadow-sm shadow-brand-600/30">
            {(current?.workspaceName ?? '?').charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{current?.workspaceName}</h2>
            <p className="truncate text-[13px] text-slate-500">{current?.organizationName}</p>
          </div>
        </div>
        <dl className="grid gap-px bg-slate-100 text-sm sm:grid-cols-3">
          {[
            ['Organization', current?.organizationName],
            ['Workspace (sub-account)', current?.workspaceName],
            ['Your role', current?.role.replace(/_/g, ' ')],
          ].map(([k, v]) => (
            <div key={k} className="bg-white px-5 py-3.5">
              <dt className="text-[12px] text-slate-500">{k}</dt>
              <dd className="mt-0.5 font-medium first-letter:uppercase">{v ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </section>

      <PlanUsageCard workspaceId={me?.currentWorkspaceId} />
      <TeamSettings />
      <PushSettings />
      <AssistantSettings />
      <ChatWidgetSettings />
      <PhoneSettings />
      <MetaSettings />

      <section className="card mb-6">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">Custom fields</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Extra data you track on every contact. Forms can save answers into these fields and workflows can use them as{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] text-slate-700">{'{{contact.customFields.key}}'}</code>.
          </p>
        </div>
        {can('contacts:write') && (
          <form
            className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api('/crm/custom-fields', { method: 'POST', body: { label, type, options: type === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : [] } });
                setLabel('');
                setOptions('');
                toast('Field added');
                load();
              } catch (err) {
                toast(errorText(err), 'error');
              }
            }}
          >
            <div className="min-w-[10rem] flex-1"><label className="label" htmlFor="cf-label">Label</label><input id="cf-label" required className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Budget" /></div>
            <div><label className="label" htmlFor="cf-type">Type</label><select id="cf-type" className="input capitalize" value={type} onChange={(e) => setType(e.target.value as CustomField['type'])}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            {type === 'select' && <div className="min-w-[12rem] flex-1"><label className="label" htmlFor="cf-opts">Options (comma separated)</label><input id="cf-opts" required className="input" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Small, Medium, Large" /></div>}
            <button className="btn-primary"><Icon name="plus" /> Add field</button>
          </form>
        )}
        {!fields ? (
          <div className="grid h-24 place-items-center"><Spinner /></div>
        ) : fields.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">No custom fields yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-2.5 font-medium">Label</th><th className="px-5 py-2.5 font-medium">Key</th><th className="px-5 py-2.5 font-medium">Type</th><th className="px-5 py-2.5"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fields.map((f) => (
                <tr key={f.id} className="group hover:bg-slate-50/70">
                  <td className="px-5 py-3 font-medium">{f.label}</td>
                  <td className="px-5 py-3"><code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600">{f.key}</code></td>
                  <td className="px-5 py-3">
                    <span className="badge bg-slate-100 capitalize text-slate-600">{f.type}</span>
                    {f.options.length > 0 && <span className="ml-2 text-xs text-slate-500">{f.options.join(', ')}</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {can('contacts:write') && (
                      <button className="btn-ghost h-8 w-8 px-0 text-slate-400 opacity-0 hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Delete field ${f.label}`} onClick={() => remove(f)}>
                        <Icon name="trash" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <TrackingSettings />
      <DeveloperSettings />
    </div>
  );
}
