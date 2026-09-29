import { createContext, useContext } from "react";
import type { DeleteAccountRequest, PublicUser } from "./api/types";

export type SessionState = {
  user: PublicUser | null;
  ready: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<PublicUser>;
  signup: (input: { email: string; password: string; name?: string }) => Promise<PublicUser>;
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
