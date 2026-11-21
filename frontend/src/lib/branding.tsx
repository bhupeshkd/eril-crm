'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export interface Branding {
  appName: string;
  logoUrl: string;
  primaryColor: string;
  hidePoweredBy: boolean;
}

export const DEFAULT_BRANDING: Branding = { appName: 'ERIL', logoUrl: '', primaryColor: '#5847d7', hidePoweredBy: false };

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
/** How far each shade is mixed toward white (+) or black (−) from the base colour, which is shade 600. */
const MIX: Record<(typeof SHADES)[number], number> = { 50: 0.94, 100: 0.88, 200: 0.76, 300: 0.6, 400: 0.4, 500: 0.18, 600: 0, 700: -0.15, 800: -0.3, 900: -0.45, 950: -0.65 };

const toRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** RGB triplets ("r g b") for the whole 50–950 scale, derived from one #rrggbb colour. */
export function palette(hex: string): Record<string, string> {
  const base = toRgb(hex);
  const out: Record<string, string> = {};
  for (const s of SHADES) {
    const m = MIX[s];
    const target = m >= 0 ? 255 : 0;
    const t = Math.abs(m);
    out[s] = base.map((c) => Math.round(c + (target - c) * t)).join(' ');
  }
  return out;
}

/** Apply a brand colour to the page; the default colour restores the hand-tuned palette from globals.css. */
export function applyBrandColor(hex: string) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const valid = /^#[0-9a-f]{6}$/i.test(hex);
  if (!valid || hex.toLowerCase() === DEFAULT_BRANDING.primaryColor) {
    for (const s of SHADES) root.style.removeProperty(`--brand-${s}`);
    return;
  }
  for (const [s, v] of Object.entries(palette(hex))) root.style.setProperty(`--brand-${s}`, v);
}

/** Branding for the signed-in workspace; applies the colour and page title as soon as it loads. */
export function useAppBranding(workspaceId: string | null | undefined) {
  const enabled = !!workspaceId;
  const [b, setB] = useState<Branding>(DEFAULT_BRANDING);
  useEffect(() => {
    if (!enabled) return;
    const load = () =>
      api<Branding>('/branding')
        .then((x) => {
          setB(x);
          applyBrandColor(x.primaryColor);
        })
        .catch(() => {});
    load();
    // The Agency page fires this after saving, so the shell updates without a reload.
    window.addEventListener('eril:branding-changed', load);
    return () => window.removeEventListener('eril:branding-changed', load);
  }, [enabled, workspaceId]);
  useEffect(() => {
    if (enabled && b.appName !== DEFAULT_BRANDING.appName) document.title = document.title.replace(/^ERIL\b/, b.appName);
  }, [enabled, b.appName]);
  return b;
}

/** Branding for a customer-facing page, looked up by the page's own link (calendar slug, invoice token, …). */
export function usePublicBranding(kind?: string, key?: string) {
  const [b, setB] = useState<Branding>(DEFAULT_BRANDING);
  useEffect(() => {
    if (!kind || !key) return;
    api<Branding>(`/public/branding/${kind}/${encodeURIComponent(key)}`, { auth: false })
      .then((x) => {
        setB(x);
        applyBrandColor(x.primaryColor);
      })
      .catch(() => {});
  }, [kind, key]);
  return b;
}

/** Square logo: the uploaded image, or the brand initial on a gradient tile. */
export function BrandMark({ b, size = 'h-8 w-8 text-sm rounded-[10px]' }: { b: Branding; size?: string }) {
  const [broken, setBroken] = useState(false);
  if (b.logoUrl && !broken) {
    return <img src={b.logoUrl} alt="" className={`${size} shrink-0 bg-white object-contain`} onError={() => setBroken(true)} />;
  }
  return (
    <span className={`grid shrink-0 place-items-center bg-gradient-to-br from-brand-500 to-brand-700 font-bold text-white shadow-sm shadow-brand-600/30 ${size}`}>
      {b.appName.trim().charAt(0).toUpperCase() || 'E'}
    </span>
  );
}
