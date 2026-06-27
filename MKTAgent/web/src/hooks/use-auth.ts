// Auth state = "can /auth/me succeed with the current cookie?". No token handling
// in the browser at all (BFF model) — the cookie is HttpOnly + invisible to JS.
import { useCallback, useEffect, useState } from 'react';
import { api, UnauthorizedError } from '../api/client';
import type { Me } from '../api/client';

export interface AuthState {
  loading: boolean;
  user: Me | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.me();
      setUser(r.ok ? r.data : null);
    } catch (e) {
      if (e instanceof UnauthorizedError) setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { loading, user, refresh, logout };
}
