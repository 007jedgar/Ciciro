import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getModelSummary", () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    delete process.env.CICIRO_EDITOR_MODEL;
    delete process.env.CICIRO_MODEL;
    delete process.env.CICIRO_DRAFTER_MODEL;
    delete process.env.CICIRO_DRAFTER_FAST_MODEL;
    delete process.env.CICIRO_ROUTER_MODEL;
    delete process.env.GROQ_API_KEY;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("resolves defaults to friendly names, with the raw id kept alongside", async () => {
    const { getModelSummary } = await import("@/lib/models");
    const summary = getModelSummary();
    expect(summary.slots).toEqual([
      { role: "Editor", id: "claude-opus-5", name: "Claude Opus 5" },
      { role: "Drafter", id: "claude-sonnet-5", name: "Claude Sonnet 5" },
      { role: "Quick drafts", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    ]);
    expect(summary.router).toBeNull();
  });

  it("resolves an operator override and reports the Groq router only when configured", async () => {
    process.env.CICIRO_EDITOR_MODEL = "claude-opus-6";
    process.env.GROQ_API_KEY = "test-key";
    const { getModelSummary } = await import("@/lib/models");
    const summary = getModelSummary();
    expect(summary.slots[0]).toEqual({ role: "Editor", id: "claude-opus-6", name: "claude-opus-6" });
    expect(summary.router).toEqual({
      role: "Router",
      id: "llama-3.1-8b-instant",
      name: "Llama 3.1 8B",
      provider: "groq",
    });
  });

  it("never includes an API key", async () => {
    process.env.GROQ_API_KEY = "super-secret";
    process.env.ANTHROPIC_API_KEY = "also-secret";
    const { getModelSummary } = await import("@/lib/models");
    const serialized = JSON.stringify(getModelSummary());
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("also-secret");
  });
});
