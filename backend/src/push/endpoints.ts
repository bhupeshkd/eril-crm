/** Pure helpers for Web Push subscriptions (kept apart from the Nest module so they unit-test cleanly). */

/**
 * Push services run by the browsers. A subscription endpoint must be one of these, so the server never
 * posts to an address a client made up (internal hosts, other sites).
 */
const PUSH_HOST_SUFFIXES = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com', 'push.apple.com'];

export function pushEndpointAllowed(endpoint: string, testHosts: string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (testHosts.includes(u.host)) return u.protocol === 'https:';
  if (u.protocol !== 'https:' || (u.port && u.port !== '443')) return false;
  const h = u.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

/** "Chrome on Android" from a user agent. */
export function deviceLabel(ua = ''): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
