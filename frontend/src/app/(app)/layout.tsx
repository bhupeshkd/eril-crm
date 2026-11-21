'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, timeAgo } from '@/lib/api';
import { startLiveStream, type LiveEvent } from '@/lib/live';
import { Modal, Spinner, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BrandMark, useAppBranding } from '@/lib/branding';
import { PlanBanner, planAllows, useSaasStatus } from '@/components/plan-banner';

type NavItem = { href: string; label: string; icon: string; perm: string };

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Menu',
    items: [
      { href: '/dashboard', label: 'Overview', icon: 'dashboard', perm: 'contacts:read' },
      { href: '/inbox', label: 'Conversations', icon: 'inbox', perm: 'conversations:read' },
      { href: '/pipeline', label: 'Pipeline', icon: 'pipeline', perm: 'pipelines:read' },
      { href: '/contacts', label: 'Contacts', icon: 'contacts', perm: 'contacts:read' },
      { href: '/tasks', label: 'Activities', icon: 'tasks', perm: 'contacts:read' },
      { href: '/calendars', label: 'Calendars', icon: 'calendar', perm: 'calendars:read' },
      { href: '/calls', label: 'Calls', icon: 'phone', perm: 'conversations:read' },
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
      { href: '/reporting', label: 'Reports', icon: 'reporting', perm: 'analytics:read' },
    ],
  },
];
const SETTINGS: NavItem = { href: '/settings', label: 'Settings', icon: 'settings', perm: 'contacts:read' };

const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** Soft colour per name, for workspace/user avatars. */
const HUES = ['bg-[#5B9EE1]', 'bg-[#8FB65A]', 'bg-[#E0936F]', 'bg-[#C5A94F]', 'bg-[#9C88D6]', 'bg-[#5FB3A3]', 'bg-[#D5788F]', 'bg-[#7A8C9C]'];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

function readTheme(): 'light' | 'dark' {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
function setTheme(t: 'light' | 'dark') {
  if (t === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('eril.theme', t); } catch { /* storage blocked: still applies for this visit */ }
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, loading, logout, switchWorkspace, can } = useAuth();
  const brand = useAppBranding(me?.currentWorkspaceId);
  const saas = useSaasStatus(me?.currentWorkspaceId);
  const router = useRouter();
  const pathname = usePathname();
  const [counts, setCounts] = useState({ unread: 0, openDeals: 0, openTasks: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [feedOpen, setFeedOpen] = useState(false);
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const toast = useToast();
  const [isAgency, setIsAgency] = useState(false);

  // Frost the header once content scrolls underneath it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setThemeState(readTheme());
    try { setCollapsed(localStorage.getItem('eril.sidebar') === 'collapsed'); } catch { /* ignore */ }
  }, []);

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

  // Counts for the menu badges (unread conversations, open deals, open tasks).
  useEffect(() => {
    if (!me) return;
    const load = () =>
      api('/dashboard/stats')
        .then((s) => setCounts({ unread: s.unreadMessages, openDeals: s.openDeals, openTasks: s.openTasks }))
        .catch(() => {});
    load();
    const t = setInterval(load, 30000);
    window.addEventListener('eril:unread-changed', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('eril:unread-changed', load);
    };
  }, [me, pathname]);

  useEffect(() => {
    setMenuOpen(false);
    setFeedOpen(false);
    setSpacesOpen(false);
    setProfileOpen(false);
    setNewOpen(false);
  }, [pathname]);

  // ⌘K / Ctrl+K opens search.
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
      <div className="app-canvas grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  }

  const current = me.workspaceMemberships.find((m) => m.workspaceId === me.currentWorkspaceId);
  const wsName = current?.workspaceName ?? 'Workspace';
  const pageItems = [...(isAgency ? [{ href: '/agency', label: 'Agency view', icon: 'agency', perm: '' }] : []), ...groups.flatMap((g) => g.items), SETTINGS];
  const activeItem = pageItems.find((n) => pathname === n.href || pathname.startsWith(n.href + '/'));
  const countFor = (href: string) => (href === '/inbox' ? counts.unread : href === '/pipeline' ? counts.openDeals : href === '/tasks' ? counts.openTasks : 0);
  const spaces = [...me.workspaceMemberships].sort((a, b) => (a.workspaceId === me.currentWorkspaceId ? -1 : b.workspaceId === me.currentWorkspaceId ? 1 : 0));
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('eril.sidebar', next ? 'collapsed' : 'open'); } catch { /* ignore */ }
  };
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };
  const switchTo = async (id: string) => {
    setSpacesOpen(false);
    if (id === me.currentWorkspaceId) return;
    await switchWorkspace(id);
    router.refresh();
    location.reload();
  };
  const signOut = async () => {
    await logout();
    router.replace('/login');
  };

  /** Rail contents; `mini` = collapsed icon-only rail on desktop. */
  const rail = (mini: boolean) => {
    const navLink = (n: NavItem) => {
      const active = pathname === n.href || pathname.startsWith(n.href + '/');
      const count = countFor(n.href);
      return (
        <Link
          key={n.href}
          href={n.href}
          title={mini ? n.label : undefined}
          aria-current={active ? 'page' : undefined}
          className={`group relative flex items-center gap-2.5 rounded-full py-[7px] text-[14px] transition-colors ${mini ? 'justify-center px-0' : 'px-3'} ${
            active ? 'bg-[var(--pill)] font-semibold text-ink shadow-[0_1px_2px_rgba(24,26,24,0.06)]' : 'font-medium text-muted hover:bg-[var(--track)] hover:text-ink'
          }`}
        >
          <Icon name={n.icon} className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2 : 1.75} />
          {!mini && <span className="flex-1 truncate">{n.label}</span>}
          {!mini && active && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />}
          {!mini && count > 0 && <span className="chip">{count > 99 ? '99+' : count}</span>}
          {mini && count > 0 && <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />}
        </Link>
      );
    };
    return (
      <>
        {/* Brand */}
        <div className={`flex h-14 shrink-0 items-center gap-2.5 ${mini ? 'justify-center px-2' : 'px-4'}`}>
          {brand.logoUrl ? <BrandMark b={brand} /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent text-sm font-bold text-[#181a18]">{(brand.appName || 'E').charAt(0)}</span>}
          {!mini && <span className="truncate text-[16px] font-bold tracking-tight text-ink">{brand.appName}</span>}
          {!mini && (
            <button className="btn-ghost ml-auto hidden h-8 w-8 px-0 md:inline-flex" onClick={toggleCollapsed} aria-label="Collapse sidebar" title="Collapse sidebar">
              <Icon name="panelRight" className="h-4 w-4 rotate-180" />
            </button>
          )}
          <button className="btn-ghost ml-auto h-8 w-8 px-0 md:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        {mini && (
          <button className="btn-ghost mx-auto mb-1 h-8 w-8 px-0" onClick={toggleCollapsed} aria-label="Expand sidebar" title="Expand sidebar">
            <Icon name="panelRight" className="h-4 w-4" />
          </button>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {/* Spaces (workspaces) */}
          {!mini ? (
            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Spaces
                {spaces.length > 3 && <button className="normal-case tracking-normal hover:text-ink" onClick={() => setSpacesOpen(true)}>All {spaces.length}</button>}
              </div>
              <div className="space-y-1">
                {spaces.slice(0, 3).map((m) => {
                  const active = m.workspaceId === me.currentWorkspaceId;
                  return (
                    <button
                      key={m.workspaceId}
                      onClick={() => switchTo(m.workspaceId)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-2xl px-2 py-1.5 text-left transition ${active ? 'bg-[var(--pill)] shadow-[0_1px_2px_rgba(24,26,24,0.06)]' : 'hover:bg-[var(--track)]'}`}
                    >
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[11px] font-semibold text-white ${hue(m.workspaceName)}`}>{initials(m.workspaceName)}</span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[13px] leading-tight ${active ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{m.workspaceName}</span>
                        <span className="block truncate text-[11px] text-muted">{m.organizationName}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <button onClick={() => setSpacesOpen(true)} title={`${wsName} — switch space`} className={`mx-auto mb-3 grid h-9 w-9 place-items-center rounded-xl text-[11px] font-semibold text-white ${hue(wsName)}`}>{initials(wsName)}</button>
          )}

          {/* Navigation */}
          <nav className="space-y-4" aria-label="Main">
            {isAgency && <div>{navLink({ href: '/agency', label: 'Agency view', icon: 'agency', perm: '' })}</div>}
            {groups.map((g) => (
              <div key={g.label}>
                {!mini && <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{g.label}</div>}
                <div className="space-y-0.5">{g.items.map(navLink)}</div>
              </div>
            ))}
          </nav>
        </div>

        {/* Utilities + profile */}
        <div className="space-y-0.5 border-t border-[var(--glass-line)] p-3">
          {navLink(SETTINGS)}
          <button onClick={() => setHelpOpen(true)} title={mini ? 'Help' : undefined} className={`flex w-full items-center gap-2.5 rounded-full py-[7px] text-[14px] font-medium text-muted transition-colors hover:bg-[var(--track)] hover:text-ink ${mini ? 'justify-center' : 'px-3'}`}>
            <Icon name="note" className="h-[18px] w-[18px]" />
            {!mini && 'Help'}
          </button>
          <button role="switch" aria-checked={theme === 'dark'} onClick={toggleTheme} title={mini ? 'Dark mode' : undefined} className={`flex w-full items-center gap-2.5 rounded-full py-[7px] text-[14px] font-medium text-muted transition-colors hover:bg-[var(--track)] hover:text-ink ${mini ? 'justify-center' : 'px-3'}`}>
            <Icon name="eye" className="h-[18px] w-[18px]" />
            {!mini && <span className="flex-1 text-left">Dark mode</span>}
            {!mini && (
              <span className={`relative h-5 w-9 rounded-full transition ${theme === 'dark' ? 'bg-accent' : 'bg-[var(--chip)]'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${theme === 'dark' ? 'left-[18px]' : 'left-0.5'}`} />
              </span>
            )}
          </button>
          <div className="relative pt-1">
            <button onClick={() => setProfileOpen(!profileOpen)} aria-expanded={profileOpen} className={`flex w-full items-center gap-2.5 rounded-2xl p-1.5 text-left transition hover:bg-[var(--track)] ${mini ? 'justify-center' : ''}`}>
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white ${hue(me.name)}`}>{initials(me.name)}</span>
              {!mini && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold leading-tight text-ink">{me.name}</span>
                    <span className="block truncate text-[11px] capitalize text-muted">{(current?.role ?? me.role).replace(/_/g, ' ')}</span>
                  </span>
                  <Icon name="chevronsUpDown" className="h-4 w-4 text-muted" />
                </>
              )}
            </button>
            {profileOpen && (
              <div className="glass absolute bottom-full left-0 z-50 mb-2 w-56 animate-pop-in rounded-2xl p-1.5 shadow-pop" role="menu">
                <div className="px-3 py-2 text-xs text-muted">{me.email}</div>
                <Link href="/settings" role="menuitem" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink hover:bg-[var(--track)]"><Icon name="settings" className="h-4 w-4" /> Settings</Link>
                <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink hover:bg-[var(--track)]"><Icon name="logout" className="h-4 w-4" /> Sign out</button>
              </div>
            )}
          </div>
        </div>
      </>
    );
  };

  const NEW_ITEMS = [
    { href: '/pipeline?new=1', label: 'Deal', icon: 'pipeline', perm: 'opportunities:write' },
    { href: '/contacts?new=1', label: 'Contact', icon: 'contacts', perm: 'contacts:write' },
    { href: '/tasks?new=1', label: 'Task', icon: 'tasks', perm: 'contacts:write' },
    { href: '/calendars', label: 'Appointment', icon: 'calendar', perm: 'appointments:write' },
    { href: '/payments', label: 'Invoice', icon: 'payments', perm: 'invoices:write' },
  ].filter((n) => can(n.perm));

  return (
    <div className="app-canvas flex min-h-screen">
      {/* Desktop: detached floating rail */}
      <aside
        className={`glass sticky top-3 m-3 hidden h-[calc(100vh-24px)] shrink-0 flex-col rounded-3xl md:flex ${collapsed ? 'w-[72px]' : 'w-[240px]'}`}
        style={{ background: 'var(--glass-sidebar)' }}
      >
        {rail(collapsed)}
      </aside>
      {/* Mobile drawer */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40 animate-fade-in bg-black/30 backdrop-blur-[2px] md:hidden" onClick={() => setMenuOpen(false)} />
          <aside className="glass fixed inset-y-3 left-3 z-50 flex w-[260px] animate-slide-in flex-col rounded-3xl md:hidden" style={{ background: 'var(--glass-sidebar)' }}>
            {rail(false)}
          </aside>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col md:pl-1">
        <header
          className={`sticky top-0 z-30 flex h-16 items-center gap-3 px-4 transition-[background,box-shadow] duration-200 md:px-6 ${scrolled ? 'border-b border-[var(--glass-border)] shadow-[0_8px_24px_-20px_rgba(24,26,24,0.5)]' : ''}`}
          style={scrolled ? { background: 'var(--glass)', backdropFilter: 'blur(20px) saturate(1.1)', WebkitBackdropFilter: 'blur(20px) saturate(1.1)' } : undefined}
        >
          <button className="btn-secondary h-10 w-10 px-0 md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[14px] sm:flex">
            <span className="truncate text-muted">{wsName}</span>
            {activeItem && (
              <>
                <span className="text-muted">/</span>
                <span className="truncate font-semibold text-ink">{activeItem.label}</span>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-10 items-center gap-2 rounded-full border border-[var(--glass-border)] bg-[var(--field)] px-4 text-[13px] text-muted backdrop-blur-md transition hover:bg-[var(--pill)] sm:w-72"
              aria-label="Search deals, people and pages"
            >
              <Icon name="search" className="h-4 w-4" />
              <span className="hidden flex-1 text-left sm:inline">Search deals, people…</span>
              <span className="hidden items-center gap-0.5 sm:flex"><kbd className="kbd">⌘K</kbd></span>
            </button>
            {NEW_ITEMS.length > 0 && (
              <div className="relative">
                <button className="btn-primary h-10 px-4" onClick={() => setNewOpen(!newOpen)} aria-expanded={newOpen} aria-haspopup="menu">
                  <Icon name="plus" className="h-4 w-4" /> <span className="hidden sm:inline">New</span>
                </button>
                {newOpen && (
                  <div className="glass absolute right-0 z-40 mt-2 w-48 animate-pop-in rounded-2xl p-1.5 shadow-pop" role="menu">
                    {NEW_ITEMS.map((n) => (
                      <Link key={n.href} href={n.href} role="menuitem" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink hover:bg-[var(--track)]">
                        <Icon name={n.icon} className="h-4 w-4 text-muted" /> {n.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="relative">
              <button
                className="relative grid h-10 w-10 place-items-center rounded-full border border-[var(--glass-border)] bg-[var(--field)] text-ink backdrop-blur-md transition hover:bg-[var(--pill)]"
                aria-label={`Notifications: ${unseen} new, ${counts.unread} unread messages`}
                aria-expanded={feedOpen}
                onClick={() => {
                  setFeedOpen(!feedOpen);
                  setUnseen(0);
                }}
              >
                <Icon name="bell" className="h-[18px] w-[18px]" />
                {unseen + counts.unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#181a18] px-1 text-[10px] font-semibold text-white num">
                    {Math.min(99, unseen + counts.unread)}
                  </span>
                )}
              </button>
              {feedOpen && (
                <div className="glass absolute right-0 z-40 mt-2 w-80 max-w-[90vw] animate-pop-in overflow-hidden rounded-[22px] shadow-pop" role="dialog" aria-label="Notifications">
                  <div className="flex items-center justify-between px-4 py-3 text-sm font-semibold text-ink">
                    Activity
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
                      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" /><span className="relative h-2 w-2 rounded-full bg-accent" /></span>
                      Live
                    </span>
                  </div>
                  {counts.unread > 0 && (
                    <Link href="/inbox" className="flex items-center justify-between border-t border-[var(--glass-line)] px-4 py-2.5 text-sm font-medium text-ink hover:bg-[var(--track)]" onClick={() => setFeedOpen(false)}>
                      {counts.unread} unread message{counts.unread === 1 ? '' : 's'}
                      <Icon name="arrowUpRight" className="h-4 w-4" />
                    </Link>
                  )}
                  {feed.length === 0 ? (
                    <p className="border-t border-[var(--glass-line)] px-4 py-6 text-center text-sm text-muted">New leads, bookings, payments and messages appear here as they happen.</p>
                  ) : (
                    <ul className="max-h-80 divide-y divide-[var(--glass-line)] overflow-y-auto border-t border-[var(--glass-line)]">
                      {feed.map((e, i) => (
                        <li key={i}>
                          <Link href={e.href ?? '#'} onClick={() => setFeedOpen(false)} className="block px-4 py-2.5 text-sm hover:bg-[var(--track)]">
                            <div className="text-ink">{e.title}</div>
                            <div className="mt-0.5 text-xs text-muted">{timeAgo(e.at)}</div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <Link href="/settings" aria-label="Your settings" className={`hidden h-10 w-10 place-items-center rounded-full text-xs font-semibold text-white sm:grid ${hue(me.name)}`}>{initials(me.name)}</Link>
          </div>
        </header>
        <main className="flex-1 px-4 pb-8 pt-2 md:px-6">
          <div className="mx-auto w-full max-w-[1400px]"><PlanBanner status={saas} />{children}</div>
        </main>
      </div>

      {paletteOpen && <CommandPalette items={pageItems} canDeals={can('opportunities:read')} onClose={() => setPaletteOpen(false)} />}

      {spacesOpen && (
        <Modal open title="Switch space" onClose={() => setSpacesOpen(false)}>
          <ul className="space-y-1">
            {spaces.map((m) => (
              <li key={m.workspaceId}>
                <button onClick={() => switchTo(m.workspaceId)} className={`flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left ${m.workspaceId === me.currentWorkspaceId ? 'bg-[var(--track)]' : 'hover:bg-[var(--track)]'}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-semibold text-white ${hue(m.workspaceName)}`}>{initials(m.workspaceName)}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{m.workspaceName}</span><span className="block truncate text-xs text-muted">{m.organizationName}</span></span>
                  {m.workspaceId === me.currentWorkspaceId && <Icon name="check" className="h-4 w-4" />}
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {helpOpen && (
        <Modal open title="Help" onClose={() => setHelpOpen(false)}>
          <div className="space-y-4 text-sm text-ink">
            <div>
              <div className="mb-1.5 font-semibold">Shortcuts</div>
              <ul className="space-y-1.5 text-muted">
                <li className="flex justify-between"><span>Search deals, people and pages</span><span className="flex gap-1"><kbd className="kbd">Ctrl</kbd><kbd className="kbd">K</kbd></span></li>
                <li className="flex justify-between"><span>Move through search results</span><span className="flex gap-1"><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd></span></li>
              </ul>
            </div>
            <div>
              <div className="mb-1.5 font-semibold">Getting around</div>
              <ul className="list-disc space-y-1 pl-5 text-muted">
                <li><b className="text-ink">Overview</b> shows this month&apos;s results and what to do today.</li>
                <li><b className="text-ink">Pipeline</b> is your deal board: drag deals between stages.</li>
                <li><b className="text-ink">+ New</b> (top right) adds a deal, contact, task and more.</li>
                <li>Set your monthly revenue target from the Overview&apos;s first card.</li>
              </ul>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

type Hit = { kind: 'page' | 'contact' | 'deal'; key: string; label: string; sub?: string; href: string; icon: string };

/** Search: pages instantly, plus people and deals from the API as you type. ↑/↓ to move, Enter to open. */
function CommandPalette({ items, canDeals, onClose }: { items: NavItem[]; canDeals: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<Hit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const pages: Hit[] = items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase())).map((i) => ({ kind: 'page', key: i.href, label: i.label, href: i.href, icon: i.icon }));
  const results = [...(q.trim() ? remote : []), ...pages];
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive(0), [q, remote.length]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRemote([]); return; }
    let stale = false;
    const t = setTimeout(async () => {
      const [people, deals] = await Promise.all([
        api<any>(`/crm/contacts?search=${encodeURIComponent(term)}&limit=5`).then((r) => (r.items ?? r) as any[]).catch(() => []),
        canDeals ? api<any[]>(`/sales/opportunities?q=${encodeURIComponent(term)}`).catch(() => []) : Promise.resolve([]),
      ]);
      if (stale) return;
      setRemote([
        ...people.slice(0, 5).map((c) => ({ kind: 'contact' as const, key: `c-${c.id}`, label: `${c.firstName} ${c.lastName ?? ''}`.trim(), sub: c.email || c.phone || 'Contact', href: `/contacts/${c.id}`, icon: 'contacts' })),
        ...deals.map((d) => ({ kind: 'deal' as const, key: `d-${d.id}`, label: d.title, sub: `${d.stage}${d.contact ? ` · ${d.contact}` : ''}`, href: `/pipeline?deal=${d.id}`, icon: 'pipeline' })),
      ]);
    }, 200);
    return () => { stale = true; clearTimeout(t); };
  }, [q, canDeals]);
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  return (
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-start justify-center bg-black/25 p-4 pt-[15vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="glass w-full max-w-lg animate-pop-in overflow-hidden rounded-[22px] shadow-pop">
        <div className="flex items-center gap-3 border-b border-[var(--glass-line)] px-4">
          <Icon name="search" className="h-4 w-4 text-muted" />
          <input
            ref={inputRef}
            className="h-12 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
            placeholder="Search deals, people, pages…"
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
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{q}”.</li>}
          {results.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === active}>
              <button
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm ${i === active ? 'bg-[var(--pill)] text-ink' : 'text-ink hover:bg-[var(--track)]'}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.href)}
              >
                <Icon name={r.icon} className="h-4 w-4 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.label}</span>
                  {r.sub && <span className="block truncate text-xs text-muted">{r.sub}</span>}
                </span>
                <span className="text-[11px] capitalize text-muted">{r.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
