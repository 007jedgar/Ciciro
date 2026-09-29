import type { PushTokenRegisterRequest, PushTokenUnregisterRequest } from "./api/types";

// Keeps the server's record of this phone's Expo push token in step with the
// author's notification permission. It never asks for permission: the
// writing-reminder screens do that, and this only follows what the author
// chose. Granted means the phone registers; revoked means it unregisters.
// Signing out drops the token on the server with the session. See
// docs/mobile-release.md#push-notifications.

export type PushPermission = "granted" | "denied" | "undetermined";

/** What was last registered from this phone, so a relaunch does not POST again. */
export type PushRegistrationRecord = { userId: string; token: string; at: number };

export type PushRegistrationDeps = {
  platform: PushTokenRegisterRequest["platform"];
  getPermission(): Promise<PushPermission>;
  /** The Expo push token. Throws when there is none (offline, no APNs). */
  getToken(): Promise<string>;
  register(body: PushTokenRegisterRequest): Promise<unknown>;
  unregister(body: PushTokenUnregisterRequest): Promise<unknown>;
  load(): PushRegistrationRecord | null;
  save(record: PushRegistrationRecord | null): void;
};

/** Re-register at most daily, which heals a server record lost or moved meanwhile. */
export const PUSH_REFRESH_MS = 24 * 60 * 60 * 1000;

export type PushSyncResult = "registered" | "unchanged" | "unregistered" | "skipped";

export async function syncPushRegistration(
  userId: string,
  deps: PushRegistrationDeps,
  options: { force?: boolean; now?: number } = {}
): Promise<PushSyncResult> {
  const now = options.now ?? Date.now();
  const record = deps.load();
  let permission: PushPermission;
  try {
    permission = await deps.getPermission();
  } catch {
    return "skipped";
  }

  if (permission !== "granted") {
    if (!record) return "skipped";
    if (record.userId === userId) {
      try {
        await deps.unregister({ token: record.token });
      } catch {
        return "skipped"; // try again on the next foreground
      }
    }
    deps.save(null);
    return "unregistered";
  }

  let token: string;
  try {
    token = await deps.getToken();
  } catch {
    return "skipped";
  }
  const fresh =
    record?.userId === userId && record.token === token && now - record.at < PUSH_REFRESH_MS;
  if (fresh && !options.force) return "unchanged";
  try {
    await deps.register({ token, platform: deps.platform });
  } catch {
    return "skipped";
  }
  deps.save({ userId, token, at: now });
  return "registered";
}

export function parsePushRecord(raw: string | undefined): PushRegistrationRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PushRegistrationRecord>;
    if (typeof value.userId !== "string" || typeof value.token !== "string") return null;
    return { userId: value.userId, token: value.token, at: typeof value.at === "number" ? value.at : 0 };
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

/** Ask the mounted PushRegistrationSync to check now (the author just answered a permission prompt). */
export function requestPushRegistrationSync(): void {
  for (const listener of listeners) listener();
}

export function subscribePushRegistrationSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
