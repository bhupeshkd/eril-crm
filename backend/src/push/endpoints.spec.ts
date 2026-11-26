import { describe, expect, it } from 'vitest';
import { deviceLabel, pushEndpointAllowed } from './endpoints';

describe('pushEndpointAllowed', () => {
  it('accepts the browser push services over https', () => {
    for (const u of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
      'https://wns2-par02p.notify.windows.com/w/?token=x',
      'https://web.push.apple.com/QGa9',
      'https://fcm.googleapis.com:443/x',
    ]) expect(pushEndpointAllowed(u), u).toBe(true);
  });

  it('rejects anything else', () => {
    for (const u of [
      'http://fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilfcm.googleapis.com.example/x',
      'https://notfcm.googleapis.co/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://127.0.0.1/x',
      'https://localhost/x',
      'javascript:alert(1)',
      'not a url',
    ]) expect(pushEndpointAllowed(u), u).toBe(false);
  });

  it('allows configured test hosts over https only', () => {
    expect(pushEndpointAllowed('https://127.0.0.1:5481/send/a', ['127.0.0.1:5481'])).toBe(true);
    expect(pushEndpointAllowed('http://127.0.0.1:5481/send/a', ['127.0.0.1:5481'])).toBe(false);
    expect(pushEndpointAllowed('https://127.0.0.1:5482/send/a', ['127.0.0.1:5481'])).toBe(false);
  });
});

describe('deviceLabel', () => {
  it('names browser and OS', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0')).toBe('Edge on Windows');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0')).toBe('Firefox on macOS');
    expect(deviceLabel('')).toBe('Browser');
  });
});
