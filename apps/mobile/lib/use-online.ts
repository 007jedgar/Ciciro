import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

/**
 * Whether the phone has a connection, from the same signal the API cache uses
 * (NetInfo, wired in `installQueryNetworkListeners`), so a screen and the
 * queries beside it agree on offline.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true
  );
}
