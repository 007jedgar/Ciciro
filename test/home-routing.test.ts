import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null, fail: false }));
const nav = vi.hoisted(() => ({ permanentRedirect: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(async () => {
    if (session.fail) throw new Error("db down");
    return session.user;
  }),
}));
vi.mock("next/navigation", () => ({ permanentRedirect: nav.permanentRedirect }));

import { middleware } from "@/middleware";
import { homeShowsLibrary } from "@/lib/home";
import LaunchPage from "@/app/launch/page";
import { THEMES } from "@/lib/theme";
import { SETTINGS_EPOCH } from "@/lib/settings";
import { MANUSCRIPT_KINDS } from "@/lib/manuscript-kind";
import { MOTION_MS } from "@/lib/motion";
import { nextStep } from "@/components/landing/CyclingWord";
import { CLOSING, HERO, HOW, LANDING_METADATA, PRICING, SCENE, WHY } from "@/components/landing/copy";

describe("the home screen", () => {
  beforeEach(() => {
    session.user = null;
    session.fail = false;
    vi.stubEnv("CICIRO_REQUIRE_AUTH", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets a signed-out visitor reach / instead of bouncing them to sign in", () => {
    const res = middleware(new NextRequest("http://localhost/"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("still sends a signed-out visitor on a private page to sign in, and back", () => {
    const res = middleware(new NextRequest("http://localhost/project/abc"));
    expect(res.headers.get("location")).toBe("http://localhost/login?next=%2Fproject%2Fabc");
  });

  it("shows the landing page without a valid session", async () => {
    expect(await homeShowsLibrary()).toBe(false);
  });

  it("shows the landing page when the session lookup fails, not an empty library", async () => {
    session.fail = true;
    expect(await homeShowsLibrary()).toBe(false);
  });

  it("shows the library to a signed-in writer", async () => {
    session.user = { id: "u1" };
    expect(await homeShowsLibrary()).toBe(true);
  });

  it("shows the library in local single-author mode", async () => {
    vi.stubEnv("CICIRO_REQUIRE_AUTH", "");
    expect(await homeShowsLibrary()).toBe(true);
  });

  it("sends old /launch links to / permanently", () => {
    LaunchPage();
    expect(nav.permanentRedirect).toHaveBeenCalledWith("/");
  });
});

describe("theme ids", () => {
  // layout.tsx sets the theme before React loads, from its own copy of the ids.
  const layout = readFileSync(join(__dirname, "../src/app/layout.tsx"), "utf8");

  it("boots every theme the picker offers", () => {
    const list = layout.match(/var themes = (\[[^\]]*\]);/)?.[1];
    expect(list).toBeDefined();
    expect(JSON.parse(list!)).toEqual(expect.arrayContaining(THEMES.map((t) => t.id)));
    expect(JSON.parse(list!)).toHaveLength(THEMES.length);
  });

  it("boots every dark theme with a dark color scheme", () => {
    const dark = layout.match(/var dark = ([^;]*);/)?.[1] ?? "";
    const ids = [...dark.matchAll(/id === "([\w-]+)"/g)].map((m) => m[1]).sort();
    expect(ids).toEqual(THEMES.filter((t) => t.mode === "dark").map((t) => t.id).sort());
  });

  it("follows the OS until settings were chosen, as SettingsProvider does", () => {
    expect(layout).toContain(`blob.updatedAt !== "${SETTINGS_EPOCH}"`);
  });

  it("keeps the ids every device already stores as the defaults", () => {
    expect(THEMES.find((t) => t.id === "parchment")?.mode).toBe("light");
    expect(THEMES.find((t) => t.id === "ember")?.mode).toBe("dark");
  });
});

describe("landing copy", () => {
  const strings = JSON.stringify([LANDING_METADATA, HERO, HOW, WHY, CLOSING, SCENE, PRICING, PRICING.free(30)]);

  it("never uses an em or en dash", () => {
    expect(strings).not.toMatch(/[–—]/);
  });

  it("never promises a streak", () => {
    expect(strings.toLowerCase()).not.toMatch(/day \d+ of your streak|keep your streak/);
  });
});

describe("the headline's retyped subject", () => {
  const words = HERO.headlineSubjects;

  it("starts on novels and names only forms Ciciro is built for", () => {
    expect(words[0]).toBe("novels");
    expect(MANUSCRIPT_KINDS).toEqual(["novel", "screenplay", "blog", "journal"]);
    // Plural nouns the sentence reads right with: "Most ___ don't stall".
    for (const word of words) expect(word).toMatch(/^[a-z]+s$/);
  });

  it("rests on a word, erases it a key at a time, then types the next", () => {
    let state = { index: 0, erasing: true, text: "novels" };
    const shown: string[] = [];
    const delays = new Set<number>();
    for (let i = 0; i < 40 && !(state.index === 1 && state.text === "journals" && state.erasing); i++) {
      const next = nextStep(words, state.index, state.text, state.erasing);
      state = { index: next.index, erasing: next.erasing, text: next.step.text };
      shown.push(next.step.text);
      delays.add(next.step.delay);
    }
    expect(shown.slice(0, 6)).toEqual(["novel", "nove", "nov", "no", "n", ""]);
    expect(shown.slice(6, 14)).toEqual(["j", "jo", "jou", "jour", "journ", "journa", "journal", "journals"]);
    expect(shown.at(-1)).toBe("journals");
    expect([...delays].sort((a, b) => a - b)).toEqual(
      [MOTION_MS.keyErase, MOTION_MS.keyType, MOTION_MS.keyType * 3, MOTION_MS.wordHold].sort((a, b) => a - b)
    );
  });

  it("comes back round to the first word", () => {
    const last = words.length - 1;
    expect(nextStep(words, last, "", true)).toMatchObject({ index: 0, step: { text: "n" } });
  });
});
