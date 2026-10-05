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

const user = { id: "u1", email: "ada@example.com", name: "Ada", hasPassword: true, emailVerified: true };
const body = {
  chapterId: "c1",
  blockId: "b1",
  text: "Their going home.",
  revision: 4,
};

function haikuText(text: string) {
  return { content: [{ type: "text", text }] };
}

function fixes(...list: Array<[string, string]>) {
  return JSON.stringify({
    fixes: list.map(([original, replacement]) => ({ original, replacement })),
  });
}

function applied(text: string, raw: string) {
  let next = text;
  for (const span of parseCorrectionSpans(raw, text).reverse()) {
    next = `${next.slice(0, span.start)}${span.replacement}${next.slice(span.end)}`;
  }
  return next;
}

describe("parseCorrectionSpans", () => {
  it("finds each quoted fix in the block instead of trusting model offsets", () => {
    // Haiku returned {"start":40,"end":44} ("d si") for this block in production.
    const text = "The rain fell softly on the roof and I'dd sing for you";
    const raw = JSON.stringify({
      fixes: [{ original: "I'dd", replacement: "I'd", start: 40, end: 44 }],
    });
    expect(parseCorrectionSpans(raw, text)).toEqual([{ start: 37, end: 41, replacement: "I'd" }]);
    expect(applied(text, raw)).toBe("The rain fell softly on the roof and I'd sing for you");
  });

  it("never takes the space after a fix", () => {
    const text = "I'dd sing for you";
    expect(applied(text, fixes(["I'dd ", "I'd"]))).toBe("I'd sing for you");
    expect(applied(text, fixes(["I'dd", "I'd "]))).toBe("I'd sing for you");
    expect(applied(text, fixes([" I'dd", "I'd"]))).toBe(text);
    expect(parseCorrectionSpans(fixes(["I'dd ", "I'd"]), text)).toEqual([
      { start: 0, end: 4, replacement: "I'd" },
    ]);
  });

  it("matches the curly apostrophes the phone keyboard types, and keeps them", () => {
    const text = "He said that I’dd sing for you tonight.";
    expect(parseCorrectionSpans(fixes(["I'dd", "I'd"]), text)).toEqual([
      { start: 13, end: 17, replacement: "I’d" },
    ]);
    expect(applied("It's a dog thats barking.", fixes(["thats", "that's"]))).toBe(
      "It's a dog that's barking."
    );
  });

  it("narrows a fix quoted with context to the words that change", () => {
    const text = "Its a long way, and its owner knows it.";
    expect(parseCorrectionSpans(fixes(["Its a", "It's a"]), text)).toEqual([
      { start: 0, end: 3, replacement: "It's" },
    ]);
    expect(applied("I going home.", fixes(["I going", "I am going"]))).toBe("I am going home.");
    expect(applied("the  dog", fixes(["the  dog", "the dog"]))).toBe("the dog");
    expect(applied("I went to the the market.", fixes(["the the", "the"]))).toBe(
      "I went to the market."
    );
    expect(applied("I went to the the market.", fixes(["the ", ""]))).toBe("I went to the market.");
    expect(applied("I went to the the market.", fixes(["the", ""]))).toBe("I went to the market.");
    expect(applied("I went home home", fixes(["home home", "home"]))).toBe("I went home");
    expect(applied("It was really very good.", fixes(["very", ""]))).toBe("It was really good.");
    expect(applied("I went home home", fixes([" home", ""]))).toBe("I went home");
    expect(applied("She smiled, and left.", fixes([",", ""]))).toBe("She smiled and left.");
    expect(applied("Very good.", fixes(["Very", ""]))).toBe("good.");
  });

  it.each([
    [
      "He said that I’dd sing for you tonight.",
      fixes(["I'dd", "I'd"]),
      "He said that I’d sing for you tonight.",
    ],
    [
      "Its a long way, and its owner knows it's tail is wagging.",
      fixes(["Its a", "It's a"], ["it's tail", "its tail"]),
      "It's a long way, and its owner knows its tail is wagging.",
    ],
    [
      "I going to the the market tomorow, and then I’ll come home.",
      fixes(["I going", "I'm going"], ["the the", "the"], ["tomorow", "tomorrow"]),
      "I'm going to the market tomorrow, and then I’ll come home.",
    ],
  ])("applies Haiku's quoted fixes to %j cleanly", (text, raw, expected) => {
    expect(applied(text, raw)).toBe(expected);
  });

  it("finds repeated quotes in reading order", () => {
    const text = "teh cat saw teh dog.";
    expect(parseCorrectionSpans(fixes(["teh", "the"], ["teh", "the"]), text)).toEqual([
      { start: 0, end: 3, replacement: "the" },
      { start: 12, end: 15, replacement: "the" },
    ]);
  });

  it("drops quotes that are not in the block, unchanged fixes, and overlaps", () => {
    const text = "Their going home.";
    expect(
      parseCorrectionSpans(
        fixes(
          ["Their going", "They're going"],
          ["Their", "There"],
          ["Thier", "Their"],
          ["home", "home"]
        ),
        text
      )
    ).toEqual([{ start: 0, end: 5, replacement: "They're" }]);
    expect(
      parseCorrectionSpans(
        JSON.stringify({
          spans: [{ start: 0, end: 5, replacement: "They're" }],
        }),
        text
      )
    ).toEqual([]);
  });

  it("reads fenced JSON and bare arrays", () => {
    const text = "Its fine.";
    expect(
      parseCorrectionSpans(
        '```json\n{"fixes":[{"original":"Its","replacement":"It\'s"}]}\n```',
        text
      )
    ).toEqual([{ start: 0, end: 3, replacement: "It's" }]);
    expect(parseCorrectionSpans('[{"original":"Its","replacement":"It\'s"}]', text)).toEqual([
      { start: 0, end: 3, replacement: "It's" },
    ]);
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
    mocks.create.mockResolvedValueOnce(haikuText(fixes(["Their", "They're"])));
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
