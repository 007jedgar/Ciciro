import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, ciciro, clearPersistedQueryCache, queryClient } from "./api";
import {
  getCachedUser,
  hydrateSessionToken,
  setCachedUser,
  setSessionToken,
} from "./session-store";
import type { PublicUser } from "./types";

type SessionState = {
  user: PublicUser | null;
  ready: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<PublicUser>;
  signup: (input: { email: string; password: string; name?: string }) => Promise<PublicUser>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

function rememberUser(user: PublicUser | null): void {
  setCachedUser(user);
}

function beginAccount(user: PublicUser, token?: string): PublicUser {
  if (token) setSessionToken(token);
  queryClient.clear();
  clearPersistedQueryCache();
  rememberUser(user);
  return user;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await ciciro.auth.me();
      if (data.user) {
        setUser(data.user);
        rememberUser(data.user);
        return;
      }
      setSessionToken(null);
      rememberUser(null);
      setUser(null);
      queryClient.clear();
      clearPersistedQueryCache();
    } catch {
      // Keep the cached session across Metro reloads and API process restarts.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await hydrateSessionToken();
      if (cancelled) return;
      if (token) {
        const cached = getCachedUser();
        if (cached) {
          setUser(cached);
          setReady(true);
        }
      } else {
        setReady(true);
      }
      await refresh();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await ciciro.auth.login({ email, password });
    const next = beginAccount(data.user, data.token);
    setUser(next);
    return next;
  }, []);

  const signup = useCallback(
    async (input: { email: string; password: string; name?: string }) => {
      const data = await ciciro.auth.signup(input);
      const next = beginAccount(data.user, data.token);
      setUser(next);
      return next;
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await ciciro.auth.logout();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
    setSessionToken(null);
    rememberUser(null);
    setUser(null);
    queryClient.clear();
    clearPersistedQueryCache();
  }, []);

  const value = useMemo(
    () => ({ user, ready, refresh, login, signup, logout }),
    [user, ready, refresh, login, signup, logout]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
