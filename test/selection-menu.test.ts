import { describe, expect, it, vi } from "vitest";
import {
  commentQuote,
  createSynonymLookup,
  matchCase,
  selectionActionsFor,
  selectionBrief,
  selectionKind,
  splitWord,
  synonymCacheKey,
  synonymContext,
  synonymEligible,
} from "@/lib/selection-menu";

describe("selectionKind", () => {
  it("calls nothing, spaces and bare punctuation no selection", () => {
    expect(selectionKind("")).toBe("none");
    expect(selectionKind("   \n ")).toBe("none");
    expect(selectionKind("— …")).toBe("none");
  });

  it("calls one word a word, even with punctuation or spaces around it", () => {
    expect(selectionKind("country")).toBe("word");
    expect(selectionKind(" country. ")).toBe("word");
    expect(selectionKind("fifty-one")).toBe("word");
    expect(selectionKind("don’t")).toBe("word");
  });

  it("calls two or more words a passage", () => {
    expect(selectionKind("the country")).toBe("passage");
    expect(selectionKind("who had been pushing\nfor fifty")).toBe("passage");
  });
});

describe("selectionActionsFor", () => {
  it("offers a word comment, describe and fix", () => {
    expect(selectionActionsFor("word")).toEqual(["comment", "describe", "fix"]);
  });

  it("offers a passage comment, rewrite, describe, expand and fix", () => {
    expect(selectionActionsFor("passage")).toEqual(["comment", "rewrite", "describe", "expand", "fix"]);
  });

  it("offers nothing for no selection", () => {
    expect(selectionActionsFor("none")).toEqual([]);
  });
});

describe("selectionBrief", () => {
  it("asks for a draft block the author can insert", () => {
    for (const action of ["rewrite", "describe", "expand", "fix"] as const) {
      expect(selectionBrief(action, "novel")).toContain("<draft>");
    }
  });

  it("never carries an em dash into a model instruction", () => {
    for (const kind of ["novel", "screenplay", "blog", "journal"] as const) {
      for (const action of ["rewrite", "describe", "expand", "fix"] as const) {
        expect(selectionBrief(action, kind)).not.toContain("—");
      }
    }
  });

  it("writes screenplay lines for a screenplay and keeps a journal's facts", () => {
    expect(selectionBrief("rewrite", "screenplay")).toContain("script lines");
    expect(selectionBrief("expand", "journal")).toContain("do not invent");
    expect(selectionBrief("rewrite", "novel")).not.toContain("script lines");
  });
});

describe("commentQuote", () => {
  it("quotes the selection", () => {
    expect(commentQuote("country")).toBe("“country” ");
  });

  it("flattens whitespace and trims a long selection with an ellipsis", () => {
    expect(commentQuote("one\n\ntwo   three")).toBe("“one two three” ");
    const long = commentQuote("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(84);
    expect(long).toContain("…");
  });
});

describe("splitWord", () => {
  it("keeps the punctuation around the word aside", () => {
    expect(splitWord("country.")).toEqual({ lead: "", word: "country", trail: "." });
    expect(splitWord(" “country” ")).toEqual({ lead: " “", word: "country", trail: "” " });
    expect(splitWord("don’t")).toEqual({ lead: "", word: "don’t", trail: "" });
  });

  it("finds no word in punctuation", () => {
    expect(splitWord("…")).toBeNull();
  });
});

describe("synonymEligible", () => {
  it("accepts words and rejects numbers, single letters and long runs", () => {
    expect(synonymEligible("country")).toBe(true);
    expect(synonymEligible("fifty-one")).toBe(true);
    expect(synonymEligible("don’t")).toBe(true);
    expect(synonymEligible("412")).toBe(false);
    expect(synonymEligible("a")).toBe(false);
    expect(synonymEligible("a".repeat(40))).toBe(false);
    expect(synonymEligible("room412")).toBe(false);
  });
});

describe("synonymContext", () => {
  const block = "She left. She did not care about the country. This will strike some readers as unpatriotic.";

  it("cuts the context to the sentence the word is in", () => {
    const start = block.indexOf("country");
    const context = synonymContext(block, start, start + "country".length);
    expect(context).toEqual({
      word: "country",
      before: "She did not care about the ",
      after: ".",
    });
  });

  it("takes the rest of a sentence that runs on", () => {
    const start = block.indexOf("care");
    const context = synonymContext(block, start, start + 4);
    expect(context.before).toBe("She did not ");
    expect(context.after).toBe(" about the country.");
  });

  it("works at the edges of a block", () => {
    expect(synonymContext("Walked", 0, 6)).toEqual({ word: "Walked", before: "", after: "" });
  });
});

describe("matchCase", () => {
  it("capitalizes for a capitalized word", () => {
    expect(matchCase("Country", "homeland")).toBe("Homeland");
  });

  it("upper-cases for an upper-case word", () => {
    expect(matchCase("COUNTRY", "homeland")).toBe("HOMELAND");
  });

  it("leaves a lower-case word alone", () => {
    expect(matchCase("country", "homeland")).toBe("homeland");
    expect(matchCase("country", "Britain")).toBe("Britain");
  });

  it("does not shout a single capital letter", () => {
    expect(matchCase("I", "me")).toBe("Me");
  });

  it("keeps leading punctuation in the replacement", () => {
    expect(matchCase("Country", "‘homeland")).toBe("‘Homeland");
  });
});

describe("synonymCacheKey", () => {
  it("ignores case and distant context", () => {
    const tail = "the quick brown fox jumps over the lazy dog and then all the ";
    const a = synonymCacheKey({ word: "Country", before: "x".repeat(200) + tail, after: " is" });
    const b = synonymCacheKey({ word: "country", before: "y".repeat(200) + tail.toUpperCase(), after: " IS" });
    expect(a).toBe(b);
  });

  it("tells the same word in another sentence apart", () => {
    const a = synonymCacheKey({ word: "country", before: "the ", after: "." });
    const b = synonymCacheKey({ word: "country", before: "a foreign ", after: " road." });
    expect(a).not.toBe(b);
  });
});

describe("createSynonymLookup", () => {
  const context = { word: "country", before: "the ", after: "." };

  it("answers a repeat from memory", async () => {
    const fetcher = vi.fn().mockResolvedValue(["homeland", "nation"]);
    const lookup = createSynonymLookup(fetcher);
    expect(await lookup(context)).toEqual(["homeland", "nation"]);
    expect(await lookup(context)).toEqual(["homeland", "nation"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shares one request between asks made while it is in flight", async () => {
    let resolve: (list: string[]) => void = () => {};
    const fetcher = vi.fn().mockReturnValue(new Promise<string[]>((r) => (resolve = r)));
    const lookup = createSynonymLookup(fetcher);
    const first = lookup(context);
    const second = lookup(context);
    resolve(["nation"]);
    expect(await first).toEqual(["nation"]);
    expect(await second).toEqual(["nation"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failure or an empty answer", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["nation"]);
    const lookup = createSynonymLookup(fetcher);
    await expect(lookup(context)).rejects.toThrow("offline");
    expect(await lookup(context)).toEqual([]);
    expect(await lookup(context)).toEqual(["nation"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("forgets the oldest word once it holds more than its limit", async () => {
    const fetcher = vi.fn(async (c: { word: string }) => [`${c.word}-syn`]);
    const lookup = createSynonymLookup(fetcher, 2);
    const ask = (word: string) => lookup({ word, before: "", after: "" });
    await ask("a1");
    await ask("b1");
    await ask("c1");
    await ask("b1");
    await ask("a1");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
