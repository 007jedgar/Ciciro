import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  hasKey: true,
  allowed: true,
}));

vi.mock("@/lib/anthropic", () => ({
  DRAFTER_FAST_MODEL: "claude-haiku-4-5",
  hasAnthropicKey: () => mocks.hasKey,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

vi.mock("@/lib/entitlements", () => ({
  aiAllowed: vi.fn(async () => mocks.allowed),
}));

import { AuthError } from "@/lib/auth/session";
import { parseSynonyms, parseSynonymsBody, synonymsFor } from "@/lib/synonyms";

const user = { id: "u1", email: "ada@example.com", name: "Ada", hasPassword: true, emailVerified: true };
const body = { word: "country", before: "She did not care about the ", after: "." };

function haikuText(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("parseSynonyms", () => {
  it("keeps plain words and short phrases in the model's order", () => {
    const raw = JSON.stringify({ synonyms: ["homeland", "nation", "native land", "state"] });
    expect(parseSynonyms(raw, "country")).toEqual(["homeland", "nation", "native land", "state"]);
  });

  it("drops the word itself, repeats, long phrases and anything that is not a word", () => {
    const raw = JSON.stringify({
      synonyms: [
        "Country",
        "nation",
        "Nation",
        " nation ",
        "a very long phrase indeed",
        "state123",
        "",
        7,
        "land of my fathers and mothers and kin",
        "fatherland",
      ],
    });
    expect(parseSynonyms(raw, "country")).toEqual(["nation", "fatherland"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 60 }, (_, i) => `${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}yz`);
    expect(parseSynonyms(JSON.stringify({ synonyms: many }), "x")).toHaveLength(30);
  });

  it("reads fenced JSON and bare arrays, and gives up on anything else", () => {
    expect(parseSynonyms('```json\n{"synonyms":["nation"]}\n```', "country")).toEqual(["nation"]);
    expect(parseSynonyms('["nation"]', "country")).toEqual(["nation"]);
    expect(parseSynonyms("not json", "country")).toEqual([]);
    expect(parseSynonyms('{"synonyms":"nation"}', "country")).toEqual([]);
  });

  it("keeps apostrophes and hyphens inside a synonym", () => {
    expect(parseSynonyms('{"synonyms":["ne\'er-do-well","didn’t"]}', "x")).toEqual(["ne'er-do-well", "didn’t"]);
  });
});

describe("parseSynonymsBody", () => {
  it("takes one word with a little context", () => {
    expect(parseSynonymsBody(body)).toEqual({ word: "country", before: body.before, after: "." });
  });

  it("caps the context it passes on", () => {
    const parsed = parseSynonymsBody({ word: "country", before: "x".repeat(2000), after: "y".repeat(2000) });
    expect(parsed).toMatchObject({ before: "x".repeat(400), after: "y".repeat(400) });
  });

  it("rejects what is not a single word", () => {
    expect(parseSynonymsBody({})).toEqual({ error: "word must be a single word." });
    expect(parseSynonymsBody({ word: "two words" })).toEqual({ error: "word must be a single word." });
    expect(parseSynonymsBody({ word: "412" })).toEqual({ error: "word must be a single word." });
    expect(parseSynonymsBody(null)).toEqual({ error: "Expected a synonyms request." });
  });
});

describe("synonymsFor", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.hasKey = true;
    mocks.allowed = true;
  });

  it("asks the small model once and returns its list", async () => {
    mocks.create.mockResolvedValueOnce(haikuText('{"synonyms":["homeland","nation"]}'));
    await expect(synonymsFor(user, body)).resolves.toEqual({ synonyms: ["homeland", "nation"] });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const request = mocks.create.mock.calls[0][0];
    expect(request.model).toBe("claude-haiku-4-5");
    expect(request.messages[0].content).toBe(
      "Before: She did not care about the \nWord: country\nAfter: ."
    );
  });

  it("returns nothing, without calling the model, once the allowance is used up or there is no key", async () => {
    mocks.allowed = false;
    await expect(synonymsFor(user, body)).resolves.toEqual({ synonyms: [] });
    mocks.allowed = true;
    mocks.hasKey = false;
    await expect(synonymsFor(user, body)).resolves.toEqual({ synonyms: [] });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("fails soft when the model throws", async () => {
    mocks.create.mockRejectedValueOnce(new Error("haiku down"));
    await expect(synonymsFor(user, body)).resolves.toEqual({ synonyms: [] });
  });

  it("rejects missing auth and a bad word without calling the model", async () => {
    await expect(synonymsFor(null, body)).rejects.toBeInstanceOf(AuthError);
    await expect(synonymsFor(user, { word: "412" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
