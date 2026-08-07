import Anthropic from "@anthropic-ai/sdk";

// Single shared Anthropic client. Reads ANTHROPIC_API_KEY from the environment.
let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key."
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// Two roles, two models:
//  - EDITOR is the model the author talks to. It plans, decides, holds canon,
//    critiques, and writes drafting briefs. Opus 5 - the most capable, best at
//    long-horizon orchestration and self-verification.
//  - DRAFTER does the actual prose generation from a brief. Sonnet 5 - near-Opus
//    prose quality at lower cost/latency. Haiku is available as a "fast" mode.
export const EDITOR_MODEL =
  process.env.CICIRO_EDITOR_MODEL || process.env.CICIRO_MODEL || "claude-opus-5";
export const DRAFTER_MODEL =
  process.env.CICIRO_DRAFTER_MODEL || "claude-sonnet-5";
export const DRAFTER_FAST_MODEL =
  process.env.CICIRO_DRAFTER_FAST_MODEL || "claude-haiku-4-5";
