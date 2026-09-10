import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, ciciro, queryClient } from "./api";
import { hydrateSessionToken, setSessionToken } from "./session-store";
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await ciciro.auth.me();
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrateSessionToken();
      if (cancelled) return;
      await refresh();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await ciciro.auth.login({ email, password });
    setUser(data.user);
    return data.user;
  }, []);

  const signup = useCallback(
    async (input: { email: string; password: string; name?: string }) => {
      const data = await ciciro.auth.signup(input);
      setUser(data.user);
      return data.user;
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
    setUser(null);
    queryClient.clear();
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
