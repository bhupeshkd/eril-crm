/**
 * Per-profile UI customization: the Overview widget layout and the app's whole appearance
 * (colours, gradients, surfaces, fonts, sidebar and menu). Pure, shared by the API (validation)
 * and the web app (rendering), so both agree on what is allowed.
 */

const HEX = /^#[0-9a-f]{6}$/i;
const PATH = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const hex = (v: unknown, fallback: string | null): string | null => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/* ------------------------------------------------------------------ */
/* Overview widgets                                                    */
/* ------------------------------------------------------------------ */

export const WIDGET_TYPES = [
  'won', 'pipeline', 'forecast', 'winrate',
  'revenue', 'stages',
  'nextBest', 'today', 'leaderboard',
  'activity', 'appointments', 'note', 'shortcuts',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Column spans on the 12-column desktop grid. */
export const WIDGET_SIZES = { s: 3, m: 4, l: 6, xl: 8, full: 12 } as const;
export type WidgetSize = keyof typeof WIDGET_SIZES;
/** 'custom' uses the widget's own colour / gradient in `style`. */
export const WIDGET_TINTS = ['none', 'sky', 'sage', 'peach', 'neutral', 'lime', 'custom'] as const;
export type WidgetTint = (typeof WIDGET_TINTS)[number];

export interface WidgetStyle {
  /** Background colour, or the start of a gradient. */
  from: string;
  /** Gradient end; null = solid colour. */
  to: string | null;
  /** Gradient direction in degrees. */
  angle: number;
}

export interface Widget {
  /** Stable id within the layout (lets a type appear more than once, e.g. two notes). */
  id: string;
  type: WidgetType;
  size: WidgetSize;
  tint: WidgetTint;
  style?: WidgetStyle;
  /** Optional own title. */
  title?: string;
  /** Per-widget settings: note text, shortcut links. */
  config?: { text?: string; links?: string[] };
}

/** Types that can be added more than once. */
export const REPEATABLE_WIDGETS: WidgetType[] = ['note', 'shortcuts'];
export const MAX_WIDGETS = 24;
/** App pages a Shortcuts widget may link to. */
export const SHORTCUT_PAGES = ['/inbox', '/pipeline', '/contacts', '/tasks', '/calendars', '/calls', '/campaigns', '/social', '/qr-codes', '/sites', '/forms', '/reputation', '/payments', '/courses', '/communities', '/workflows', '/reporting', '/settings'];

export const DEFAULT_LAYOUT: Widget[] = [
  { id: 'won', type: 'won', size: 's', tint: 'sky' },
  { id: 'pipeline', type: 'pipeline', size: 's', tint: 'sage' },
  { id: 'forecast', type: 'forecast', size: 's', tint: 'peach' },
  { id: 'winrate', type: 'winrate', size: 's', tint: 'neutral' },
  { id: 'revenue', type: 'revenue', size: 'xl', tint: 'none' },
  { id: 'stages', type: 'stages', size: 'm', tint: 'none' },
  { id: 'nextBest', type: 'nextBest', size: 'm', tint: 'sage' },
  { id: 'today', type: 'today', size: 'm', tint: 'none' },
  { id: 'leaderboard', type: 'leaderboard', size: 'm', tint: 'none' },
];

/** Cleans a layout from the client; returns an error message or the safe layout. */
export function cleanLayout(input: unknown): Widget[] | string {
  if (!Array.isArray(input)) return 'Layout must be a list of widgets';
  if (input.length > MAX_WIDGETS) return `Up to ${MAX_WIDGETS} widgets`;
  const out: Widget[] = [];
  const ids = new Set<string>();
  const singles = new Set<string>();
  for (const raw of input) {
    const type = raw?.type;
    if (!WIDGET_TYPES.includes(type)) return `Unknown widget "${String(type).slice(0, 30)}"`;
    if (!REPEATABLE_WIDGETS.includes(type)) {
      if (singles.has(type)) return `"${type}" can only appear once`;
      singles.add(type);
    }
    const id = String(raw?.id ?? '').trim();
    if (!/^[\w-]{1,40}$/.test(id) || ids.has(id)) return 'Each widget needs a unique id';
    ids.add(id);
    const size = pick<WidgetSize>(raw?.size, Object.keys(WIDGET_SIZES) as WidgetSize[], 'm');
    let tint = pick<WidgetTint>(raw?.tint, WIDGET_TINTS, 'none');
    const w: Widget = { id, type, size, tint };
    if (tint === 'custom') {
      const from = hex(raw?.style?.from, null);
      if (from) w.style = { from, to: hex(raw?.style?.to, null), angle: Math.round(num(raw?.style?.angle, 0, 360, 135)) };
      else w.tint = tint = 'none';
    }
    const title = typeof raw?.title === 'string' ? raw.title.trim().slice(0, 60) : '';
    if (title) w.title = title;
    if (type === 'note') w.config = { text: String(raw?.config?.text ?? '').slice(0, 2000) };
    if (type === 'shortcuts') {
      const links = Array.isArray(raw?.config?.links) ? raw.config.links : [];
      w.config = { links: [...new Set(links.map(String).filter((l: string) => SHORTCUT_PAGES.includes(l)))].slice(0, 8) as string[] };
    }
    out.push(w);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/* ------------------------------------------------------------------ */

export const UI_FONTS = ['Urbanist', 'Inter', 'Manrope', 'DM Sans', 'Plus Jakarta Sans', 'Outfit', 'Poppins', 'Nunito', 'Space Grotesk', 'IBM Plex Sans', 'Sora', 'Lora'] as const;
export type UiFont = (typeof UI_FONTS)[number];

export const BACKDROP_STYLES = ['preset', 'mesh', 'linear', 'solid'] as const;
export type BackdropStyle = (typeof BACKDROP_STYLES)[number];

/** Ready-made ambient backdrops: blob colours for light and dark mode. 'organic' is the built-in default. */
export const BACKDROP_PRESETS: Record<string, { name: string; light: string[]; dark: string[] }> = {
  organic: { name: 'Organic', light: ['#d6c4a0', '#b0c4a0', '#deb296', '#aabecd', '#d9d4c8'], dark: ['#464030', '#30422c', '#52342a', '#283846', '#1a1c1a'] },
  ocean: { name: 'Ocean', light: ['#a7d3f2', '#9fb8f0', '#b5e6e0', '#c7d2fe', '#dfe9f3'], dark: ['#163a5c', '#1d2f66', '#134a48', '#2a2f6b', '#111827'] },
  sunset: { name: 'Sunset', light: ['#fbc2a4', '#f9a8b8', '#fde68a', '#f5b3d6', '#f7e3d4'], dark: ['#5c2f1f', '#5a1f33', '#5a4410', '#4f1f45', '#1c1414'] },
  aurora: { name: 'Aurora', light: ['#a7f3d0', '#c4b5fd', '#99f6e4', '#f0abfc', '#e0e7ff'], dark: ['#134e3a', '#3b2a6b', '#115e59', '#5b2168', '#0f1222'] },
  lavender: { name: 'Lavender', light: ['#ddd6fe', '#fbcfe8', '#c7d2fe', '#e9d5ff', '#f3eefc'], dark: ['#3b2f66', '#5a2445', '#2b3266', '#472a66', '#16121f'] },
  forest: { name: 'Forest', light: ['#bbd8a3', '#9cc5a1', '#d9e4b0', '#a3c9b8', '#e2e8d8'], dark: ['#2c4a22', '#1f4a33', '#45501c', '#1f453c', '#101610'] },
  dune: { name: 'Dune', light: ['#e7cfa6', '#d9b68c', '#efdcc0', '#cbb59a', '#efe6d8'], dark: ['#4a3a22', '#4a2f1c', '#54452c', '#3d3224', '#17140f'] },
  graphite: { name: 'Graphite', light: ['#d4d4d4', '#c7cbd1', '#e5e5e5', '#bfc5cc', '#ececea'], dark: ['#2a2a2a', '#262b31', '#333333', '#20252b', '#121212'] },
};

export interface Appearance {
  /** The theme preset this started from (shown in the studio). */
  preset: string;
  mode: 'light' | 'dark' | 'system';
  /** Primary colour (buttons, active markers, highlights)… */
  accent: string;
  /** …optionally fading into a second colour. */
  accentEnd: string | null;
  backdrop: { style: BackdropStyle; preset: string; colors: string[]; angle: number; blur: number };
  surface: { style: 'glass' | 'solid' | 'outline'; opacity: number; blur: number; radius: number; shadow: 'none' | 'soft' | 'lifted'; color: string | null };
  sidebar: { style: 'floating' | 'docked'; side: 'left' | 'right'; color: string | null; colorEnd: string | null };
  /** KPI tint colours; null = built-in pastel. */
  tints: { sky: string | null; sage: string | null; peach: string | null; neutral: string | null };
  /** Charts' main colour. */
  chart: string;
  /** Text colour override for light mode; null = default. */
  ink: string | null;
  font: UiFont;
  headingFont: UiFont;
  density: 'compact' | 'cozy' | 'comfortable';
  contentWidth: 'narrow' | 'wide' | 'full';
  /** Menu: order of page links and the hidden ones (by href). */
  nav: { order: string[]; hidden: string[] };
  /** Where "home" (logo, sign-in) leads. */
  startPage: string;
}

export const DEFAULT_APPEARANCE: Appearance = {
  preset: 'sylva',
  mode: 'light',
  accent: '#b6e633',
  accentEnd: null,
  backdrop: { style: 'preset', preset: 'organic', colors: ['#d6c4a0', '#b0c4a0', '#deb296', '#aabecd'], angle: 135, blur: 28 },
  surface: { style: 'glass', opacity: 0.8, blur: 20, radius: 22, shadow: 'none', color: null },
  sidebar: { style: 'floating', side: 'left', color: null, colorEnd: null },
  tints: { sky: null, sage: null, peach: null, neutral: null },
  chart: '#5b9ee1',
  ink: null,
  font: 'Urbanist',
  headingFont: 'Urbanist',
  density: 'cozy',
  contentWidth: 'wide',
  nav: { order: [], hidden: [] },
  startPage: '/dashboard',
};

/** Pages that can never be hidden from the menu (so nobody locks themselves out of settings). */
export const NAV_ALWAYS_VISIBLE = ['/settings'];

type Partial2<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? T[K] : Partial<T[K]>) : T[K] };

/** One-click themes. */
export const UI_THEMES: Array<{ id: string; name: string; set: Partial2<Appearance> }> = [
  { id: 'sylva', name: 'Sylva', set: {} },
  { id: 'ocean', name: 'Ocean', set: { accent: '#38bdf8', accentEnd: '#6366f1', backdrop: { style: 'preset', preset: 'ocean' }, chart: '#6366f1', tints: { sky: '#cfe3fb', sage: '#cdeee9', peach: '#dcdcfb', neutral: '#eef2f7' } } },
  { id: 'sunset', name: 'Sunset', set: { accent: '#fb923c', accentEnd: '#f43f5e', backdrop: { style: 'preset', preset: 'sunset' }, chart: '#f97362', tints: { sky: '#fde2cf', sage: '#fde9b0', peach: '#fbd0d9', neutral: '#f7ede6' } } },
  { id: 'aurora', name: 'Aurora', set: { accent: '#34d399', accentEnd: '#22d3ee', backdrop: { style: 'preset', preset: 'aurora' }, chart: '#8b5cf6', tints: { sky: '#d6e4ff', sage: '#c9f2e0', peach: '#f1d5fb', neutral: '#eef0f8' } } },
  { id: 'lavender', name: 'Lavender', set: { accent: '#a78bfa', accentEnd: '#f0abfc', backdrop: { style: 'preset', preset: 'lavender' }, chart: '#a78bfa', tints: { sky: '#e2ddfd', sage: '#f6d9ec', peach: '#fbe0ea', neutral: '#f3f0fa' } } },
  { id: 'forest', name: 'Forest', set: { accent: '#84cc16', accentEnd: '#15803d', backdrop: { style: 'preset', preset: 'forest' }, chart: '#4d7c0f' } },
  { id: 'midnight', name: 'Midnight', set: { mode: 'dark', accent: '#7c9cff', accentEnd: '#c084fc', backdrop: { style: 'preset', preset: 'aurora' }, chart: '#7c9cff' } },
  { id: 'mono', name: 'Mono', set: { accent: '#181a18', accentEnd: null, backdrop: { style: 'solid', colors: ['#ececea'] }, surface: { style: 'solid', radius: 14, shadow: 'soft' }, chart: '#3f3f46', tints: { sky: '#efefed', sage: '#efefed', peach: '#efefed', neutral: '#efefed' } } },
];

/** Applies a theme over a base appearance, keeping the menu and start page. */
export function applyTheme(base: Appearance, themeId: string): Appearance {
  const t = UI_THEMES.find((x) => x.id === themeId);
  if (!t) return base;
  const d = DEFAULT_APPEARANCE;
  const s = t.set as any;
  return cleanAppearance({
    ...d,
    ...s,
    preset: t.id,
    backdrop: { ...d.backdrop, ...(s.backdrop ?? {}) },
    surface: { ...d.surface, ...(s.surface ?? {}) },
    sidebar: { ...d.sidebar, ...(s.sidebar ?? {}) },
    tints: { ...d.tints, ...(s.tints ?? {}) },
    nav: base.nav,
    startPage: base.startPage,
    font: base.font,
    headingFont: base.headingFont,
    density: base.density,
    contentWidth: base.contentWidth,
  });
}

const cleanPaths = (v: unknown, max: number) =>
  Array.isArray(v) ? [...new Set(v.filter((p): p is string => typeof p === 'string' && p.length <= 80 && PATH.test(p)))].slice(0, max) : [];

/** Merges whatever the client sent onto the defaults; anything invalid falls back to the default. */
export function cleanAppearance(input: unknown): Appearance {
  const d = DEFAULT_APPEARANCE;
  const a = isObj(input) ? input : {};
  const b = isObj(a.backdrop) ? a.backdrop : {};
  const s = isObj(a.surface) ? a.surface : {};
  const sb = isObj(a.sidebar) ? a.sidebar : {};
  const t = isObj(a.tints) ? a.tints : {};
  const n = isObj(a.nav) ? a.nav : {};
  const colors = Array.isArray(b.colors) ? b.colors.map((c: unknown) => hex(c, null)).filter((c: string | null): c is string => !!c).slice(0, 5) : [];
  return {
    preset: typeof a.preset === 'string' && /^[\w-]{1,30}$/.test(a.preset) ? a.preset : 'custom',
    mode: pick(a.mode, ['light', 'dark', 'system'] as const, d.mode),
    accent: hex(a.accent, d.accent)!,
    accentEnd: hex(a.accentEnd, null),
    backdrop: {
      style: pick(b.style, BACKDROP_STYLES, d.backdrop.style),
      preset: typeof b.preset === 'string' && b.preset in BACKDROP_PRESETS ? b.preset : d.backdrop.preset,
      colors: colors.length ? colors : d.backdrop.colors,
      angle: Math.round(num(b.angle, 0, 360, d.backdrop.angle)),
      blur: Math.round(num(b.blur, 0, 80, d.backdrop.blur)),
    },
    surface: {
      style: pick(s.style, ['glass', 'solid', 'outline'] as const, d.surface.style),
      opacity: Math.round(num(s.opacity, 0.3, 1, d.surface.opacity) * 100) / 100,
      blur: Math.round(num(s.blur, 0, 40, d.surface.blur)),
      radius: Math.round(num(s.radius, 4, 32, d.surface.radius)),
      shadow: pick(s.shadow, ['none', 'soft', 'lifted'] as const, d.surface.shadow),
      color: hex(s.color, null),
    },
    sidebar: {
      style: pick(sb.style, ['floating', 'docked'] as const, d.sidebar.style),
      side: pick(sb.side, ['left', 'right'] as const, d.sidebar.side),
      color: hex(sb.color, null),
      colorEnd: hex(sb.colorEnd, null),
    },
    tints: { sky: hex(t.sky, null), sage: hex(t.sage, null), peach: hex(t.peach, null), neutral: hex(t.neutral, null) },
    chart: hex(a.chart, d.chart)!,
    ink: hex(a.ink, null),
    font: pick(a.font, UI_FONTS, d.font),
    headingFont: pick(a.headingFont, UI_FONTS, d.headingFont),
    density: pick(a.density, ['compact', 'cozy', 'comfortable'] as const, d.density),
    contentWidth: pick(a.contentWidth, ['narrow', 'wide', 'full'] as const, d.contentWidth),
    nav: { order: cleanPaths(n.order, 60), hidden: cleanPaths(n.hidden, 60).filter((p) => !NAV_ALWAYS_VISIBLE.includes(p)) },
    startPage: typeof a.startPage === 'string' && PATH.test(a.startPage) && a.startPage.length <= 80 ? a.startPage : d.startPage,
  };
}

/** Relative luminance (0 dark – 1 light) of a #rrggbb colour, for picking readable text on it. */
export function luminance(c: string): number {
  const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
/** Dark or light text for a background colour. */
export const readableOn = (bg: string) => (luminance(bg) > 0.2 ? '#181a18' : '#ffffff');
