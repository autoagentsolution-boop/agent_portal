import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiClient, extractErrorMessage } from '../lib/api-client';
import type { SessionResponse, User } from '../lib/types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchSession(): Promise<User | null> {
  try {
    const res = await apiClient.get<SessionResponse>('/auth/get-session');
    return res.data?.user ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const u = await fetchSession();
    setUser(u);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const u = await fetchSession();
      if (!cancelled) {
        setUser(u);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      await apiClient.post('/auth/sign-in/email', { email, password });
      await refresh();
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Sign-in failed'));
    }
  }, [refresh]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    try {
      await apiClient.post('/auth/sign-up/email', { name, email, password });
      await refresh();
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Sign-up failed'));
    }
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/sign-out', {});
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
