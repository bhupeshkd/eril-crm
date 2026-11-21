'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL, api, download, tokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EmptyState, Modal, PageHeader, PageLoader, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BarList, ColumnChart } from '@/components/charts';

type Ec = 'L' | 'M' | 'Q' | 'H';
interface Qr { id: string; name: string; code: string; destination: string; utm: boolean; isActive: boolean; color: string; ecLevel: Ec; scans: number; lastScannedAt: string | null; scanUrl: string; createdAt: string }
interface Stats { total: number; lastScannedAt: string | null; days: Array<{ day: string; scans: number }>; devices: Array<{ device: string; scans: number }> }

/** Fetches the code's SVG with auth and returns an object URL for <img>. */
function useQrImage(q: Qr) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let url = '';
    fetch(`${API_URL}/qr-codes/${q.id}/svg`, { headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => { url = URL.createObjectURL(b); setSrc(url); })
      .catch(() => setSrc(''));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [q.id, q.color, q.ecLevel]);
  return src;
}

/** Renders the SVG onto a canvas and saves a high-resolution PNG. */
async function savePng(src: string, name: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const size = 1200;
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, size, size);
  const a = Object.assign(document.createElement('a'), { href: c.toDataURL('image/png'), download: `${name.replace(/[^\w.-]+/g, '-') || 'qr-code'}.png` });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function QrCodesPage() {
  const toast = useToast();
  const { can } = useAuth();
  const editable = can('campaigns:write');
  const [codes, setCodes] = useState<Qr[] | null>(null);
  const [editing, setEditing] = useState<Qr | 'new' | null>(null);
  const [stats, setStats] = useState<Qr | null>(null);

  const load = useCallback(() => {
    api<Qr[]>('/qr-codes').then(setCodes).catch((e) => toast(errorText(e), 'error'));
  }, [toast]);
  useEffect(load, [load]);

  async function toggle(q: Qr) {
    try {
      await api(`/qr-codes/${q.id}`, { method: 'PUT', body: { isActive: !q.isActive } });
      toast(q.isActive ? 'QR code paused — scans show a "no longer active" page' : 'QR code active again');
      load();
    } catch (e) { toast(errorText(e), 'error'); }
  }
  async function remove(q: Qr) {
    if (!confirm(`Delete "${q.name}"? Printed copies will stop working, and its scan history is removed.`)) return;
    try {
      await api(`/qr-codes/${q.id}`, { method: 'DELETE' });
      toast('QR code deleted');
      load();
    } catch (e) { toast(errorText(e), 'error'); }
  }

  if (!codes) return <PageLoader />;
  const total = codes.reduce((t, q) => t + q.scans, 0);

  return (
    <div>
      <PageHeader
        title="QR codes"
        subtitle={codes.length ? `${codes.length} code${codes.length === 1 ? '' : 's'} · ${total.toLocaleString()} scans` : 'Print once, change the destination any time, and count every scan'}
        actions={editable && <button className="btn-primary" onClick={() => setEditing('new')}><Icon name="plus" /> New QR code</button>}
      />
      {codes.length === 0 ? (
        <div className="card"><EmptyState title="No QR codes yet">Create a code for a flyer, menu, sign or business card. It points to a short link, so you can change where it goes later without reprinting.</EmptyState></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {codes.map((q) => <QrCard key={q.id} q={q} editable={editable} onEdit={() => setEditing(q)} onStats={() => setStats(q)} onToggle={() => toggle(q)} onDelete={() => remove(q)} />)}
        </div>
      )}
      {editing && <QrEditor q={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); toast(m); load(); }} />}
      {stats && <QrStats q={stats} onClose={() => setStats(null)} />}
    </div>
  );
}

function QrCard({ q, editable, onEdit, onStats, onToggle, onDelete }: { q: Qr; editable: boolean; onEdit: () => void; onStats: () => void; onToggle: () => void; onDelete: () => void }) {
  const toast = useToast();
  const src = useQrImage(q);
  const host = (() => { try { return new URL(q.destination).host; } catch { return q.destination; } })();
  return (
    <div className={`card card-hover flex flex-col p-4 ${q.isActive ? '' : 'opacity-70'}`}>
      <div className="flex gap-4">
        <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
          {src ? <img src={src} alt={`QR code for ${q.name}`} className="h-full w-full" /> : <Icon name="qr" className="h-8 w-8 text-slate-300" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-semibold">{q.name}</h3>
            {!q.isActive && <span className="badge bg-slate-100 text-slate-500">paused</span>}
          </div>
          <a href={q.destination} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-xs text-brand-700 hover:underline" title={q.destination}>{host}</a>
          <div className="mt-3 text-2xl font-semibold tabular-nums">{q.scans.toLocaleString()}</div>
          <div className="text-xs text-slate-500">scans{q.lastScannedAt ? ` · last ${new Date(q.lastScannedAt).toLocaleDateString()}` : ''}</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1 border-t border-slate-100 pt-3">
        <button className="btn-ghost h-8 px-2 text-xs" onClick={() => download(`/qr-codes/${q.id}/svg?download=1`, `${q.name}.svg`).catch((e) => toast(errorText(e), 'error'))}>SVG</button>
        <button className="btn-ghost h-8 px-2 text-xs" disabled={!src} onClick={() => savePng(src, q.name).catch(() => toast('PNG export failed', 'error'))}>PNG</button>
        <button className="btn-ghost h-8 px-2 text-xs" onClick={() => navigator.clipboard.writeText(q.scanUrl).then(() => toast('Scan link copied'))}><Icon name="copy" className="h-3.5 w-3.5" /> Link</button>
        <button className="btn-ghost h-8 px-2 text-xs" onClick={onStats}><Icon name="trendUp" className="h-3.5 w-3.5" /> Stats</button>
        {editable && (
          <span className="ml-auto flex gap-1">
            <button className="btn-ghost h-8 px-2" aria-label={`Edit ${q.name}`} onClick={onEdit}><Icon name="pencil" className="h-3.5 w-3.5" /></button>
            <button className="btn-ghost h-8 px-2 text-xs" onClick={onToggle}>{q.isActive ? 'Pause' : 'Resume'}</button>
            <button className="btn-ghost h-8 px-2 text-rose-600" aria-label={`Delete ${q.name}`} onClick={onDelete}><Icon name="trash" className="h-3.5 w-3.5" /></button>
          </span>
        )}
      </div>
    </div>
  );
}

function QrEditor({ q, onClose, onSaved }: { q: Qr | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: q?.name ?? '', destination: q?.destination ?? '', utm: q?.utm ?? true, color: q?.color ?? '#000000', ecLevel: q?.ecLevel ?? ('M' as Ec) });
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<Array<{ label: string; url: string }>>([]);

  // Quick picks: this workspace's own pages.
  useEffect(() => {
    const origin = window.location.origin;
    const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    Promise.all([
      safe(api<Array<{ name: string; slug: string; isPublished: boolean }>>('/sites')),
      safe(api<Array<{ name: string; slug: string }>>('/forms')),
      safe(api<Array<{ name: string; slug: string }>>('/calendars')),
    ]).then(([sites, forms, cals]) =>
      setLinks([
        ...sites.filter((s) => s.isPublished).map((s) => ({ label: `Site · ${s.name}`, url: `${origin}/s/${s.slug}` })),
        ...forms.map((x) => ({ label: `Form · ${x.name}`, url: `${origin}/f/${x.slug}` })),
        ...cals.map((x) => ({ label: `Booking · ${x.name}`, url: `${origin}/book/${x.slug}` })),
      ]),
    );
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(q ? `/qr-codes/${q.id}` : '/qr-codes', { method: q ? 'PUT' : 'POST', body: f });
      onSaved(q ? 'QR code saved — printed copies now go to the new destination' : 'QR code created');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={q ? `Edit ${q.name}` : 'New QR code'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="qr-name">Name</label>
          <input id="qr-name" required maxLength={120} className="input" placeholder="Spring flyer" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="qr-dest">Destination</label>
          <input id="qr-dest" required type="url" maxLength={2000} className="input" placeholder="https://…" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value.trim() })} />
          {links.length > 0 && (
            <select aria-label="Pick one of your pages" className="input mt-2 text-sm" value="" onChange={(e) => e.target.value && setF({ ...f, destination: e.target.value })}>
              <option value="">Or pick one of your pages…</option>
              {links.map((l) => <option key={l.url} value={l.url}>{l.label}</option>)}
            </select>
          )}
          {q && <p className="mt-1 text-xs text-slate-500">Changing this updates where printed copies go — the code itself stays the same.</p>}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.utm} onChange={(e) => setF({ ...f, utm: e.target.checked })} /> Add UTM tags (utm_source=qr) so scans show up in analytics</label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="qr-color">Colour</label>
            <div className="flex items-center gap-2">
              <input id="qr-color" type="color" className="h-9 w-12 cursor-pointer rounded border border-slate-200" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
              <span className="text-xs text-slate-500">Keep it dark for reliable scanning</span>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="qr-ec">Damage tolerance</label>
            <select id="qr-ec" className="input" value={f.ecLevel} onChange={(e) => setF({ ...f, ecLevel: e.target.value as Ec })}>
              <option value="L">Low (7%) · smallest</option>
              <option value="M">Medium (15%)</option>
              <option value="Q">High (25%)</option>
              <option value="H">Highest (30%) · for logos/outdoor</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{q ? 'Save' : 'Create'}</button></div>
      </form>
    </Modal>
  );
}

function QrStats({ q, onClose }: { q: Qr; onClose: () => void }) {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => { api<Stats>(`/qr-codes/${q.id}/stats`).then(setS).catch(() => {}); }, [q.id]);
  const label: Record<string, string> = { ios: 'iPhone / iPad', android: 'Android', desktop: 'Computer', other: 'Other' };
  return (
    <Modal open wide title={`${q.name} · scans`} onClose={onClose}>
      {!s ? <div className="h-48" /> : (
        <div className="space-y-5">
          <div className="flex gap-6 text-sm">
            <div><div className="text-2xl font-semibold tabular-nums">{s.total.toLocaleString()}</div><div className="text-slate-500">all-time scans</div></div>
            <div><div className="text-2xl font-semibold tabular-nums">{s.days.reduce((t, d) => t + d.scans, 0).toLocaleString()}</div><div className="text-slate-500">last 30 days</div></div>
          </div>
          <ColumnChart ariaLabel="Scans per day, last 30 days" data={s.days.map((d) => ({ label: d.day, value: d.scans }))} height={180} />
          {s.devices.length > 0 && <BarList ariaLabel="Scans by device" data={s.devices.map((d) => ({ label: label[d.device] ?? d.device, value: d.scans }))} />}
        </div>
      )}
    </Modal>
  );
}
