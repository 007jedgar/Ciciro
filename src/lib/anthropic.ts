import Anthropic from "@anthropic-ai/sdk";

// Bracket access so Next.js cannot replace these with empty strings from the
// Workers CI build environment. The hosted Worker copies secrets onto
// process.env per request in src/worker/index.ts.
function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function hasAnthropicKey(): boolean {
  return Boolean(readEnv("ANTHROPIC_API_KEY"));
}

export function getAnthropic(): Anthropic {
  const apiKey = readEnv("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key."
    );
  }
  // New client per call: a module singleton shares promises across Worker
  // requests and Cloudflare cancels those continuations.
  return new Anthropic({ apiKey });
}

// Two roles, two models:
//  - EDITOR is the model the author talks to. It plans, decides, holds canon,
//    critiques, and writes drafting briefs. Opus 5 - the most capable, best at
//    long-horizon orchestration and self-verification.
//  - DRAFTER does the actual prose generation from a brief. Sonnet 5 - near-Opus
//    prose quality at lower cost/latency. Haiku is available as a "fast" mode.
export const EDITOR_MODEL =
  readEnv("CICIRO_EDITOR_MODEL") || readEnv("CICIRO_MODEL") || "claude-opus-5";
export const DRAFTER_MODEL = readEnv("CICIRO_DRAFTER_MODEL") || "claude-sonnet-5";
export const DRAFTER_FAST_MODEL =
  readEnv("CICIRO_DRAFTER_FAST_MODEL") || "claude-haiku-4-5";
