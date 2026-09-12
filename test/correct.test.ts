import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  hasKey: true,
  autoCorrect: true,
  authorize: vi.fn(),
}));

vi.mock("@/lib/anthropic", () => ({
  DRAFTER_FAST_MODEL: "claude-haiku-4-5",
  hasAnthropicKey: () => mocks.hasKey,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

vi.mock("@/lib/user-settings", () => ({
  getUserSettings: vi.fn(async () => ({
    theme: "parchment",
    editorFont: "serif",
    editorFontSize: 19,
    autoCorrect: mocks.autoCorrect,
    reduceMotion: false,
    chatWidth: 380,
    updatedAt: "2026-01-01T00:00:00.000Z",
  })),
}));

vi.mock("@/lib/auth/access", () => ({
  authorizeOwnedChapter: (...args: unknown[]) => mocks.authorize(...args),
}));

import { AuthError } from "@/lib/auth/session";
import { correctBlock, parseCorrectBody, parseCorrectionSpans } from "@/lib/correct";

const user = { id: "u1", email: "ada@example.com", name: "Ada" };
const body = {
  chapterId: "c1",
  blockId: "b1",
  text: "Their going home.",
  revision: 4,
};

function haikuText(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("parseCorrectionSpans", () => {
  it("keeps in-bounds replacements and drops overlaps", () => {
    const text = "Their going home.";
    expect(
      parseCorrectionSpans(
        JSON.stringify({
          spans: [
            { start: 0, end: 5, replacement: "They're" },
            { start: 2, end: 8, replacement: "skip" },
            { start: 0, end: 5, replacement: "Their" },
            { start: -1, end: 2, replacement: "x" },
          ],
        }),
        text
      )
    ).toEqual([{ start: 0, end: 5, replacement: "They're" }]);
  });

  it("reads fenced JSON and bare objects", () => {
    const text = "Its fine.";
    expect(
      parseCorrectionSpans('```json\n{"spans":[{"start":0,"end":3,"replacement":"It\'s"}]}\n```', text)
    ).toEqual([{ start: 0, end: 3, replacement: "It's" }]);
    expect(parseCorrectionSpans("not json", text)).toEqual([]);
  });
});

describe("correctBlock", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.authorize.mockReset();
    mocks.authorize.mockResolvedValue({ id: "c1", projectId: "p1" });
    mocks.hasKey = true;
    mocks.autoCorrect = true;
  });

  it("returns Haiku spans from a mocked model", async () => {
    mocks.create.mockResolvedValueOnce(
      haikuText(JSON.stringify({ spans: [{ start: 0, end: 5, replacement: "They're" }] }))
    );
    await expect(correctBlock(user, body)).resolves.toEqual({
      ...body,
      spans: [{ start: 0, end: 5, replacement: "They're" }],
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0].model).toBe("claude-haiku-4-5");
    expect(mocks.authorize).toHaveBeenCalledWith("c1", user);
  });

  it("is a no-op when autoCorrect is off", async () => {
    mocks.autoCorrect = false;
    await expect(correctBlock(user, body)).resolves.toEqual({ ...body, spans: [] });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("fails soft when the model throws", async () => {
    mocks.create.mockRejectedValueOnce(new Error("haiku down"));
    await expect(correctBlock(user, body)).resolves.toEqual({ ...body, spans: [] });
  });

  it("rejects a bad body and missing auth", async () => {
    expect(parseCorrectBody({})).toEqual({ error: "chapterId required." });
    await expect(correctBlock(null, body)).rejects.toBeInstanceOf(AuthError);
    mocks.authorize.mockRejectedValueOnce(new AuthError("Not found.", 404));
    await expect(correctBlock(user, body)).rejects.toMatchObject({ status: 404 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
