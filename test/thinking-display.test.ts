import { describe, expect, it } from "vitest";
import {
  isThinkingDisplayRejection,
  supportsThinkingUpdates,
} from "@/lib/thinking-display";

describe("supportsThinkingUpdates", () => {
  it.each([
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-fable-5-1",
    "claude-fable-5",
    "anthropic.claude-opus-5-5",
  ])("accepts %s", (id) => {
    expect(supportsThinkingUpdates(id)).toBe(true);
  });

  it.each([
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-haiku-4-5",
    "mock-editor",
  ])("rejects %s", (id) => {
    expect(supportsThinkingUpdates(id)).toBe(false);
  });
});

describe("isThinkingDisplayRejection", () => {
  it("matches a 400 naming the parameter or the beta", () => {
    expect(
      isThinkingDisplayRejection({ status: 400, message: "thinking.display: bad" })
    ).toBe(true);
    expect(
      isThinkingDisplayRejection({
        status: 400,
        message: "unexpected value(s) for the anthropic-beta header",
      })
    ).toBe(true);
  });

  it("ignores other 400s and other statuses", () => {
    expect(
      isThinkingDisplayRejection({ status: 400, message: "max_tokens too large" })
    ).toBe(false);
    expect(
      isThinkingDisplayRejection({ status: 500, message: "display exploded" })
    ).toBe(false);
    expect(isThinkingDisplayRejection(new Error("terminated"))).toBe(false);
  });
});
