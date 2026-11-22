'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { BACKDROP_PRESETS, DEFAULT_APPEARANCE, NAV_ALWAYS_VISIBLE, UI_FONTS, UI_THEMES, applyTheme, type Appearance } from '@eril/shared';
import { useAuth } from '@/lib/auth';
import { appearanceCss, loadFont, useUi } from '@/lib/appearance';
import { NAV_GROUPS } from '@/lib/nav';
import { PageHeader, Segmented, Spinner, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ColorField, Slider } from '@/components/color-field';

type Section = 'themes' | 'colors' | 'surfaces' | 'type' | 'layout' | 'menu';
const SECTIONS: Array<readonly [Section, string]> = [
  ['themes', 'Themes'],
  ['colors', 'Colours & gradients'],
  ['surfaces', 'Cards & surfaces'],
  ['type', 'Typography'],
  ['layout', 'Layout'],
  ['menu', 'Menu'],
];

/** Small swatch of a theme: its backdrop with the accent on top. */
function ThemeSwatch({ a }: { a: Appearance }) {
  const { vars } = appearanceCss(a, a.mode === 'dark');
  const bg = vars['--backdrop'] ?? 'radial-gradient(60% 55% at 12% 18%, #d6c4a0, transparent 70%), radial-gradient(45% 50% at 88% 12%, #b0c4a0, transparent 70%), radial-gradient(55% 60% at 78% 82%, #deb296, transparent 72%), #d9d4c8';
  return (
    <span className="relative block h-20 overflow-hidden rounded-2xl" style={{ background: bg }}>
      <span className="absolute inset-x-3 bottom-3 flex items-center gap-1.5 rounded-xl p-1.5" style={{ background: a.mode === 'dark' ? 'rgba(24,26,24,.8)' : 'rgba(255,255,255,.75)' }}>
        <span className="h-4 w-10 rounded-full" style={{ background: vars['--accent-fill'] }} />
        <span className="h-2 flex-1 rounded-full" style={{ background: a.chart, opacity: 0.6 }} />
      </span>
    </span>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export default function AppearancePage() {
  const ui = useUi();
  const { can } = useAuth();
  const toast = useToast();
  const [a, setA] = useState<Appearance | null>(null);
  const [section, setSection] = useState<Section>('themes');
  const [busy, setBusy] = useState(false);

  // Start from what is saved; leaving the page drops an unsaved preview.
  useEffect(() => {
    if (ui.prefs && !a) setA(ui.prefs.appearance);
  }, [ui.prefs, a]);
  useEffect(() => () => ui.preview(null), [ui.preview]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (section === 'type') UI_FONTS.forEach(loadFont);
  }, [section]);

  const saved = ui.prefs?.appearance;
  const dirty = useMemo(() => !!a && !!saved && JSON.stringify(a) !== JSON.stringify(saved), [a, saved]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (!a || !ui.prefs) return <div className="grid h-64 place-items-center"><Spinner /></div>;

  const set = (next: Appearance) => {
    setA(next);
    ui.preview(next);
  };
  /** Change one nested group (surface, backdrop…) and mark the look as custom. */
  const up = <K extends keyof Appearance>(k: K, v: Appearance[K] extends object ? Partial<Appearance[K]> : Appearance[K]) =>
    set({ ...a, preset: 'custom', [k]: typeof v === 'object' && v !== null && !Array.isArray(v) ? { ...(a[k] as object), ...v } : v });

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => ui.saveAppearance(a), 'Appearance saved to your profile');
  const discard = () => {
    setA(saved!);
    ui.preview(null);
  };
  const resetAll = () =>
    run(async () => {
      await ui.resetAppearance();
      setA(null); // re-seeded from the reloaded prefs
    }, ui.prefs!.teamAppearance ? 'Back to the team look' : 'Back to the original look');

  const src = ui.prefs.appearanceSource;
  const order = a.nav.order;
  const flat = NAV_GROUPS.map((g) => ({
    ...g,
    items: [...g.items].sort((x, y) => (order.indexOf(x.href) + 1 || 999) - (order.indexOf(y.href) + 1 || 999)),
  }));
  const moveNav = (groupIdx: number, idx: number, dir: -1 | 1) => {
    const items = flat[groupIdx].items.map((i) => i.href);
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    [items[idx], items[j]] = [items[j], items[idx]];
    // Store the full order (every group), so positions stay put.
    const all = flat.flatMap((g, gi) => (gi === groupIdx ? items : g.items.map((i) => i.href)));
    up('nav', { order: all });
  };
  const toggleHidden = (href: string) => up('nav', { hidden: a.nav.hidden.includes(href) ? a.nav.hidden.filter((h) => h !== href) : [...a.nav.hidden, href] });

  const b = a.backdrop;

  return (
    <div className="pb-24">
      <PageHeader
        title="Customize"
        subtitle="Make the whole app yours. Changes preview live everywhere and are saved to your profile in this workspace."
        actions={
          <>
            <Link href="/dashboard?customize=1" className="btn-secondary"><Icon name="dashboard" className="h-4 w-4" /> Arrange Overview</Link>
            {src === 'own' && <button className="btn-ghost" disabled={busy} onClick={resetAll}>Reset to {ui.prefs.teamAppearance ? 'team look' : 'original'}</button>}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <span className="chip px-2.5">{src === 'own' ? 'Your own look' : src === 'team' ? 'Using the team look' : 'Original look'}</span>
        {a.preset !== 'custom' && <span>Theme: <b className="text-ink">{UI_THEMES.find((t) => t.id === a.preset)?.name ?? a.preset}</b></span>}
      </div>

      <Segmented label="Customize section" value={section} onChange={setSection} options={SECTIONS} className="mb-5" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {section === 'themes' && (
            <Group title="Themes" hint="One click sets colours, gradients and surfaces. Fine-tune anything afterwards; your menu and fonts are kept.">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {UI_THEMES.map((t) => {
                  const preview = applyTheme(a, t.id);
                  const active = a.preset === t.id;
                  return (
                    <button key={t.id} type="button" aria-pressed={active} onClick={() => set(preview)} className={`rounded-[18px] border p-1.5 text-left transition hover:-translate-y-px ${active ? 'border-[var(--ink)] ring-2 ring-[var(--accent)]' : 'border-[var(--glass-line)]'}`}>
                      <ThemeSwatch a={preview} />
                      <span className="flex items-center justify-between px-1.5 py-1.5 text-[13px] font-semibold text-ink">
                        {t.name}
                        {active && <Icon name="check" className="h-4 w-4" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Group>
          )}

          {section === 'colors' && (
            <>
              <Group title="Accent" hint="Buttons, active menu items, highlights and focus rings. Add a second colour for a gradient.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <ColorField label="Accent colour" value={a.accent} onChange={(c) => up('accent', c)} />
                  <ColorField label="Gradient to" value={a.accentEnd} onChange={(c) => up('accentEnd', c)} onClear={() => up('accentEnd', null)} clearLabel="No gradient" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn-primary" type="button">Primary button</button>
                  <span className="h-2 w-2 rounded-full bg-accent" />
                  <span className="text-[12px] text-muted">Preview</span>
                </div>
              </Group>

              <Group title="Background" hint="The ambient backdrop behind every frosted surface.">
                <Segmented label="Background style" value={b.style} onChange={(v) => up('backdrop', { style: v })} options={[['preset', 'Presets'], ['mesh', 'Mesh gradient'], ['linear', 'Linear gradient'], ['solid', 'Solid']]} />
                {b.style === 'preset' ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {Object.entries(BACKDROP_PRESETS).map(([id, p]) => (
                      <button key={id} type="button" aria-pressed={b.preset === id} onClick={() => up('backdrop', { preset: id })} className={`rounded-2xl border p-1 text-left ${b.preset === id ? 'border-[var(--ink)] ring-2 ring-[var(--accent)]' : 'border-[var(--glass-line)]'}`}>
                        <span className="block h-12 rounded-xl" style={{ background: `linear-gradient(135deg, ${(ui.dark ? p.dark : p.light).join(', ')})` }} />
                        <span className="block px-1 pt-1 text-[12px] font-medium text-ink">{p.name}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(b.style === 'solid' ? b.colors.slice(0, 1) : b.colors).map((c, i) => (
                        <div key={i} className="flex items-end gap-2">
                          <div className="flex-1">
                            <ColorField id={`bd-${i}`} label={b.style === 'solid' ? 'Colour' : `Colour ${i + 1}`} value={c} swatches={false} onChange={(v) => up('backdrop', { colors: b.colors.map((x, j) => (j === i ? v : x)) })} />
                          </div>
                          {b.style !== 'solid' && b.colors.length > 2 && (
                            <button type="button" className="btn-ghost h-9 w-9 px-0" aria-label={`Remove colour ${i + 1}`} onClick={() => up('backdrop', { colors: b.colors.filter((_, j) => j !== i) })}><Icon name="trash" className="h-4 w-4" /></button>
                          )}
                        </div>
                      ))}
                    </div>
                    {b.style !== 'solid' && b.colors.length < 5 && (
                      <button type="button" className="btn-secondary h-8" onClick={() => up('backdrop', { colors: [...b.colors, '#ffffff'] })}><Icon name="plus" className="h-4 w-4" /> Add colour</button>
                    )}
                    {b.style === 'linear' && <Slider label="Direction" value={b.angle} min={0} max={360} unit="°" onChange={(v) => up('backdrop', { angle: v })} />}
                  </div>
                )}
                <Slider label="Softness (blur)" value={b.blur} min={0} max={80} unit="px" onChange={(v) => up('backdrop', { blur: v })} />
              </Group>

              <Group title="Sidebar" hint="Colour or gradient for the menu rail; text switches to stay readable.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <ColorField label="Sidebar colour" value={a.sidebar.color} onChange={(c) => up('sidebar', { color: c })} onClear={() => up('sidebar', { color: null, colorEnd: null })} clearLabel="Frosted" />
                  {a.sidebar.color && <ColorField label="Gradient to" value={a.sidebar.colorEnd} onChange={(c) => up('sidebar', { colorEnd: c })} onClear={() => up('sidebar', { colorEnd: null })} clearLabel="No gradient" />}
                </div>
              </Group>

              <Group title="KPI tints & charts" hint="The pastel cards on the Overview and the main chart colour.">
                <div className="grid gap-4 sm:grid-cols-2">
                  {(['sky', 'sage', 'peach', 'neutral'] as const).map((k, i) => (
                    <ColorField key={k} label={`Tint ${i + 1} (${k})`} value={a.tints[k]} swatches={false} onChange={(c) => up('tints', { [k]: c })} onClear={() => up('tints', { [k]: null })} />
                  ))}
                  <ColorField label="Chart colour" value={a.chart} swatches={false} onChange={(c) => up('chart', c)} onClear={a.chart !== DEFAULT_APPEARANCE.chart ? () => up('chart', DEFAULT_APPEARANCE.chart) : undefined} />
                  <ColorField label="Text colour (light mode)" value={a.ink} swatches={false} onChange={(c) => up('ink', c)} onClear={() => up('ink', null)} />
                </div>
              </Group>
            </>
          )}

          {section === 'surfaces' && (
            <Group title="Cards & surfaces" hint="How every card, panel, menu and dialog looks.">
              <Segmented label="Surface style" value={a.surface.style} onChange={(v) => up('surface', { style: v })} options={[['glass', 'Frosted glass'], ['solid', 'Solid'], ['outline', 'Outline']]} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Slider label="Opacity" value={a.surface.opacity} min={0.3} max={1} step={0.01} unit="%" onChange={(v) => up('surface', { opacity: v })} />
                <Slider label="Blur" value={a.surface.blur} min={0} max={40} unit="px" onChange={(v) => up('surface', { blur: v })} />
                <Slider label="Corner radius" value={a.surface.radius} min={4} max={32} unit="px" onChange={(v) => up('surface', { radius: v })} />
                <div>
                  <div className="mb-1.5 text-[13px] font-medium text-muted">Shadow</div>
                  <Segmented label="Shadow" value={a.surface.shadow} onChange={(v) => up('surface', { shadow: v })} options={[['none', 'None'], ['soft', 'Soft'], ['lifted', 'Lifted']]} />
                </div>
              </div>
              <ColorField label="Card colour" value={a.surface.color} onChange={(c) => up('surface', { color: c })} onClear={() => up('surface', { color: null })} clearLabel="Neutral" />
            </Group>
          )}

          {section === 'type' && (
            <Group title="Typography" hint="Fonts load from Google Fonts.">
              <div className="grid gap-4 sm:grid-cols-2">
                {(['font', 'headingFont'] as const).map((k) => (
                  <div key={k}>
                    <div className="mb-1.5 text-[13px] font-medium text-muted">{k === 'font' ? 'Body font' : 'Heading font'}</div>
                    <div className="grid max-h-72 grid-cols-2 gap-1.5 overflow-y-auto pr-1" role="radiogroup" aria-label={k === 'font' ? 'Body font' : 'Heading font'}>
                      {UI_FONTS.map((f) => (
                        <button key={f} type="button" role="radio" aria-checked={a[k] === f} onClick={() => up(k, f)} className={`rounded-xl border px-3 py-2 text-left text-[14px] ${a[k] === f ? 'border-[var(--ink)] bg-[var(--pill)] font-semibold' : 'border-[var(--glass-line)] hover:bg-[var(--track)]'}`} style={{ fontFamily: `'${f}'` }}>
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1.5 text-[13px] font-medium text-muted">Density</div>
                <Segmented label="Density" value={a.density} onChange={(v) => up('density', v)} options={[['compact', 'Compact'], ['cozy', 'Cozy'], ['comfortable', 'Comfortable']]} />
              </div>
            </Group>
          )}

          {section === 'layout' && (
            <Group title="Layout" hint="Arrange the app around how you work.">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 text-[13px] font-medium text-muted">Mode</div>
                  <Segmented label="Mode" value={a.mode} onChange={(v) => up('mode', v)} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'Match device']]} />
                </div>
                <div>
                  <div className="mb-1.5 text-[13px] font-medium text-muted">Sidebar</div>
                  <Segmented label="Sidebar style" value={a.sidebar.style} onChange={(v) => up('sidebar', { style: v })} options={[['floating', 'Floating'], ['docked', 'Docked']]} />
                </div>
                <div>
                  <div className="mb-1.5 text-[13px] font-medium text-muted">Sidebar position</div>
                  <Segmented label="Sidebar position" value={a.sidebar.side} onChange={(v) => up('sidebar', { side: v })} options={[['left', 'Left'], ['right', 'Right']]} />
                </div>
                <div>
                  <div className="mb-1.5 text-[13px] font-medium text-muted">Page width</div>
                  <Segmented label="Page width" value={a.contentWidth} onChange={(v) => up('contentWidth', v)} options={[['narrow', 'Narrow'], ['wide', 'Wide'], ['full', 'Full']]} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="start-page">Start page</label>
                  <select id="start-page" className="input max-w-xs" value={a.startPage} onChange={(e) => up('startPage', e.target.value)}>
                    {NAV_GROUPS.flatMap((g) => g.items).filter((n) => can(n.perm)).map((n) => <option key={n.href} value={n.href}>{n.label}</option>)}
                  </select>
                  <p className="mt-1 text-[12px] text-muted">Opens when you sign in, and from the logo.</p>
                </div>
              </div>
            </Group>
          )}

          {section === 'menu' && (
            <Group title="Menu" hint="Reorder pages and hide the ones you don't use. Hidden pages stay reachable from search (⌘K).">
              {flat.map((g, gi) => (
                <div key={g.label}>
                  <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{g.label}</div>
                  <ul className="divide-y divide-[var(--glass-line)] overflow-hidden rounded-2xl border border-[var(--glass-line)]">
                    {g.items.filter((n) => can(n.perm)).map((n, i, arr) => {
                      const hidden = a.nav.hidden.includes(n.href);
                      const idx = g.items.indexOf(n);
                      return (
                        <li key={n.href} className={`flex items-center gap-3 px-3 py-2 ${hidden ? 'opacity-50' : ''}`}>
                          <Icon name={n.icon} className="h-4 w-4 text-muted" />
                          <span className="flex-1 text-[14px] text-ink">{n.label}</span>
                          <button type="button" className="btn-ghost h-8 w-8 px-0" disabled={i === 0} aria-label={`Move ${n.label} up`} onClick={() => moveNav(gi, idx, -1)}><Icon name="chevronDown" className="h-4 w-4 rotate-180" /></button>
                          <button type="button" className="btn-ghost h-8 w-8 px-0" disabled={i === arr.length - 1} aria-label={`Move ${n.label} down`} onClick={() => moveNav(gi, idx, 1)}><Icon name="chevronDown" className="h-4 w-4" /></button>
                          <label className="flex items-center gap-1.5 text-[12px] text-muted">
                            <input type="checkbox" checked={!hidden} disabled={NAV_ALWAYS_VISIBLE.includes(n.href)} onChange={() => toggleHidden(n.href)} /> Show
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              <button type="button" className="btn-secondary h-8" onClick={() => up('nav', { order: [], hidden: [] })}>Reset menu</button>
            </Group>
          )}
        </div>

        {/* Live sample of the current look */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="card p-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Preview</div>
            <div className="grid grid-cols-2 gap-2">
              {(['sky', 'sage', 'peach', 'neutral'] as const).map((t, i) => (
                <div key={t} className={`tint-${t} rounded-2xl p-3`} style={{ borderRadius: `calc(var(--radius) - 6px)` }}>
                  <div className="text-[11px] text-muted">KPI {i + 1}</div>
                  <div className="text-[18px] font-bold text-ink num">{['$24k', '$81k', '62%', '18'][i]}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex h-16 items-end gap-1.5">
              {[40, 65, 30, 80, 55, 95, 70].map((h, i) => <span key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%`, background: 'var(--bar)' }} />)}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-primary h-8" type="button">Primary</button>
              <button className="btn-secondary h-8" type="button">Secondary</button>
            </div>
            <input className="input mt-3" placeholder="Input field" aria-label="Sample input" />
          </div>
          {can('workspaces:write') && (
            <div className="card p-4">
              <div className="text-[14px] font-semibold text-ink">Team look</div>
              <p className="mt-1 text-[12.5px] text-muted">Make this the default for everyone in the workspace who hasn&apos;t customized their own.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-secondary h-8" disabled={busy} onClick={() => run(() => ui.setTeamAppearance(a), 'Team look updated')}>Use for team</button>
                {ui.prefs.teamAppearance && <button type="button" className="btn-ghost h-8" disabled={busy} onClick={() => run(() => ui.setTeamAppearance(null), 'Team look cleared')}>Clear team look</button>}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Save bar */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="glass flex items-center gap-3 rounded-full py-2 pl-5 pr-2 shadow-pop" role="status">
            <span className="text-[13px] text-ink">Previewing unsaved changes</span>
            <button type="button" className="btn-ghost h-9" onClick={discard}>Discard</button>
            <button type="button" className="btn-primary h-9" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

