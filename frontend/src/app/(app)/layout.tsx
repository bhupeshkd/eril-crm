'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, timeAgo } from '@/lib/api';
import { startLiveStream, type LiveEvent } from '@/lib/live';
import { Spinner, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BrandMark, useAppBranding } from '@/lib/branding';
import { PlanBanner, planAllows, useSaasStatus } from '@/components/plan-banner';

type NavItem = { href: string; label: string; icon: string; perm: string };

const NAV_GROUPS: Array<{ label: string | null; items: NavItem[] }> = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', perm: 'contacts:read' },
      { href: '/inbox', label: 'Conversations', icon: 'inbox', perm: 'conversations:read' },
      { href: '/calls', label: 'Calls', icon: 'phone', perm: 'conversations:read' },
    ],
  },
  {
    label: 'Customers',
    items: [
      { href: '/contacts', label: 'Contacts', icon: 'contacts', perm: 'contacts:read' },
      { href: '/pipeline', label: 'Opportunities', icon: 'pipeline', perm: 'pipelines:read' },
      { href: '/calendars', label: 'Calendars', icon: 'calendar', perm: 'calendars:read' },
      { href: '/tasks', label: 'Tasks', icon: 'tasks', perm: 'contacts:read' },
    ],
  },
  {
    label: 'Grow',
    items: [
      { href: '/campaigns', label: 'Marketing', icon: 'marketing', perm: 'campaigns:read' },
      { href: '/social', label: 'Social planner', icon: 'send', perm: 'campaigns:read' },
      { href: '/qr-codes', label: 'QR codes', icon: 'qr', perm: 'campaigns:read' },
      { href: '/sites', label: 'Sites & Funnels', icon: 'sites', perm: 'websites:read' },
      { href: '/forms', label: 'Forms & Surveys', icon: 'forms', perm: 'forms:read' },
      { href: '/reputation', label: 'Reputation', icon: 'reputation', perm: 'contacts:read' },
    ],
  },
  {
    label: 'Revenue & members',
    items: [
      { href: '/payments', label: 'Payments', icon: 'payments', perm: 'payments:read' },
      { href: '/courses', label: 'Courses', icon: 'courses', perm: 'courses:read' },
      { href: '/communities', label: 'Communities', icon: 'communities', perm: 'courses:read' },
    ],
  },
  {
    label: 'Operate',
    items: [
      { href: '/workflows', label: 'Automation', icon: 'automation', perm: 'workflows:read' },
      { href: '/reporting', label: 'Reporting', icon: 'reporting', perm: 'analytics:read' },
      { href: '/settings', label: 'Settings', icon: 'settings', perm: 'contacts:read' },
    ],
  },
];

const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** Stable pastel per name, for workspace/user avatars. */
const HUES = ['bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-fuchsia-500'];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, loading, logout, switchWorkspace, can } = useAuth();
  const brand = useAppBranding(me?.currentWorkspaceId);
  const saas = useSaasStatus(me?.currentWorkspaceId);
  const router = useRouter();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [feedOpen, setFeedOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const toast = useToast();
  const [isAgency, setIsAgency] = useState(false);

  useEffect(() => {
    if (!me) return;
    api<unknown[]>('/agency/organizations').then((o) => setIsAgency(o.length > 0)).catch(() => setIsAgency(false));
  }, [me]);

  // Live notifications for the active workspace.
  useEffect(() => {
    if (!me?.currentWorkspaceId) return;
    return startLiveStream((e) => {
      if (!e.title) return;
      setFeed((f) => [e, ...f].slice(0, 30));
      setUnseen((n) => n + 1);
      toast(e.title);
      if (e.type === 'message.received') window.dispatchEvent(new Event('eril:unread-changed'));
    });
  }, [me?.currentWorkspaceId, toast]);

  useEffect(() => {
    if (!loading && !me) router.replace('/login');
  }, [loading, me, router]);

  useEffect(() => {
    if (!me) return;
    const load = () =>
      api('/dashboard/stats')
        .then((s) => setUnread(s.unreadMessages))
        .catch(() => {});
    load();
    const t = setInterval(load, 30000);
    // Pages fire this after reading/sending messages so the badge stays current.
    window.addEventListener('eril:unread-changed', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('eril:unread-changed', load);
    };
  }, [me, pathname]);

  useEffect(() => {
    setMenuOpen(false);
    setFeedOpen(false);
    setWsOpen(false);
  }, [pathname]);

  // ⌘K / Ctrl+K opens the quick-jump palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const groups = useMemo(() => NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => can(n.perm) && planAllows(saas, n.perm)) })).filter((g) => g.items.length), [can, saas]);

  if (loading || !me) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  }

  const current = me.workspaceMemberships.find((m) => m.workspaceId === me.currentWorkspaceId);
  const wsName = current?.workspaceName ?? 'Workspace';
  const pageItems = [...(isAgency ? [{ href: '/agency', label: 'Agency view', icon: 'agency', perm: '' }] : []), ...groups.flatMap((g) => g.items)];
  const activeItem = pageItems.find((n) => pathname === n.href || pathname.startsWith(n.href + '/'));

  const navLink = (n: NavItem, extra?: React.ReactNode) => {
    const active = pathname === n.href || pathname.startsWith(n.href + '/');
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? 'page' : undefined}
        className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium transition-colors ${
          active ? 'bg-white text-slate-900 shadow-card ring-1 ring-slate-200/80' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
        }`}
      >
        <Icon name={n.icon} className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-500'}`} />
        <span className="flex-1 truncate">{n.label}</span>
        {extra}
      </Link>
    );
  };

  const sidebar = (
    <>
      {/* Brand */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <BrandMark b={brand} />
        <span className="truncate text-[15px] font-semibold tracking-tight">{brand.appName}</span>
        <button className="btn-ghost ml-auto h-8 w-8 px-0 md:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu">
          <Icon name="close" />
        </button>
      </div>

      {/* Workspace switcher */}
      <div className="relative px-3 pb-2">
        <button
          type="button"
          onClick={() => setWsOpen(!wsOpen)}
          aria-expanded={wsOpen}
          aria-haspopup="listbox"
          className="flex w-full items-center gap-2.5 rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 text-left shadow-card transition hover:border-slate-300"
        >
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-[11px] font-semibold text-white ${hue(wsName)}`}>{initials(wsName)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight">{wsName}</span>
            <span className="block truncate text-[11px] text-slate-500">{current?.organizationName}</span>
          </span>
          <Icon name="chevronsUpDown" className="h-4 w-4 text-slate-400" />
        </button>
        {wsOpen && (
          <ul role="listbox" aria-label="Switch workspace" className="absolute inset-x-3 top-full z-50 mt-1 max-h-72 animate-pop-in overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-pop">
            {me.workspaceMemberships.map((m) => {
              const selected = m.workspaceId === me.currentWorkspaceId;
              return (
                <li key={m.workspaceId} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] ${selected ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                    onClick={async () => {
                      setWsOpen(false);
                      if (selected) return;
                      await switchWorkspace(m.workspaceId);
                      router.refresh();
                      location.reload();
                    }}
                  >
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold text-white ${hue(m.workspaceName)}`}>{initials(m.workspaceName)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.workspaceName}</span>
                      <span className="block truncate text-[11px] text-slate-500">{m.organizationName}</span>
                    </span>
                    {selected && <Icon name="check" className="h-4 w-4 text-brand-600" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2" aria-label="Main">
        {isAgency && <div>{navLink({ href: '/agency', label: 'Agency view', icon: 'agency', perm: '' })}</div>}
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.label && <div className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</div>}
            <div className="space-y-0.5">
              {g.items.map((n) =>
                navLink(
                  n,
                  n.href === '/inbox' && unread > 0 ? (
                    <span className="rounded-full bg-brand-600 px-1.5 py-px text-[11px] font-semibold tabular-nums text-white">{unread > 99 ? '99+' : unread}</span>
                  ) : undefined,
                ),
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-slate-200/70 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white ${hue(me.name)}`}>{initials(me.name)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight">{me.name}</span>
            <span className="block truncate text-[11px] capitalize text-slate-500">{(current?.role ?? me.role).replace(/_/g, ' ')}</span>
          </span>
          <button
            className="btn-ghost h-8 w-8 px-0"
            title="Sign out"
            aria-label="Sign out"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            <Icon name="logout" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200/70 bg-slate-50/80 md:flex">{sidebar}</aside>
      {/* Mobile drawer */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40 animate-fade-in bg-slate-900/40 backdrop-blur-[2px] md:hidden" onClick={() => setMenuOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 animate-slide-in flex-col bg-slate-50 shadow-pop md:hidden">{sidebar}</aside>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200/70 bg-white/80 px-4 backdrop-blur-md md:px-6">
          <button className="btn-ghost h-9 w-9 px-0 md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <div className="hidden min-w-0 items-center gap-1.5 text-[13px] text-slate-500 sm:flex">
            <span className="truncate">{wsName}</span>
            {activeItem && (
              <>
                <Icon name="chevronRight" className="h-3.5 w-3.5 text-slate-300" />
                <span className="truncate font-medium text-slate-900">{activeItem.label}</span>
              </>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 text-[13px] text-slate-500 transition hover:border-slate-300 hover:bg-white sm:w-64"
              aria-label="Search and jump to a page"
            >
              <Icon name="search" className="h-4 w-4" />
              <span className="hidden flex-1 text-left sm:inline">Search or jump to…</span>
              <span className="hidden items-center gap-0.5 sm:flex"><kbd className="kbd">Ctrl</kbd><kbd className="kbd">K</kbd></span>
            </button>
            <div className="relative">
              <button
                className="btn-ghost relative h-9 w-9 px-0"
                aria-label={`Notifications: ${unseen} new, ${unread} unread messages`}
                aria-expanded={feedOpen}
                onClick={() => {
                  setFeedOpen(!feedOpen);
                  setUnseen(0);
                }}
              >
                <Icon name="bell" className="h-[18px] w-[18px]" />
                {(unseen > 0 || unread > 0) && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />}
              </button>
              {feedOpen && (
                <div className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] animate-pop-in overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop" role="dialog" aria-label="Notifications">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm font-semibold">
                    Activity
                    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative h-2 w-2 rounded-full bg-emerald-500" /></span>
                      Live
                    </span>
                  </div>
                  {unread > 0 && (
                    <Link href="/inbox" className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50/50" onClick={() => setFeedOpen(false)}>
                      {unread} unread message{unread === 1 ? '' : 's'}
                      <Icon name="arrowUpRight" className="h-4 w-4" />
                    </Link>
                  )}
                  {feed.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-slate-500">New leads, bookings, payments and messages appear here as they happen.</p>
                  ) : (
                    <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                      {feed.map((e, i) => (
                        <li key={i}>
                          <Link href={e.href ?? '#'} onClick={() => setFeedOpen(false)} className="block px-4 py-2.5 text-sm hover:bg-slate-50">
                            <div className="text-slate-800">{e.title}</div>
                            <div className="mt-0.5 text-xs text-slate-400">{timeAgo(e.at)}</div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-[1400px]"><PlanBanner status={saas} />{children}</div>
        </main>
      </div>

      {paletteOpen && <CommandPalette items={pageItems} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

/** Quick jump: type to filter pages, ↑/↓ to move, Enter to open. */
function CommandPalette({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive(0), [q]);
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  return (
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-start justify-center bg-slate-900/40 p-4 pt-[15vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Jump to page" className="w-full max-w-lg animate-pop-in overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <Icon name="search" className="h-4 w-4 text-slate-400" />
          <input
            ref={inputRef}
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
            placeholder="Jump to…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && results[active]) go(results[active].href);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No pages match “{q}”.</li>}
          {results.map((r, i) => (
            <li key={r.href} role="option" aria-selected={i === active}>
              <button
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === active ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-50'}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.href)}
              >
                <Icon name={r.icon} className={`h-4 w-4 ${i === active ? 'text-brand-600' : 'text-slate-400'}`} />
                <span className="flex-1">{r.label}</span>
                {i === active && <Icon name="chevronRight" className="h-4 w-4 text-brand-400" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
