'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Installable app (PWA): links the per-host manifest and icons, registers the service worker, and tracks whether
 * the browser can install the app. Used on the staff app and the login pages only, never on customer sites.
 */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own button instead of the browser's mini-infobar
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

function ensureLink(rel: string, href: string, extra: Record<string, string> = {}) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
  for (const [k, v] of Object.entries(extra)) el.setAttribute(k, v);
}

function ensureMeta(name: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone/iPad Safari has no install prompt; people add the app from the Share menu. */
export function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Adds the manifest, icons and theme colour to <head> and registers the service worker. Call once per page shell. */
export function usePwaSetup(themeColor?: string, appName?: string) {
  useEffect(() => {
    ensureLink('manifest', '/manifest.webmanifest');
    ensureLink('apple-touch-icon', '/app-icon/180');
    ensureMeta('mobile-web-app-capable', 'yes');
    ensureMeta('apple-mobile-web-app-capable', 'yes');
    ensureMeta('apple-mobile-web-app-status-bar-style', 'default');
    if ('serviceWorker' in navigator && window.isSecureContext) {
      const dev = process.env.NODE_ENV !== 'production';
      navigator.serviceWorker.register(dev ? '/sw.js?dev=1' : '/sw.js', { scope: '/' }).catch(() => {});
    }
  }, []);
  useEffect(() => {
    if (themeColor) ensureMeta('theme-color', themeColor);
    if (appName) ensureMeta('apple-mobile-web-app-title', appName);
  }, [themeColor, appName]);
}

/** Whether the app can be installed here, and a function that starts it. */
export function useInstall() {
  const [, force] = useState(0);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    setStandalone(isStandalone());
    setIos(isIos());
    return () => {
      listeners.delete(l);
    };
  }, []);
  const install = useCallback(async () => {
    if (!deferred) return 'unavailable' as const;
    const e = deferred;
    await e.prompt();
    const { outcome } = await e.userChoice;
    deferred = null;
    notify();
    return outcome;
  }, []);
  return {
    /** The browser offered an install prompt (Chrome, Edge, Android). */
    canPrompt: !!deferred && !standalone,
    /** iOS Safari: show "Add to Home Screen" steps instead. */
    needsIosSteps: ios && !standalone,
    installed: standalone,
    install,
  };
}
