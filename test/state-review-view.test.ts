import { describe, expect, it } from "vitest";
import {
  groundStateProposals,
  parseStateProposals,
  proposalFingerprint,
  withoutDismissed,
  type StateProposalDraft,
} from "@/lib/state-review-view";

const chapter = "Mara found the vault empty and told no one.";

function proposal(over: Partial<StateProposalDraft> & Pick<StateProposalDraft, "kind" | "text">): StateProposalDraft {
  return {
    chapterQuote: "the vault empty",
    note: "She sees it.",
    ...over,
  };
}

describe("state review grounding", () => {
  it("drops a proposal whose quote is not in the chapter", () => {
    const proposals = [
      proposal({ kind: "canon", text: "The vault is empty" }),
      proposal({ kind: "plot", chapterQuote: "a sentence that never appears", text: "Mara lies" }),
    ];
    expect(groundStateProposals(proposals, chapter, []).map((p) => p.text)).toEqual(["The vault is empty"]);
  });

  it("drops a knowledge proposal for a character file that was not in the run", () => {
    const proposals = [
      proposal({
        kind: "knowledge",
        text: "The vault is empty",
        stance: "knows",
        characterPath: "characters/ghost.md",
      }),
      proposal({
        kind: "knowledge",
        text: "Mara saw the vault",
        stance: "knows",
        characterPath: "characters/mara.md",
        chapterQuote: "told no one",
      }),
    ];
    const kept = groundStateProposals(proposals, chapter, ["characters/mara.md"]);
    expect(kept.map((p) => p.characterPath)).toEqual(["characters/mara.md"]);
  });

  it("does not treat a paraphrased quote as grounded", () => {
    const parsed = parseStateProposals(
      JSON.stringify([
        {
          kind: "canon",
          chapterQuote: "Mara discovered nothing inside",
          text: "The vault is empty",
          note: "Close, but not the chapter's words.",
        },
      ])
    );
    expect(groundStateProposals(parsed, chapter, [])).toEqual([]);
  });
});

describe("dismissal stickiness", () => {
  it("fingerprints chapter, kind, and normalized text", () => {
    const a = proposalFingerprint("ch-1", "canon", "  The Vault Is Empty ");
    const b = proposalFingerprint("ch-1", "canon", "the   vault is empty");
    const otherKind = proposalFingerprint("ch-1", "plot", "the vault is empty");
    expect(a).toBe(b);
    expect(otherKind).not.toBe(a);
  });

  it("filters a proposal that was already dismissed", () => {
    const row = proposal({ kind: "canon", text: "The vault is empty" });
    const fresh = proposal({ kind: "plot", text: "Mara keeps the secret", chapterQuote: "told no one" });
    const fingerprints = new Set([proposalFingerprint("ch-1", "canon", "the vault is empty")]);
    expect(withoutDismissed([row, fresh], "ch-1", fingerprints).map((p) => p.kind)).toEqual(["plot"]);
  });
});
