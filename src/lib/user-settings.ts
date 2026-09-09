import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth/session";
import {
  applyPatch,
  normalizeSettings,
  parseSettingsJson,
  parseSettingsPatch,
  pickNewer,
  type AppSettings,
  type SettingsPatch,
} from "@/lib/settings";

export async function getUserSettings(userId: string): Promise<AppSettings> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { settingsJson: true, settingsUpdatedAt: true },
  });
  if (!row) throw new AuthError("Not found.", 404);
  return parseSettingsJson(row.settingsJson, row.settingsUpdatedAt);
}

export async function updateUserSettings(
  userId: string,
  body: unknown
): Promise<AppSettings> {
  const parsed = parseSettingsPatch(body);
  if ("error" in parsed) throw new AuthError(parsed.error, 400);
  const patch = parsed as SettingsPatch;
  if (Object.keys(patch).length === 0) {
    throw new AuthError("No settings fields to update.", 400);
  }
  const current = await getUserSettings(userId);
  const next = applyPatch(current, patch);
  return persistSettings(userId, next);
}

export async function persistSettings(
  userId: string,
  settings: AppSettings
): Promise<AppSettings> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      settingsJson: JSON.stringify(settings),
      settingsUpdatedAt: new Date(settings.updatedAt),
    },
  });
  return settings;
}

/** Last-write-wins replace. Requires `updatedAt` so an empty PUT cannot wipe prefs. */
export async function replaceUserSettings(
  userId: string,
  body: unknown
): Promise<AppSettings> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AuthError("Expected a settings object.", 400);
  }
  const src = body as Record<string, unknown>;
  if (typeof src.updatedAt !== "string" || !Number.isFinite(Date.parse(src.updatedAt))) {
    throw new AuthError("updatedAt is required.", 400);
  }
  const incoming = normalizeSettings(body);
  const current = await getUserSettings(userId);
  return persistSettings(userId, pickNewer(current, incoming));
}
