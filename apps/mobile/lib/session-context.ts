import { createContext, useContext } from "react";
import type { DeleteAccountRequest, PublicUser } from "./api/types";
import type { BrowserProvider } from "./social-auth";

export type SessionState = {
  user: PublicUser | null;
  ready: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<PublicUser>;
  signup: (input: { email: string; password: string; name?: string }) => Promise<PublicUser>;
  /** The iOS Sign in with Apple sheet. Null when the person backs out. */
  signInWithApple: () => Promise<PublicUser | null>;
  /** Apple or Google in a system browser. Null when the person backs out. */
  signInWithBrowser: (provider: BrowserProvider) => Promise<PublicUser | null>;
  logout: () => Promise<void>;
  /** Delete the account on the server, then forget it on this phone. Throws ApiError. */
  deleteAccount: (proof: DeleteAccountRequest) => Promise<void>;
};

/** Leaf module so Metro/inline-requires cannot split provider and consumer. */
export const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
