import type { ReactNode } from "react";
import { useForceUpdateGate } from "../lib/force-update";
import { ForceUpdateScreen } from "./ForceUpdateScreen";

/**
 * Replaces the whole app with ForceUpdateScreen once the installed build is
 * below the server's minimum - nothing underneath mounts, so there is no
 * screen to navigate around. See app/_layout.tsx.
 */
export function ForceUpdateGate({ children }: { children: ReactNode }) {
  const blocked = useForceUpdateGate();
  if (blocked) return <ForceUpdateScreen />;
  return <>{children}</>;
}
