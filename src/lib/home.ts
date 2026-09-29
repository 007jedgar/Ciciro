import { authRequired } from "@/lib/auth/constants";
import { getSessionUser } from "@/lib/auth/session";

/**
 * What `/` shows: the library for anyone who can use it (local single-author
 * mode, or a hosted visitor with a valid session), the landing page for
 * everyone else. The session is validated here rather than trusted from the
 * middleware's cookie-presence gate, so a stale cookie gets the landing page
 * instead of an empty library whose API calls all 401.
 */
export async function homeShowsLibrary(): Promise<boolean> {
  if (!authRequired()) return true;
  const user = await getSessionUser().catch(() => null);
  return user !== null;
}
