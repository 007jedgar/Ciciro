import { prisma } from "@/lib/db";

// Per-category opt-out for server-sent push. Unlike EmailPreference there is
// no separate consent gate: OS notification permission plus a registered
// PushToken (src/lib/push/tokens.ts) already gate delivery, so a missing row
// means every category is on — the same value the schema's column defaults
// give an existing row nobody has touched. See prisma/schema.prisma's
// PushPreference and docs/mobile-release.md#push-notifications.

export const PUSH_CATEGORIES = ["shareComments", "writingNudge", "chatFinished"] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

export type PushPreferenceRow = {
  userId: string;
  shareComments: boolean;
  writingNudge: boolean;
  chatFinished: boolean;
};

const DEFAULTS: Omit<PushPreferenceRow, "userId"> = {
  shareComments: true,
  writingNudge: true,
  chatFinished: true,
};

/** A user's row, or the all-on defaults a missing row implies. */
export async function getPushPreference(userId: string): Promise<PushPreferenceRow> {
  const row = await prisma.pushPreference.findUnique({ where: { userId } });
  return row ?? { userId, ...DEFAULTS };
}

/** Settings: change one or more categories. Implicitly creates the row. */
export async function updatePushPreference(
  userId: string,
  patch: Partial<Record<PushCategory, boolean>>
): Promise<PushPreferenceRow> {
  const row = await prisma.pushPreference.upsert({
    where: { userId },
    create: { userId, ...DEFAULTS, ...patch },
    update: patch,
  });
  return row;
}

/** Whether `category` may be pushed to this user right now. */
export async function pushCategoryEnabled(userId: string, category: PushCategory): Promise<boolean> {
  const pref = await getPushPreference(userId);
  return pref[category];
}
