import { useEffect } from "react";
import { usePathname } from "expo-router";
import { rememberPathname } from "../lib/last-place";
import { useSession } from "../lib/session";

/** Watches the current route and persists last screen + last manuscript. */
export function LastPlaceTracker() {
  const pathname = usePathname();
  const { user, ready } = useSession();

  useEffect(() => {
    if (!ready || !user) return;
    rememberPathname(pathname, user.id);
  }, [pathname, ready, user]);

  return null;
}
