'use client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

const ACCESS_KEY = 'eril.accessToken';
const REFRESH_KEY = 'eril.refreshToken';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const tokens = {
  get access() {
    return read(ACCESS_KEY);
  },
  get refresh() {
    return read(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refreshToken = tokens.refresh;
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        // Another tab may have rotated the refresh token a moment ago (tokens live in
        // shared localStorage). If the stored token changed, that tab succeeded: reuse it.
        await new Promise((r) => setTimeout(r, 300));
        return !!tokens.refresh && tokens.refresh !== refreshToken;
      }
      const data = await res.json();
      tokens.set(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function api<T = any>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  // File uploads: let the browser set the multipart boundary.
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...(init.auth !== false && tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
      },
      body: isForm ? (init.body as FormData) : init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  let res = await doFetch();
  if (res.status === 401 && init.auth !== false && (await refreshTokens())) {
    res = await doFetch();
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && init.auth !== false) {
      tokens.clear();
      if (typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
        location.href = '/login';
      }
    }
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
    throw new ApiError(res.status, msg || res.statusText, data);
  }
  return data as T;
}

/** Authenticated file download (e.g. CSV export). */
export async function download(path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Minimal RFC-4180 CSV parser → array of objects keyed by header. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export const fmtCurrency = (n: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n || 0);

export const fmtMoney = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function timeAgo(d: string | Date) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
