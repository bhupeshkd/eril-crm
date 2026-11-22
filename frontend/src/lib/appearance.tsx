'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BACKDROP_PRESETS,
  DEFAULT_APPEARANCE,
  DEFAULT_LAYOUT,
  cleanAppearance,
  readableOn,
  type Appearance,
  type Widget,
} from '@eril/shared';
import { api } from './api';

export interface UiPreferences {
  widgets: Widget[];
  layoutIsDefault: boolean;
  appearance: Appearance;
  appearanceSource: 'own' | 'team' | 'default';
  teamAppearance: Appearance | null;
}

/* ------------------------------------------------------------------ */
/* Colour helpers                                                      */
/* ------------------------------------------------------------------ */

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgba = (hex: string, a: number) => `rgba(${rgb(hex).join(', ')}, ${a})`;
/** Mix toward black (t<0) or white (t>0). */
export const shade = (hex: string, t: number) =>
  '#' + rgb(hex).map((c) => Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t).toString(16).padStart(2, '0')).join('');
/** Darkened version for dark mode backdrops. */
const night = (hex: string) => shade(hex, -0.72);

const BLOB_AT = ['12% 18%', '88% 12%', '78% 82%', '22% 88%', '52% 48%'];
function mesh(colors: string[]) {
  const [base, ...rest] = [colors[colors.length - 1], ...colors.slice(0, -1)];
  const blobs = (rest.length ? rest : colors).map((c, i) => `radial-gradient(55% 55% at ${BLOB_AT[i % BLOB_AT.length]}, ${rgba(c, 0.92)}, transparent 70%)`);
  return [...blobs, base].join(', ');
}

/** CSS background for a gradient between one or two colours. */
export const fill = (from: string, to: string | null, angle = 135) => (to ? `linear-gradient(${angle}deg, ${from}, ${to})` : from);

/** The CSS for an appearance, as custom properties and html attributes. Pure, so the studio can preview it. */
export function appearanceCss(a: Appearance, dark: boolean): { vars: Record<string, string>; attrs: Record<string, string> } {
  const d = DEFAULT_APPEARANCE;
  const vars: Record<string, string> = {};
  const attrs: Record<string, string> = {
    'data-surface': a.surface.style,
    'data-shadow': a.surface.shadow,
    'data-density': a.density,
    'data-width': a.contentWidth,
  };

  // Accent (+ optional gradient) and readable text on it.
  vars['--accent'] = a.accent;
  vars['--accent-hover'] = shade(a.accent, -0.08);
  vars['--accent-ink'] = readableOn(a.accent);
  vars['--accent-fill'] = fill(a.accent, a.accentEnd);
  vars['--accent-fill-hover'] = fill(shade(a.accent, -0.08), a.accentEnd ? shade(a.accentEnd, -0.08) : null);
  vars['--accent-ring'] = rgba(a.accent, 0.45);

  // Backdrop.
  const b = a.backdrop;
  if (!(b.style === 'preset' && b.preset === 'organic')) {
    const cols = b.style === 'preset' ? BACKDROP_PRESETS[b.preset]?.[dark ? 'dark' : 'light'] ?? [] : dark ? b.colors.map(night) : b.colors;
    vars['--backdrop'] =
      b.style === 'linear' ? `linear-gradient(${b.angle}deg, ${cols.join(', ')})` : b.style === 'solid' ? cols[0] : mesh(cols.length > 1 ? cols : [...cols, ...cols]);
  }
  vars['--backdrop-blur'] = `${b.blur}px`;

  // Surfaces.
  const s = a.surface;
  const base = s.color ? (dark ? night(s.color) : s.color) : dark ? '#181a18' : '#f4f4f2';
  const strong = s.color ? (dark ? shade(s.color, -0.66) : shade(s.color, 0.6)) : dark ? '#1e211e' : '#ffffff';
  if (s.color || s.opacity !== d.surface.opacity) {
    vars['--glass'] = rgba(base, s.opacity);
    vars['--glass-strong'] = rgba(strong, Math.min(1, s.opacity + 0.14));
  }
  vars['--glass-blur'] = `${s.blur}px`;
  vars['--radius'] = `${s.radius}px`;

  // Sidebar colour / gradient, with readable text when it is dark.
  if (a.sidebar.color) {
    const c1 = dark ? night(a.sidebar.color) : a.sidebar.color;
    const c2 = a.sidebar.colorEnd ? (dark ? night(a.sidebar.colorEnd) : a.sidebar.colorEnd) : c1;
    vars['--glass-sidebar'] = `linear-gradient(180deg, ${rgba(c1, 0.9)}, ${rgba(c2, 0.9)})`;
    attrs['data-sidebar-contrast'] = readableOn(c1) === '#ffffff' ? 'light' : 'dark';
  } else attrs['data-sidebar-contrast'] = 'auto';

  // KPI tints.
  for (const k of ['sky', 'sage', 'peach', 'neutral'] as const) {
    const c = a.tints[k];
    if (c) vars[`--tint-${k}`] = dark ? `color-mix(in srgb, ${c} 32%, rgba(24, 26, 24, 0.78))` : rgba(c, 0.88);
  }

  vars['--bar'] = a.chart;
  if (a.ink && !dark) {
    vars['--ink'] = a.ink;
    vars['--muted'] = `color-mix(in srgb, ${a.ink} 68%, #9a9a9a)`;
  }

  vars['--font-sans'] = `'${a.font}'`;
  vars['--font-heading'] = `'${a.headingFont}'`;
  return { vars, attrs };
}

const fontHref = (f: string) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`;
export function loadFont(f: string) {
  if (typeof document === 'undefined' || f === 'Urbanist') return;
  const id = `font-${f.replace(/\W/g, '')}`;
  if (document.getElementById(id)) return;
  const l = document.createElement('link');
  l.id = id;
  l.rel = 'stylesheet';
  l.href = fontHref(f);
  document.head.appendChild(l);
}

/** Every custom property/attribute we may set, so switching back to defaults clears old values. */
const MANAGED_VARS = ['--accent', '--accent-hover', '--accent-ink', '--accent-fill', '--accent-fill-hover', '--accent-ring', '--backdrop', '--backdrop-blur', '--glass', '--glass-strong', '--glass-blur', '--radius', '--glass-sidebar', '--tint-sky', '--tint-sage', '--tint-peach', '--tint-neutral', '--bar', '--ink', '--muted', '--font-sans', '--font-heading'];
const MANAGED_ATTRS = ['data-surface', 'data-shadow', 'data-density', 'data-width', 'data-sidebar-contrast'];

export function resolveDark(mode: Appearance['mode']) {
  if (mode === 'system') return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return mode === 'dark';
}

/** Applies an appearance to the page and caches it so the next load paints it straight away. */
export function applyAppearance(a: Appearance) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const dark = resolveDark(a.mode);
  if (dark) root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  const { vars, attrs } = appearanceCss(a, dark);
  for (const v of MANAGED_VARS) if (!(v in vars)) root.style.removeProperty(v);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  for (const k of MANAGED_ATTRS) if (!(k in attrs)) root.removeAttribute(k);
  for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
  loadFont(a.font);
  loadFont(a.headingFont);
  try {
    localStorage.setItem('eril.theme', dark ? 'dark' : 'light');
    localStorage.setItem('eril.ui', JSON.stringify({ vars, attrs, fonts: [...new Set([a.font, a.headingFont])].filter((f) => f !== 'Urbanist').map(fontHref) }));
  } catch {
    /* storage blocked: still applied for this visit */
  }
}


/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

interface UiContext {
  prefs: UiPreferences | null;
  /** What is on screen now (a preview while the studio is open). */
  appearance: Appearance;
  dark: boolean;
  preview: (a: Appearance | null) => void;
  saveAppearance: (a: Appearance) => Promise<void>;
  resetAppearance: () => Promise<void>;
  setTeamAppearance: (a: Appearance | null) => Promise<void>;
  setMode: (m: Appearance['mode']) => void;
  saveLayout: (w: Widget[]) => Promise<Widget[]>;
  resetLayout: () => Promise<Widget[]>;
}

const Ctx = createContext<UiContext | null>(null);

export function UiPreferencesProvider({ workspaceId, children }: { workspaceId?: string | null; children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<UiPreferences | null>(null);
  const [draft, setDraft] = useState<Appearance | null>(null);
  const [systemDark, setSystemDark] = useState(false);
  const saved = prefs?.appearance ?? DEFAULT_APPEARANCE;
  const appearance = draft ?? saved;
  const modeTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!workspaceId) return;
    api<UiPreferences>('/ui/preferences').then(setPrefs).catch(() => setPrefs(null));
  }, [workspaceId]);

  // Follow the device for 'system' mode.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    if (prefs || draft) applyAppearance(appearance);
  }, [appearance, prefs, draft, systemDark]);

  const saveAppearance = useCallback(async (a: Appearance) => {
    const next = await api<UiPreferences>('/ui/appearance', { method: 'PUT', body: { appearance: cleanAppearance(a) } });
    setPrefs(next);
    setDraft(null);
  }, []);
  const resetAppearance = useCallback(async () => {
    setPrefs(await api<UiPreferences>('/ui/appearance', { method: 'DELETE' }));
    setDraft(null);
  }, []);
  const setTeamAppearance = useCallback(async (a: Appearance | null) => {
    const r = await api<{ teamAppearance: Appearance | null }>('/ui/team-appearance', a ? { method: 'PUT', body: { appearance: a } } : { method: 'DELETE' });
    setPrefs(await api<UiPreferences>('/ui/preferences'));
    return void r;
  }, []);
  const setMode = useCallback(
    (m: Appearance['mode']) => {
      const next = { ...(draft ?? saved), mode: m };
      // Instant on screen; saved to the profile shortly after (toggling quickly sends one request).
      setPrefs((p) => (p ? { ...p, appearance: { ...p.appearance, mode: m } } : p));
      if (draft) setDraft(next);
      clearTimeout(modeTimer.current);
      modeTimer.current = setTimeout(() => {
        if (!draft) api<UiPreferences>('/ui/appearance', { method: 'PUT', body: { appearance: { ...saved, mode: m } } }).then(setPrefs).catch(() => {});
      }, 600);
      if (!prefs) applyAppearance(next);
    },
    [draft, saved, prefs],
  );
  const saveLayout = useCallback(async (w: Widget[]) => {
    const next = await api<UiPreferences>('/ui/layout', { method: 'PUT', body: { widgets: w } });
    setPrefs(next);
    return next.widgets;
  }, []);
  const resetLayout = useCallback(async () => {
    const next = await api<UiPreferences>('/ui/layout', { method: 'DELETE' });
    setPrefs(next);
    return next.widgets;
  }, []);

  const value = useMemo<UiContext>(
    () => ({ prefs, appearance, dark: resolveDark(appearance.mode), preview: setDraft, saveAppearance, resetAppearance, setTeamAppearance, setMode, saveLayout, resetLayout }),
    // systemDark re-evaluates `dark` for 'system' mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefs, appearance, systemDark, saveAppearance, resetAppearance, setTeamAppearance, setMode, saveLayout, resetLayout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useUi outside UiPreferencesProvider');
  return c;
}

export { DEFAULT_APPEARANCE, DEFAULT_LAYOUT };
