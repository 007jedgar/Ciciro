import { describe, expect, it } from "vitest";
import {
  BEFORE_STORY_ORDER,
  characterTimeline,
  gridCellKey,
  inEffectAsOf,
  knowledgeGrid,
  parseKnowledgeStance,
  readerNoteFor,
  type LedgerChapter,
  type LedgerFact,
} from "@/lib/knowledge-ledger";

const ch = (n: number, id = `c${n}`): LedgerChapter => ({ id, title: `Chapter ${n}`, order: n - 1 });

let seq = 0;
function fact(over: Partial<LedgerFact>): LedgerFact {
  seq += 1;
  return {
    id: `f${seq}`,
    characterPath: "characters/joe.md",
    fact: `fact ${seq}`,
    stance: "knows",
    topic: null,
    status: "active",
    chapter: null,
    supersededAtChapter: null,
    ...over,
  };
}

describe("parseKnowledgeStance", () => {
  it("takes the four stances and reads the first vocabulary's believes as suspects", () => {
    expect(parseKnowledgeStance("knows")).toBe("knows");
    expect(parseKnowledgeStance("suspects")).toBe("suspects");
    expect(parseKnowledgeStance("believes_wrong")).toBe("believes_wrong");
    expect(parseKnowledgeStance("unaware")).toBe("unaware");
    expect(parseKnowledgeStance("believes")).toBe("suspects");
    expect(parseKnowledgeStance("thinks")).toBeNull();
    expect(parseKnowledgeStance(undefined)).toBeNull();
  });
});

describe("inEffectAsOf", () => {
  it("holds a fact from its chapter on, and one with no chapter from before the story", () => {
    const early = fact({});
    const ch6 = fact({ chapter: ch(6) });
    expect(inEffectAsOf(early, BEFORE_STORY_ORDER)).toBe(true);
    expect(inEffectAsOf(ch6, ch(5).order)).toBe(false);
    expect(inEffectAsOf(ch6, ch(6).order)).toBe(true);
    expect(inEffectAsOf(ch6, ch(9).order)).toBe(true);
  });

  it("stops a superseded fact at the chapter it was retired in, and keeps it before", () => {
    const retired = fact({ status: "superseded", chapter: ch(1), supersededAtChapter: ch(6) });
    expect(inEffectAsOf(retired, ch(1).order)).toBe(true);
    expect(inEffectAsOf(retired, ch(5).order)).toBe(true);
    expect(inEffectAsOf(retired, ch(6).order)).toBe(false);
    expect(inEffectAsOf(retired, ch(7).order)).toBe(false);
  });

  it("never holds a fact retired with no chapter, as retiring did before chapters mattered", () => {
    const retired = fact({ status: "superseded", chapter: ch(1), supersededAtChapter: null });
    for (const order of [BEFORE_STORY_ORDER, 0, 3, 99]) expect(inEffectAsOf(retired, order)).toBe(false);
  });

  it("follows a reorder: only the orders read now count", () => {
    // Chapter "attic" was 6th; the author drags it to 2nd.
    const before = fact({ chapter: { id: "attic", title: "The Attic", order: 5 } });
    const after = { ...before, chapter: { id: "attic", title: "The Attic", order: 1 } };
    expect(inEffectAsOf(before, 2)).toBe(false);
    expect(inEffectAsOf(after, 2)).toBe(true);
  });
});

describe("characterTimeline", () => {
  it("marks each fact as holding, over, or still to come, with what replaced it on the same topic", () => {
    const unaware = fact({
      stance: "unaware",
      fact: "who has the pen",
      topic: "Who has the pen",
      status: "superseded",
      supersededAtChapter: ch(6),
    });
    const suspects = fact({ stance: "suspects", fact: "Suzy has the pen", topic: "who has the  pen", chapter: ch(6) });
    const locks = fact({ fact: "He locks up at dusk", chapter: ch(9) });
    const gone = fact({ status: "superseded", supersededAtChapter: null });

    const at3 = characterTimeline([locks, suspects, unaware, gone], ch(3).order);
    expect(at3.map((row) => [row.fact.id, row.state])).toEqual([
      [unaware.id, "in_effect"],
      [suspects.id, "later"],
      [locks.id, "later"],
    ]);

    const at6 = characterTimeline([locks, suspects, unaware, gone], ch(6).order);
    expect(at6.map((row) => [row.fact.id, row.state])).toEqual([
      [unaware.id, "ended"],
      [suspects.id, "in_effect"],
      [locks.id, "later"],
    ]);
    expect(at6[0].replacedBy?.id).toBe(suspects.id);
  });
});

describe("knowledgeGrid", () => {
  it("lines characters up on a topic as of a chapter, keeping the grid's shape as it moves", () => {
    const joeEarly = fact({ stance: "unaware", fact: "who has it", topic: "The pen", status: "superseded", supersededAtChapter: ch(6) });
    const joeLater = fact({ stance: "believes_wrong", fact: "Suzy has it", topic: "the pen", chapter: ch(6) });
    const suzy = fact({ characterPath: "characters/suzy.md", fact: "Mara has it", topic: "the pen", chapter: ch(2) });
    const untagged = fact({ fact: "no topic" });

    const at1 = knowledgeGrid([joeEarly, joeLater, suzy, untagged], ch(1).order);
    expect(at1.topics).toEqual([{ key: "the pen", label: "The pen" }]);
    expect(at1.characters).toEqual(["characters/joe.md", "characters/suzy.md"]);
    expect(at1.cells.get(gridCellKey("the pen", "characters/joe.md"))?.id).toBe(joeEarly.id);
    expect(at1.cells.get(gridCellKey("the pen", "characters/suzy.md"))).toBeUndefined();

    const at6 = knowledgeGrid([joeEarly, joeLater, suzy, untagged], ch(6).order);
    expect(at6.cells.get(gridCellKey("THE PEN", "characters/joe.md"))?.id).toBe(joeLater.id);
    expect(at6.cells.get(gridCellKey("the pen", "characters/suzy.md"))?.id).toBe(suzy.id);
  });
});

describe("readerNoteFor", () => {
  it("finds the canon line that mentions the topic", () => {
    const canon = "# Canon\n\n- Mara has had the pen since chapter 1.\n- Joe is a locksmith.\n";
    expect(readerNoteFor("the pen", canon)).toBe("Mara has had the pen since chapter 1.");
    expect(readerNoteFor("the map", canon)).toBeNull();
    expect(readerNoteFor("", canon)).toBeNull();
  });
});
