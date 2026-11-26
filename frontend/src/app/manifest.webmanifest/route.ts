import { brandingForHost, requestHost } from '@/lib/host-branding';

/**
 * Web app manifest, so the staff app installs to a phone's home screen or a desktop dock.
 * Built per request host: on an agency's own app domain the installed app carries the agency's name and colour.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const b = await brandingForHost(requestHost(req));
  const icon = (size: number, purpose: 'any' | 'maskable') => ({
    src: `/app-icon/${size}${purpose === 'maskable' ? '?maskable=1' : ''}`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose,
  });
  const manifest = {
    id: '/dashboard',
    name: b.appName,
    short_name: b.appName.length > 12 ? b.appName.split(/\s+/)[0].slice(0, 12) : b.appName,
    description: 'CRM, conversations, calendars and pipeline on the go.',
    start_url: '/dashboard?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f4f5f9',
    theme_color: b.primaryColor,
    icons: [icon(192, 'any'), icon(512, 'any'), icon(192, 'maskable'), icon(512, 'maskable')],
    shortcuts: [
      { name: 'Conversations', url: '/inbox', icons: [{ src: '/app-icon/96', sizes: '96x96', type: 'image/png' }] },
      { name: 'Contacts', url: '/contacts', icons: [{ src: '/app-icon/96', sizes: '96x96', type: 'image/png' }] },
      { name: 'Calendars', url: '/calendars', icons: [{ src: '/app-icon/96', sizes: '96x96', type: 'image/png' }] },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
