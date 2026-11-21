'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact, Paged } from '@/lib/types';
import { BarList } from '@/components/charts';
import { EmptyState, Modal, PageHeader, PageLoader, Segmented, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ContactAvatar } from '@/components/contact-avatar';

interface Summary { count: number; average: number; positive: number; distribution: Record<string, number>; requestsSent: number; responseRate: number | null }
interface Review { id: string; rating: number; comment: string; isPublic: boolean; reply: string | null; createdAt: string; contact: Contact | null }
interface Settings { publicReviewUrl?: string; minPublicRating?: number; autoPublishMinRating?: number | null }
type Filter = 'all' | 'positive' | 'critical' | 'public';

const STAR = 'm12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z';

function Stars({ n, size = 'h-4 w-4' }: { n: number; size?: string }) {
  return (
    <span role="img" aria-label={`${n} out of 5 stars`} className="inline-flex shrink-0 gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} aria-hidden viewBox="0 0 24 24" className={`${size} ${i <= n ? 'fill-amber-400' : 'fill-slate-200'}`}>
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}

export default function ReputationPage() {
  const toast = useToast();
  const { can } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(() => {
    api<Summary>('/reputation/summary').then(setSummary).catch(() => {});
    api<Review[]>('/reputation/reviews').then(setReviews).catch((e) => toast(errorText(e), 'error'));
    api<Settings>('/reputation/settings').then(setSettings).catch(() => {});
  }, [toast]);
  useEffect(load, [load]);

  async function togglePublic(r: Review) {
    try {
      await api(`/reputation/reviews/${r.id}`, { method: 'PUT', body: { isPublic: !r.isPublic } });
      toast(r.isPublic ? 'Hidden from websites' : 'Shown on websites');
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const list = reviews ?? [];
  const match = (r: Review, f: Filter) => f === 'all' || (f === 'public' ? r.isPublic : f === 'positive' ? r.rating >= 4 : r.rating <= 3);
  const shown = list.filter((r) => match(r, filter));

  return (
    <>
      <PageHeader
        title="Reputation"
        subtitle="Ask happy customers for reviews and catch unhappy ones privately"
        actions={
          <>
            {can('workspaces:write') && <button className="btn-secondary" onClick={() => setShowSettings(true)}><Icon name="settings" /> Settings</button>}
            {can('conversations:write') && <button className="btn-primary" onClick={() => setRequesting(true)}><Icon name="send" /> Request review</button>}
          </>
        }
      />
      {settings && !settings.publicReviewUrl && (
        <p className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Add your public review link (e.g. your Google Business review URL) in Settings so customers who rate you {settings.minPublicRating ?? 4}★+ are sent there.</span>
        </p>
      )}
      {summary && (
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <div className="card relative overflow-hidden p-5">
            <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-amber-100/80 blur-2xl" aria-hidden />
            <div className="relative text-[13px] font-medium text-slate-500">Average rating</div>
            <div className="relative mt-1 flex items-center gap-3">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">{summary.count ? summary.average.toFixed(1) : '—'}</span>
              <Stars n={Math.round(summary.average)} size="h-5 w-5" />
            </div>
            <div className="relative mt-2 text-xs text-slate-500">
              {summary.count} review{summary.count === 1 ? '' : 's'} · <span className="text-emerald-600">{summary.positive} positive</span>
            </div>
          </div>
          <div className="card p-5">
            <div className="text-[13px] font-medium text-slate-500">Requests sent</div>
            <div className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{summary.requestsSent}</div>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${summary.responseRate ?? 0}%` }} /></div>
              <span className="text-xs text-slate-500">{summary.responseRate === null ? 'No requests yet' : `${summary.responseRate}% responded`}</span>
            </div>
          </div>
          <div className="card p-5">
            <div className="mb-2 text-[13px] font-medium text-slate-500">Rating breakdown</div>
            <BarList ariaLabel="Reviews by star rating" data={[5, 4, 3, 2, 1].map((n) => ({ label: `${n}★`, value: summary.distribution[n] ?? 0 }))} />
          </div>
        </div>
      )}
      {!reviews ? <PageLoader /> : reviews.length === 0 ? (
        <EmptyState title="No reviews yet">Send a review request from a contact, or add a “Request review” step to a workflow (e.g. after an appointment shows).</EmptyState>
      ) : (
        <>
          <Segmented<Filter>
            label="Filter reviews"
            className="mb-4"
            value={filter}
            onChange={setFilter}
            options={[
              ['all', 'All', list.length],
              ['positive', 'Positive', list.filter((r) => match(r, 'positive')).length],
              ['critical', 'Needs attention', list.filter((r) => match(r, 'critical')).length],
              ['public', 'On websites', list.filter((r) => match(r, 'public')).length],
            ]}
          />
          <ul className="grid gap-3 lg:grid-cols-2">
            {shown.map((r) => (
              <li key={r.id} className={`card flex flex-col p-4 ${r.rating <= 2 ? 'border-l-[3px] border-l-rose-400' : ''}`}>
                <div className="flex items-center gap-3">
                  {r.contact ? <ContactAvatar c={r.contact} /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon name="contacts" /></span>}
                  <div className="min-w-0 flex-1">
                    {r.contact ? (
                      <Link href={`/contacts/${r.contact.id}`} className="block truncate font-medium hover:text-brand-600">{r.contact.firstName} {r.contact.lastName}</Link>
                    ) : (
                      <span className="block font-medium">Customer</span>
                    )}
                    <span className="text-xs text-slate-400">{fmtDate(r.createdAt)}</span>
                  </div>
                  <Stars n={r.rating} />
                </div>
                {r.comment ? <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-700">“{r.comment}”</p> : <p className="mt-3 flex-1 text-sm italic text-slate-400">No written comment</p>}
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className={`badge ${r.isPublic ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-slate-100 text-slate-600'}`}>
                    <Icon name={r.isPublic ? 'sites' : 'lock'} className="h-3 w-3" />
                    {r.isPublic ? 'On websites' : 'Private'}
                  </span>
                  {can('contacts:write') && <button className="btn-ghost h-7 px-2 text-xs" onClick={() => togglePublic(r)}>{r.isPublic ? 'Hide from websites' : 'Show on websites'}</button>}
                </div>
              </li>
            ))}
            {shown.length === 0 && <li className="col-span-full py-10 text-center text-sm text-slate-500">No reviews in this view.</li>}
          </ul>
        </>
      )}

      <Modal open={requesting} title="Request a review" onClose={() => setRequesting(false)}>
        {requesting && <RequestForm onDone={() => { setRequesting(false); toast('Review request sent'); load(); }} />}
      </Modal>
      <Modal open={showSettings} title="Reputation settings" onClose={() => setShowSettings(false)}>
        {showSettings && settings && <SettingsForm settings={settings} onDone={() => { setShowSettings(false); toast('Settings saved'); load(); }} />}
      </Modal>
    </>
  );
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Paged<Contact>>('/crm/contacts?limit=100').then((r) => setContacts(r.items)).catch(() => {});
  }, []);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api('/reputation/requests', { method: 'POST', body: { contactId, channel } });
          onDone();
        } catch (err) {
          setError(errorText(err));
          setBusy(false);
        }
      }}
    >
      <div>
        <label className="label" htmlFor="rr-c">Customer</label>
        <select id="rr-c" required className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">Choose…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.email ? ` · ${c.email}` : ''}</option>)}
        </select>
      </div>
      <div>
        <span className="label">Send via</span>
        <Segmented<'email' | 'sms'> label="Channel" value={channel} onChange={setChannel} options={[['email', 'Email'], ['sms', 'SMS']]} />
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end border-t border-slate-100 pt-4"><button className="btn-primary" disabled={busy}><Icon name="send" /> {busy ? 'Sending…' : 'Send request'}</button></div>
    </form>
  );
}

function SettingsForm({ settings, onDone }: { settings: Settings; onDone: () => void }) {
  const [url, setUrl] = useState(settings.publicReviewUrl ?? '');
  const [min, setMin] = useState(settings.minPublicRating ?? 4);
  const [auto, setAuto] = useState<number | ''>(settings.autoPublishMinRating ?? '');
  const [error, setError] = useState('');
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api('/reputation/settings', { method: 'PUT', body: { publicReviewUrl: url, minPublicRating: min, autoPublishMinRating: auto === '' ? null : auto } });
          onDone();
        } catch (err) {
          setError(errorText(err));
        }
      }}
    >
      <div>
        <label className="label" htmlFor="rs-url">Public review link</label>
        <input id="rs-url" type="url" className="input" placeholder="https://g.page/r/…/review" value={url} onChange={(e) => setUrl(e.target.value)} />
        <p className="mt-1.5 text-xs text-slate-500">Customers who rate at or above the threshold are invited to post publicly here.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="rs-min">Send to public link at</label>
          <select id="rs-min" className="input" value={min} onChange={(e) => setMin(Number(e.target.value))}>{[5, 4, 3].map((n) => <option key={n} value={n}>{n}★ and above</option>)}</select>
        </div>
        <div>
          <label className="label" htmlFor="rs-auto">Auto-show on your websites</label>
          <select id="rs-auto" className="input" value={auto} onChange={(e) => setAuto(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Never (approve manually)</option>
            {[5, 4].map((n) => <option key={n} value={n}>{n}★ and above</option>)}
          </select>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end border-t border-slate-100 pt-4"><button className="btn-primary">Save settings</button></div>
    </form>
  );
}
