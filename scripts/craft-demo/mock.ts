// A stand-in Anthropic client for the demo's dry run. It answers every call
// the demo makes with canned text so the whole pipeline, the page, and the
// cost estimate can be exercised without a key. Its "usage" is an estimate of
// what the real call would cost (see estimateUsage), and its prose is plainly
// marked as mock output: it says nothing about which arm writes better.

import type Anthropic from "@anthropic-ai/sdk";
import { JUDGE_SYSTEM, type Client } from "./engine";

type Req = Anthropic.MessageCreateParamsNonStreaming;

const MOCK_DRAFT = [
  "[Dry run: mock draft, not model output.] The rain came down as if the sky itself were grieving. It was not anger, but something older.",
  "She noted the door. She noted the lock on it. She filed both away\u2014for later.",
  "Something had changed between them, and they both knew it.",
].join("\n\n");

function chars(req: Req): number {
  const system = Array.isArray(req.system) ? req.system.map((b) => b.text).join("") : String(req.system || "");
  const messages = req.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("");
  return system.length + messages.length;
}

type CallKind = "draft" | "check" | "edit" | "judge";

function kindOf(req: Req): CallKind {
  if (req.system === JUDGE_SYSTEM) return "judge";
  if (Array.isArray(req.system)) return "edit";
  if (String(req.system).startsWith("You check a passage")) return "check";
  return "draft";
}

/**
 * Tokens a real call would likely use. Input is ~3.6 characters a token for
 * English prose and prompts. Output covers the visible reply plus thinking,
 * which Opus at high effort and Sonnet's adaptive default both spend.
 */
export function estimateUsage(req: Req): { input_tokens: number; output_tokens: number } {
  const input = Math.ceil(chars(req) / 3.6);
  const content = String(req.messages[0]?.content);
  // A draft asks for "about N words"; an edit returns about as many words as the draft it gets.
  const asked = Number(content.match(/about (\d+) words/)?.[1] || 0);
  const drafted = content.match(/<draft>\n([\s\S]*?)\n<\/draft>/)?.[1]?.split(/\s+/).length || 0;
  const output: Record<CallKind, number> = {
    draft: Math.round((asked || 350) * 1.4) + 400,
    check: 350 + 300,
    edit: Math.round((drafted || 350) * 1.4) + 2000,
    judge: 250 + 2500,
  };
  return { input_tokens: input, output_tokens: output[kindOf(req)] };
}

function reply(text: string, req: Req): Anthropic.Message {
  return {
    id: "mock",
    type: "message",
    role: "assistant",
    model: String(req.model),
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: estimateUsage(req),
  } as unknown as Anthropic.Message;
}

export function mockClient(): Client & { calls: Req[] } {
  const calls: Req[] = [];
  let judged = 0;
  const create = async (req: Req) => {
    calls.push(req);
    switch (kindOf(req)) {
      case "judge": {
        const verdicts = ["1", "2", "tie"];
        const pick = verdicts[judged++ % 3];
        return reply(
          JSON.stringify({ quality: pick, voice: "tie", brief: pick, reason: "Dry run: mock verdict, not a judgment." }),
          req
        );
      }
      case "check": {
        const passage = String(req.messages[0].content);
        const findings = passage.includes("as if the sky itself were grieving")
          ? [
              {
                quote: "as if the sky itself were grieving",
                habit: "mirrored mood",
                note: "Dry run: mock finding.",
              },
            ]
          : [];
        return reply(JSON.stringify({ findings }), req);
      }
      case "edit": {
        const draft = String(req.messages[0].content).match(/<draft>\n([\s\S]*?)\n<\/draft>/)?.[1] || "";
        return reply(draft.replace("It was not anger, but something older.", "She kept walking."), req);
      }
      default:
        return reply(MOCK_DRAFT, req);
    }
  };
  return { calls, messages: { create } as unknown as Client["messages"] };
}
