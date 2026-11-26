/**
 * Server-side branding lookup by request host, for the web app manifest and app icons.
 * On an agency's verified app domain this is the agency's branding; everywhere else, the default.
 */
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export type HostBranding = { appName: string; primaryColor: string };
export const DEFAULT_HOST_BRANDING: HostBranding = { appName: 'ERIL', primaryColor: '#5847d7' };

export function requestHost(req: Request) {
  return (req.headers.get('host') || '').split(':')[0].toLowerCase();
}

export async function brandingForHost(host: string): Promise<HostBranding> {
  if (!host || host === 'localhost' || host === '127.0.0.1') return DEFAULT_HOST_BRANDING;
  try {
    const r = await fetch(`${API}/public/branding/host/${encodeURIComponent(host)}`, { next: { revalidate: 300 } });
    if (!r.ok) return DEFAULT_HOST_BRANDING;
    const b = (await r.json()) as Partial<HostBranding>;
    return {
      appName: (b.appName || '').trim() || DEFAULT_HOST_BRANDING.appName,
      primaryColor: /^#[0-9a-f]{6}$/i.test(b.primaryColor || '') ? b.primaryColor!.toLowerCase() : DEFAULT_HOST_BRANDING.primaryColor,
    };
  } catch {
    return DEFAULT_HOST_BRANDING;
  }
}

/** Darker shade of a #rrggbb colour (for the icon gradient). */
export function shade(hex: string, f = 0.72) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f).toString(16).padStart(2, '0'));
  return `#${c.join('')}`;
}
