import { describe, expect, it } from "vitest";
import {
  composeSceneReminderBody,
  excerptAtReadingPosition,
  lastSentencesBefore,
} from "@/lib/reminder-nudge";

describe("reminder nudge text", () => {
  it("keeps the last one or two sentences before the caret", () => {
    const text = "One. Two! Three? Four.";
    expect(lastSentencesBefore(text, text.length, 2)).toBe("Three? Four.");
    expect(lastSentencesBefore(text, text.indexOf("Three"), 2)).toBe("One. Two!");
  });

  it("composes excerpt then nudge", () => {
    expect(composeSceneReminderBody("Mara found the letter.", "What does she do?")).toBe(
      "Mara found the letter.\n\nWhat does she do?"
    );
  });

  it("reads an excerpt from tip-tap html at the caret", () => {
    const html =
      '<p data-block-id="b1">Mara found the letter. She paused.</p>' +
      '<p data-block-id="b2">The ink was wet.</p>';
    expect(excerptAtReadingPosition(html, "b1", 40)).toMatch(/letter/);
    expect(excerptAtReadingPosition(html, "missing", 0)).toBeNull();
  });
});
