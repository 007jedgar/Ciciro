import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/anthropic")>()),
  hasAnthropicKey: () => true,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/tokens";
import {
  AI_LIMIT_CODE,
  AiLimitError,
  getEntitlement,
  meterAiRun,
  usagePeriod,
  withAiRun,
} from "@/lib/entitlements";
import { summarizeChapter } from "@/lib/summarize";
import { POST as chat } from "@/app/api/chat/route";
import { POST as autowrite } from "@/app/api/autowrite/route";
import { POST as correct } from "@/app/api/correct/route";
import { POST as stuck } from "@/app/api/projects/[id]/stuck/route";
import { POST as continuity } from "@/app/api/projects/[id]/continuity-check/route";
import { POST as weeklyReview } from "@/app/api/projects/[id]/weekly-reviews/route";
import { POST as styleAnalysis } from "@/app/api/projects/[id]/style-analysis/route";
import { POST as reminderNudge } from "@/app/api/projects/[id]/reminder-nudge/route";
import { GET as recap } from "@/app/api/projects/[id]/recap/route";
import { GET as me } from "@/app/api/auth/me/route";
import { wipeDatabase } from "./account-fixture";
import { saveBillingEnv } from "./helpers/fake-billing";

const LIMIT = 3;
const PROSE = "<p>" + "The tide came in over the stones and Mara watched it rise. ".repeat(80) + "</p>";

async function author(label: string) {
  const user = await prisma.user.create({
    data: { email: `${label}@example.com`, name: label, passwordHash: "" },
  });
  const token = `${label}-token`;
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const project = await prisma.project.create({ data: { userId: user.id, title: "Tides" } });
  const chapter = await prisma.chapter.create({ data: { projectId: project.id, title: "One", order: 0, content: PROSE } });
  const publicUser = { id: user.id, email: user.email, name: user.name };
  return { user: publicUser, token, projectId: project.id, chapterId: chapter.id };
}

type Author = Awaited<ReturnType<typeof author>>;

async function useUp(a: Author, runs = LIMIT) {
  await prisma.usageCounter.create({ data: { userId: a.user.id, period: usagePeriod(), aiRuns: runs } });
}

async function runsUsed(a: Author) {
  return (await getEntitlement(a.user.id)).usage.aiRuns;
}

function request(path: string, token: string, body?: unknown, method = "POST") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", [SESSION_HEADER]: token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function expectLimit(res: Response) {
  expect(res.status).toBe(402);
  const body = await res.json();
  expect(body.code).toBe(AI_LIMIT_CODE);
  expect(body.entitlement).toMatchObject({ plan: "free", limits: { aiRunsPerMonth: LIMIT } });
  return body;
}

function reply(text: string) {
  mocks.create.mockResolvedValueOnce({ content: [{ type: "text", text }], stop_reason: "end_turn" });
}

describe("AI gating and metering", () => {
  let restoreEnv: () => void;

  beforeEach(async () => {
    restoreEnv = saveBillingEnv();
    process.env.CICIRO_REQUIRE_AUTH = "true";
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.CICIRO_FREE_AI_RUNS_PER_MONTH = String(LIMIT);
    await wipeDatabase();
    mocks.create.mockReset();
  });
  afterEach(() => restoreEnv());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("meterAiRun", () => {
    it("counts each action and refuses the one past the allowance", async () => {
      const a = await author("meter");
      for (let i = 0; i < LIMIT; i++) await meterAiRun(a.user);
      expect(await runsUsed(a)).toBe(LIMIT);
      await expect(meterAiRun(a.user)).rejects.toBeInstanceOf(AiLimitError);
      expect(await runsUsed(a)).toBe(LIMIT);
    });

    it("never overdraws under concurrent requests", async () => {
      const a = await author("race");
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => meterAiRun(a.user)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(LIMIT);
      expect(await runsUsed(a)).toBe(LIMIT);
    });

    it("gives Pro its own allowance", async () => {
      const a = await author("pro");
      await prisma.subscription.create({
        data: { userId: a.user.id, source: "stripe", externalId: "sub_pro", status: "active" },
      });
      await useUp(a);
      await meterAiRun(a.user);
      expect(await runsUsed(a)).toBe(LIMIT + 1);
    });

    it("refunds an action that failed", async () => {
      const a = await author("refund");
      await expect(withAiRun(a.user, async () => Promise.reject(new Error("model down")))).rejects.toThrow();
      expect(await runsUsed(a)).toBe(0);
      await withAiRun(a.user, async () => "ok");
      expect(await runsUsed(a)).toBe(1);
    });

    it("starts a new allowance each month", async () => {
      const a = await author("month");
      await prisma.usageCounter.create({ data: { userId: a.user.id, period: "2000-01", aiRuns: 99 } });
      await meterAiRun(a.user);
      expect(await runsUsed(a)).toBe(1);
    });

    it("does not meter self-hosted use", async () => {
      delete process.env.CICIRO_REQUIRE_AUTH;
      const a = await author("local");
      await useUp(a, 50);
      await meterAiRun(a.user);
      expect(await prisma.usageCounter.findFirstOrThrow({ where: { userId: a.user.id } })).toMatchObject({ aiRuns: 50 });
    });
  });

  describe("author-initiated AI answers 402 once the allowance is gone", () => {
    it("chat: a new message is refused, and nothing reaches the model", async () => {
      const a = await author("chat");
      await useUp(a);
      await expectLimit(await chat(request("/api/chat", a.token, { projectId: a.projectId, message: "Hello" })));
      expect(await prisma.editorRun.count()).toBe(0);
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it("chat: resuming a turn already paid for is not charged", async () => {
      const a = await author("resume");
      await useUp(a);
      const res = await chat(request("/api/chat", a.token, { projectId: a.projectId, resumeTurnId: "t-missing" }));
      expect(res.status).toBe(404);
      expect(await runsUsed(a)).toBe(LIMIT);
    });

    it("chat: compacting needs AI left", async () => {
      const a = await author("compact");
      await useUp(a);
      await expectLimit(await chat(request("/api/chat", a.token, { projectId: a.projectId, compactOnly: true })));
    });

    it("autowrite", async () => {
      const a = await author("autowrite");
      await useUp(a);
      await expectLimit(
        await autowrite(request("/api/autowrite", a.token, { projectId: a.projectId, chapterId: a.chapterId }))
      );
    });

    it("stuck prompts: charged on success, refunded on failure, refused at the limit", async () => {
      const a = await author("stuck");
      reply('["Let Mara see the boat.", "Cut to the harbor."]');
      const ok = await stuck(request(`/api/projects/${a.projectId}/stuck`, a.token, {}), ctx(a.projectId));
      expect(ok.status).toBe(200);
      expect(await runsUsed(a)).toBe(1);

      mocks.create.mockRejectedValueOnce(new Error("overloaded"));
      const failed = await stuck(request(`/api/projects/${a.projectId}/stuck`, a.token, {}), ctx(a.projectId));
      expect(failed.status).toBe(502);
      expect(await runsUsed(a)).toBe(1);

      await prisma.usageCounter.updateMany({ where: { userId: a.user.id }, data: { aiRuns: LIMIT } });
      await expectLimit(await stuck(request(`/api/projects/${a.projectId}/stuck`, a.token, {}), ctx(a.projectId)));
    });

    it("continuity check, weekly review and style analysis", async () => {
      const a = await author("checks");
      await useUp(a);
      await expectLimit(
        await continuity(
          request(`/api/projects/${a.projectId}/continuity-check`, a.token, { chapterId: a.chapterId }),
          ctx(a.projectId)
        )
      );
      await expectLimit(
        await weeklyReview(request(`/api/projects/${a.projectId}/weekly-reviews`, a.token, {}), ctx(a.projectId))
      );
      await expectLimit(
        await styleAnalysis(request(`/api/projects/${a.projectId}/style-analysis`, a.token, {}), ctx(a.projectId))
      );
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it("a request that fails validation is not charged", async () => {
      const a = await author("invalid");
      const res = await continuity(
        request(`/api/projects/${a.projectId}/continuity-check`, a.token, {}),
        ctx(a.projectId)
      );
      expect(res.status).toBe(400);
      expect(await runsUsed(a)).toBe(0);
    });
  });

  describe("background AI is free but stops at the limit", () => {
    it("spelling returns no spans without calling the model", async () => {
      const a = await author("spell");
      await useUp(a);
      const res = await correct(
        request("/api/correct", a.token, { chapterId: a.chapterId, blockId: "b1", text: "Thier going.", revision: 1 })
      );
      expect(res.status).toBe(200);
      expect((await res.json()).spans).toEqual([]);
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it("spelling under the limit is not charged", async () => {
      const a = await author("spellfree");
      reply("[]");
      await correct(
        request("/api/correct", a.token, { chapterId: a.chapterId, blockId: "b1", text: "Thier going.", revision: 1 })
      );
      expect(mocks.create).toHaveBeenCalledTimes(1);
      expect(await runsUsed(a)).toBe(0);
    });

    it("summaries, recaps and reminder nudges skip the model", async () => {
      const a = await author("background");
      await useUp(a);
      await summarizeChapter(a.chapterId, a.user);
      const recapRes = await recap(request(`/api/projects/${a.projectId}/recap`, a.token, undefined, "GET"), ctx(a.projectId));
      expect(recapRes.status).toBe(200);
      expect(await recapRes.json()).toEqual({ recap: null });
      await prisma.readingPosition.create({
        data: { userId: a.user.id, projectId: a.projectId, chapterId: a.chapterId, blockId: "", offset: 10 },
      });
      const nudge = await reminderNudge(
        request(`/api/projects/${a.projectId}/reminder-nudge`, a.token, {}),
        ctx(a.projectId)
      );
      expect(await nudge.json()).toEqual({ body: null });
      expect(mocks.create).not.toHaveBeenCalled();
    });
  });

  it("/api/auth/me reports the plan and this month's usage", async () => {
    const a = await author("me");
    await useUp(a, 2);
    const res = await me(request("/api/auth/me", a.token, undefined, "GET"));
    const body = await res.json();
    expect(body.entitlement).toMatchObject({
      plan: "free",
      metered: true,
      usage: { period: usagePeriod(), aiRuns: 2 },
      limits: { aiRunsPerMonth: LIMIT },
      billing: { web: false, store: false },
    });
  });
});
