'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, tokens } from './api';
import type { Me } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; organizationName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    if (!tokens.access) {
      setMe(null);
      return;
    }
    try {
      setMe(await api<Me>('/auth/me'));
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    loadMe().finally(() => setLoading(false));
  }, [loadMe]);

  // Tokens are shared across tabs (localStorage). If another tab switches workspace or
  // signs out, follow it here instead of showing one workspace's data with another's token.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'eril.accessToken') return;
      if (!e.newValue) {
        setMe(null);
        // Embedded widgets (/w/…) aren't part of the signed-in app.
        if (!location.pathname.startsWith('/login') && !location.pathname.startsWith('/w/')) location.href = '/login';
        return;
      }
      try {
        const payload = JSON.parse(atob(e.newValue.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (me && payload.currentWorkspaceId !== me.currentWorkspaceId) location.reload();
      } catch {
        /* malformed token: the next API call will sort it out */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [me]);

  const accept = async (res: { accessToken: string; refreshToken: string }) => {
    tokens.set(res.accessToken, res.refreshToken);
    await loadMe();
  };

  const value: AuthState = {
    me,
    loading,
    login: async (email, password) =>
      accept(await api('/auth/login', { method: 'POST', body: { email, password }, auth: false })),
    register: async (input) =>
      accept(await api('/auth/register', { method: 'POST', body: input, auth: false })),
    logout: async () => {
      const refreshToken = tokens.refresh;
      try {
        if (refreshToken) await api('/auth/logout', { method: 'POST', body: { refreshToken } });
      } catch {
        /* token may already be expired */
      }
      tokens.clear();
      setMe(null);
    },
    switchWorkspace: async (workspaceId) =>
      accept(await api('/auth/switch-workspace', { method: 'POST', body: { workspaceId } })),
    can: (p) => !!me?.permissions?.includes(p),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
