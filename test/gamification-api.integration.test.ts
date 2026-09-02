import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

import { createSession, registerUser } from "@/lib/auth/session";
import { GET as getGoals, PATCH as patchGoals } from "@/app/api/gamification/goals/route";
import { GET as getToday } from "@/app/api/gamification/today/route";
import { POST as postHeartbeat } from "@/app/api/gamification/heartbeat/route";

async function wipe() {
  cookieJar.clear();
  await prisma.creditTransaction.deleteMany();
  await prisma.writingDayStat.deleteMany();
  await prisma.streakState.deleteMany();
  await prisma.writingPrefs.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

describe("gamification API routes", () => {
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it("returns 401 when no session user is present", async () => {
    const res = await getGoals();
    expect(res.status).toBe(401);
    const today = await getToday();
    expect(today.status).toBe(401);
    const beat = await postHeartbeat(
      new NextRequest("http://localhost/api/gamification/heartbeat", {
        method: "POST",
        body: JSON.stringify({ wrote: true }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(beat.status).toBe(401);
  });

  it("reads and patches goals for the signed-in user", async () => {
    const user = await registerUser({
      email: "api-goals@example.com",
      password: "long-enough-pw",
    });
    await createSession(user.id);

    const initial = await getGoals();
    expect(initial.status).toBe(200);
    const body = await initial.json();
    expect(body.dailyProseTarget).toBe(500);
    expect(body.reminderCadence).toBe("daily");

    const bad = await patchGoals(
      new NextRequest("http://localhost/api/gamification/goals", {
        method: "PATCH",
        body: JSON.stringify({ dailyProseTarget: 0 }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(bad.status).toBe(400);

    const ok = await patchGoals(
      new NextRequest("http://localhost/api/gamification/goals", {
        method: "PATCH",
        body: JSON.stringify({
          dailyProseTarget: 250,
          reminderCadence: "custom",
          reminderWeekdays: [2, 4],
          quietHoursStart: "21:30",
        }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(ok.status).toBe(200);
    const patched = await ok.json();
    expect(patched.dailyProseTarget).toBe(250);
    expect(patched.reminderWeekdays).toEqual([2, 4]);
    expect(patched.quietHoursStart).toBe("21:30");
  });

  it("heartbeats chair time into today's snapshot", async () => {
    const user = await registerUser({
      email: "api-beat@example.com",
      password: "long-enough-pw",
    });
    await createSession(user.id);

    const res = await postHeartbeat(
      new NextRequest("http://localhost/api/gamification/heartbeat", {
        method: "POST",
        body: JSON.stringify({ chairSeconds: 120, wrote: true, timezone: "UTC" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    const today = await res.json();
    expect(today.rings.return.closed).toBe(true);
    expect(today.buckets.chairMinutes).toBe(2);
    expect(today.credits.balance).toBe(202);

    const snapshot = await getToday();
    expect(snapshot.status).toBe(200);
    const again = await snapshot.json();
    expect(again.credits.balance).toBe(202);
    expect(again.streak.current).toBe(1);
  });

  it("does not expose a public credit grant cheat endpoint", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(existsSync(join(process.cwd(), "src/app/api/gamification/credits/grant/route.ts"))).toBe(
      false
    );
  });
});
