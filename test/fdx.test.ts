// @vitest-environment jsdom
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFdx as draftFirstParse } from "@draftfirst/core/fdx";
import { describe, expect, it } from "vitest";
import { fdxFromScript, scriptFromFdx } from "@/lib/fdx";
import { scriptBlocksToHtml, scriptFromFountain, type FountainScript } from "@/lib/fountain";
import { IMPORT_FORMATS, ImportError, detectFormat, importFile } from "@/lib/import";
import { decodeFdx, parseFdx } from "@/lib/import/fdx";
import { runsText, styledBlocksFromHtml, type StyledBlock, type StyledRun } from "@/lib/screenplay";
import { NIGHT_SHIFT_FDX } from "./fixtures/fdx/night-shift";
import { longScript } from "./fixtures/screenplay/long-script";

const FIXTURES = join(__dirname, "fixtures/fdx");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

const blocksOf = (script: FountainScript): StyledBlock[] => script.sequences.flatMap((s) => s.blocks);
const text = (b: StyledBlock) => runsText(b.runs);
const block = (element: string, line: string): StyledBlock => ({ element, runs: [{ text: line }] });
const write = (blocks: StyledBlock[], opts: { sceneNumbers?: boolean } = {}) =>
  fdxFromScript({ title: "", author: "", sequences: [{ title: "", blocks }] }, opts);
const read = (xml: string) => blocksOf(scriptFromFdx(xml));
const content = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?><FinalDraft><Content>${inner}</Content></FinalDraft>`;

/** Runs with neighbours of the same marks merged, so two readers that cut a line differently still compare equal. */
function merged(runs: readonly StyledRun[]): StyledRun[] {
  const out: StyledRun[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && !!last.bold === !!run.bold && !!last.italic === !!run.italic && !!last.underline === !!run.underline) {
      last.text += run.text;
    } else {
      out.push({ ...run });
    }
  }
  return out;
}

/** What a script says, the way any reader of it would: elements, text and marks. */
const detail = (blocks: StyledBlock[]) => blocks.map((b) => ({ element: b.element, dual: !!b.dual, runs: merged(b.runs) }));

/** The same, with whitespace squeezed and consecutive lines of dialogue joined, for readers that disagree on either. */
function squeezed(blocks: StyledBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    const line = text(b).replace(/\s+/g, " ").trim();
    const entry = `${b.element}${b.dual ? " ^" : ""}: ${line}`;
    if (b.element === "dialogue" && out.length > 0 && out[out.length - 1].startsWith("dialogue: ")) {
      out[out.length - 1] += ` ${line}`;
    } else {
      out.push(entry);
    }
  }
  return out;
}

describe("writing FDX", () => {
  const file = join(FIXTURES, "night-shift.fdx");
  const xml = fdxFromScript(NIGHT_SHIFT_FDX, { sceneNumbers: true });

  it("writes the fixture script as the golden file", () => {
    if (process.env.UPDATE_GOLDEN) writeFileSync(file, xml);
    expect(xml).toBe(readFileSync(file, "utf8"));
  });

  it("is well-formed XML to a strict parser", () => {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.documentElement.nodeName).toBe("FinalDraft");
  });

  it("writes a Paragraph a block, with capitals derived at the edge", () => {
    const out = write([
      block("scene-heading", "int. lab - day"),
      block("action", "She waits."),
      block("character", "mara"),
      block("parenthetical", "softly"),
      block("dialogue", "Hello."),
      block("shot", "close on her"),
      block("transition", "cut to:"),
      block("centered", "THE END"),
    ]);
    expect(out).toContain('<Paragraph Type="Scene Heading"><Text>INT. LAB - DAY</Text></Paragraph>');
    expect(out).toContain('<Paragraph Type="Action"><Text>She waits.</Text></Paragraph>');
    expect(out).toContain('<Paragraph Type="Character"><Text>MARA</Text></Paragraph>');
    expect(out).toContain('<Paragraph Type="Parenthetical"><Text>(softly)</Text></Paragraph>');
    expect(out).toContain('<Paragraph Type="Shot"><Text>CLOSE ON HER</Text></Paragraph>');
    expect(out).toContain('<Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>');
    expect(out).toContain('<Paragraph Alignment="Center" Type="Action"><Text>THE END</Text></Paragraph>');
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script"')).toBe(true);
  });

  it("marks Text runs with Style, and only where there is a mark", () => {
    const out = write([
      {
        element: "action",
        runs: [{ text: "a " }, { text: "b", bold: true, italic: true, underline: true }, { text: " c", underline: true }],
      },
    ]);
    expect(out).toContain('<Text>a </Text><Text Style="Bold+Italic+Underline">b</Text><Text Style="Underline"> c</Text>');
  });

  it("escapes markup and drops what XML cannot hold", () => {
    const out = write([block("action", 'Tom & "Jerry" <3 \u0001 \ud800 ok')]);
    expect(out).toContain("<Text>Tom &amp; &quot;Jerry&quot; &lt;3   ok</Text>");
    expect(out).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(read(out).map(text)).toEqual(['Tom & "Jerry" <3   ok']);
  });

  it("does not wrap a parenthetical that already has its brackets in two more", () => {
    expect(write([block("parenthetical", "(beat)")])).toContain("<Text>(beat)</Text>");
    expect(write([block("parenthetical", "beat")])).toContain("<Text>(beat)</Text>");
  });

  it("skips empty blocks and keeps a hard line break inside a block", () => {
    const out = write([block("action", "  "), block("action", "one\ntwo")]);
    expect(out.match(/<Paragraph /g)).toHaveLength(1);
    expect(read(out).map(text)).toEqual(["one\ntwo"]);
  });

  it("puts only valid dual-dialogue pairs in a DualDialogue", () => {
    const pair = write([
      block("character", "a"),
      block("dialogue", "One."),
      { ...block("character", "b"), dual: true },
      block("dialogue", "Two."),
    ]);
    expect(pair).toContain("<Paragraph>\n      <DualDialogue>");
    expect(pair.match(/<DualDialogue>/g)).toHaveLength(1);
    const orphan = write([{ ...block("character", "a"), dual: true }, block("dialogue", "One.")]);
    expect(orphan).not.toContain("DualDialogue");
    const apart = write([
      block("character", "a"),
      block("dialogue", "One."),
      block("action", "Between."),
      { ...block("character", "b"), dual: true },
      block("dialogue", "Two."),
    ]);
    expect(apart).not.toContain("DualDialogue");
    // The flag is dropped, not kept: reading it back says "not a pair".
    expect(read(apart).some((b) => b.dual)).toBe(false);
  });

  it("numbers scene headings only when asked, counting on across sequences and past blank ones", () => {
    const script: FountainScript = {
      title: "",
      author: "",
      sequences: [
        { title: "", blocks: [block("scene-heading", "int. a - day"), block("scene-heading", " "), block("scene-heading", "ext. b - day")] },
        { title: "", blocks: [block("scene-heading", "int. c - day")] },
      ],
    };
    expect(fdxFromScript(script).includes("Number=")).toBe(false);
    const numbered = fdxFromScript(script, { sceneNumbers: true });
    expect(numbered.match(/Number="(\d+)"/g)).toEqual(['Number="1"', 'Number="2"', 'Number="3"']);
  });

  it("writes a title page when the script has words for one, and none otherwise", () => {
    const none = fdxFromScript({ title: "", author: "", sequences: [{ title: "", blocks: [block("action", "Hi.")] }] });
    expect(none).not.toContain("TitlePage");
    const bare = fdxFromScript({ title: "Night Shift", author: "Jo", sequences: [{ title: "", blocks: [block("action", "Hi.")] }] });
    expect(bare).toContain("<TitlePage>");
    expect(bare).toContain("<Text>NIGHT SHIFT</Text>");
    expect(xml).toContain("<TitlePage>");
    expect(xml).toContain('<Paragraph Alignment="Right" Type="Action"><Text>Oct 2026</Text></Paragraph>');
  });

  it("claims no more than it is: an FDX export, not a promise about another program", () => {
    expect(xml.toLowerCase()).not.toContain("compatible");
    expect(readFileSync(join(__dirname, "../src/lib/fdx.ts"), "utf8")).not.toMatch(/Final Draft[ -]compatible/i);
  });
});

describe("reading FDX", () => {
  it("reads what the writer wrote: every element, mark, flag and the title page", () => {
    const script = scriptFromFdx(fdxFromScript(NIGHT_SHIFT_FDX, { sceneNumbers: true }));
    const caps = new Set(["scene-heading", "character", "transition", "shot"]);
    const expected = blocksOf(NIGHT_SHIFT_FDX).map((b) => ({
      element: b.element,
      dual: !!b.dual,
      runs: merged(b.runs.map((r) => ({ ...r, text: caps.has(b.element) ? r.text.toUpperCase() : r.text }))),
    }));
    expect(detail(blocksOf(script))).toEqual(expected);
    expect(script.sequences).toHaveLength(1);
    expect(script.sceneNumbers).toBe(true);
    expect(script.titlePage).toEqual({ ...NIGHT_SHIFT_FDX.titlePage, title: "NIGHT SHIFT" });
    expect(script.title).toBe("NIGHT SHIFT");
    expect(script.author).toBe("Jo Writer");
  });

  it("says whether the scenes were numbered", () => {
    expect(scriptFromFdx(fdxFromScript(NIGHT_SHIFT_FDX)).sceneNumbers).toBe(false);
  });

  it("round-trips a long script with every element", () => {
    const sequences = longScript(12, 3);
    const script: FountainScript = { title: "", author: "", sequences };
    const back = scriptFromFdx(fdxFromScript(script));
    const caps = new Set(["scene-heading", "character", "transition", "shot"]);
    const expected = sequences.flatMap((s) => s.blocks).map((b) => ({
      element: b.element,
      dual: false,
      runs: merged(b.runs.map((r) => ({ ...r, text: caps.has(b.element) ? r.text.toUpperCase() : r.text }))),
    }));
    expect(detail(blocksOf(back))).toEqual(expected);
  });

  it("reads Final Draft's own habits: a Number and SceneProperties, entities, CDATA, General and empty paragraphs", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="2">
  <Content>
    <Paragraph Number="1" Type="Scene Heading">
      <SceneProperties Length="1 1/8" Page="1" Title=""/>
      <Text>INT. HOUSE - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>She&apos;s &#233;tonn&#xE9;e &amp; late &lt;3.</Text>
    </Paragraph>
    <Paragraph Type="General"><Text>A general line.</Text></Paragraph>
    <Paragraph Type="Action"><Text/></Paragraph>
    <Paragraph Type="Action"><Text>   </Text></Paragraph>
    <Paragraph Type="Cast List"><Text><![CDATA[Cast: <A> & <B>]]></Text></Paragraph>
    <Paragraph Type="New Act"><Text>ACT TWO</Text></Paragraph>
    <Paragraph Type="Character"><Text Style="Bold+Italic">Bob</Text></Paragraph>
    <Paragraph Type="Parenthetical"><Text>(sotto)</Text></Paragraph>
    <Paragraph Type="Dialogue">
      <Text Style="AllCaps+Underline">hi </Text><Text>there</Text>
      <ScriptNote ID="1"><Paragraph><Text>a note, not dialogue</Text></Paragraph></ScriptNote>
    </Paragraph>
    <Paragraph Type="Transition" StartsNewPage="No"><Text>CUT TO:</Text></Paragraph>
  </Content>
  <ElementSettings Type="Action"><FontSpec Font="Courier Final Draft"/></ElementSettings>
</FinalDraft>`;
    const script = scriptFromFdx(xml);
    expect(script.sceneNumbers).toBe(true);
    expect(detail(blocksOf(script))).toEqual([
      { element: "scene-heading", dual: false, runs: [{ text: "INT. HOUSE - DAY" }] },
      { element: "action", dual: false, runs: [{ text: "She's étonnée & late <3." }] },
      { element: "action", dual: false, runs: [{ text: "A general line." }] },
      { element: "action", dual: false, runs: [{ text: "Cast: <A> & <B>" }] },
      { element: "action", dual: false, runs: [{ text: "ACT TWO" }] },
      { element: "character", dual: false, runs: [{ text: "Bob", bold: true, italic: true }] },
      { element: "parenthetical", dual: false, runs: [{ text: "sotto" }] },
      { element: "dialogue", dual: false, runs: [{ text: "HI ", underline: true }, { text: "there" }] },
      { element: "transition", dual: false, runs: [{ text: "CUT TO:" }] },
    ]);
  });

  it("reads Type and attribute names whatever their case, and single-quoted values", () => {
    const blocks = read(content("<paragraph type='scene heading' NUMBER='4'><text style='BOLD'>int. a - day</text></paragraph>"));
    expect(blocks).toEqual([{ element: "scene-heading", runs: [{ text: "int. a - day", bold: true }] }]);
  });

  it("reads centered action as centered, and only action", () => {
    const blocks = read(
      content(
        '<Paragraph Alignment="Center" Type="Action"><Text>THE END</Text></Paragraph>' +
          '<Paragraph Alignment="Center" Type="General"><Text>FIN</Text></Paragraph>' +
          '<Paragraph Alignment="Center" Type="Dialogue"><Text>hello</Text></Paragraph>' +
          '<Paragraph Alignment="Left" Type="Action"><Text>left</Text></Paragraph>'
      )
    );
    expect(blocks.map((b) => b.element)).toEqual(["centered", "centered", "dialogue", "action"]);
  });

  it("takes one pair of brackets off a parenthetical, and none off other text", () => {
    const blocks = read(
      content(
        '<Paragraph Type="Parenthetical"><Text>( both ways )</Text></Paragraph>' +
          '<Paragraph Type="Parenthetical"><Text>bare</Text></Paragraph>' +
          '<Paragraph Type="Action"><Text>(kept)</Text></Paragraph>'
      )
    );
    expect(blocks.map(text)).toEqual(["both ways", "bare", "(kept)"]);
  });

  describe("dual dialogue", () => {
    const speeches =
      '<Paragraph Type="Character"><Text>A</Text></Paragraph><Paragraph Type="Dialogue"><Text>One.</Text></Paragraph>' +
      '<Paragraph Type="Character"><Text>B</Text></Paragraph><Paragraph Type="Parenthetical"><Text>(x)</Text></Paragraph><Paragraph Type="Dialogue"><Text>Two.</Text></Paragraph>';

    it("flags the second cue of a DualDialogue wrapped in a paragraph, as screenplain and afterwriting write it", () => {
      const blocks = read(content(`<Paragraph><DualDialogue>${speeches}</DualDialogue></Paragraph>`));
      expect(blocks.map((b) => [b.element, !!b.dual])).toEqual([
        ["character", false],
        ["dialogue", false],
        ["character", true],
        ["parenthetical", false],
        ["dialogue", false],
      ]);
    });

    it("reads a DualDialogue straight under Content, and one with the speeches in nested wrappers", () => {
      expect(read(content(`<DualDialogue>${speeches}</DualDialogue>`)).filter((b) => b.dual)).toHaveLength(1);
      expect(
        read(content(`<Paragraph Type="Dialogue"><DualDialogue><Paragraph>${speeches}</Paragraph></DualDialogue></Paragraph>`)).filter(
          (b) => b.dual
        )
      ).toHaveLength(1);
    });

    it("flags only the second cue, whatever follows, and keeps what is around the pair in order", () => {
      const blocks = read(
        content(
          `<Paragraph Type="Action"><Text>Before.</Text></Paragraph><Paragraph><DualDialogue>${speeches}<Paragraph Type="Character"><Text>C</Text></Paragraph></DualDialogue></Paragraph><Paragraph Type="Action"><Text>After.</Text></Paragraph>`
        )
      );
      expect(blocks.map(text)).toEqual(["Before.", "A", "One.", "B", "x", "Two.", "C", "After."]);
      expect(blocks.filter((b) => b.dual).map(text)).toEqual(["B"]);
    });
  });

  describe("the title page", () => {
    const page = (inner: string) =>
      `<?xml version="1.0"?><FinalDraft><Content><Paragraph Type="Action"><Text>x</Text></Paragraph></Content><TitlePage><Content>${inner}</Content></TitlePage></FinalDraft>`;
    const p = (align: string, line: string) =>
      `<Paragraph Alignment="${align}" Type="Action"><Text>${line}</Text></Paragraph>`;

    it("sorts a Final Draft style page: one group of centered lines, contact at the left, a draft at the right", () => {
      const script = scriptFromFdx(
        page(
          p("Center", "BRICK &amp; STEEL") +
            p("Center", "FULL RIDE") +
            p("Center", "Written by") +
            p("Center", "Stu Maschwitz") +
            p("Center", "Based on the novel by Someone") +
            p("Left", "Stu Maschwitz") +
            p("Left", "1 Main St") +
            p("Left", "stu@example.com") +
            p("Right", "Second draft")
        )
      );
      expect(script.titlePage).toEqual({
        title: "BRICK & STEEL FULL RIDE",
        credit: "Written by",
        author: "Stu Maschwitz",
        source: "Based on the novel by Someone",
        draftDate: "Second draft",
        contact: "Stu Maschwitz\n1 Main St\nstu@example.com",
      });
      expect(script.title).toBe("BRICK & STEEL FULL RIDE");
      expect(script.author).toBe("Stu Maschwitz");
    });

    it("reads blank paragraphs as the gaps between groups", () => {
      const script = scriptFromFdx(
        page(p("Center", "NIGHT SHIFT") + p("Center", "") + p("Center", "Escrito por") + p("Center", "") + p("Center", "Jo Writer"))
      );
      expect(script.titlePage).toMatchObject({ title: "NIGHT SHIFT", credit: "Escrito por", author: "Jo Writer" });
    });

    it("takes a title and a name with no credit between them as title and author", () => {
      expect(scriptFromFdx(page(p("Center", "NIGHT SHIFT") + p("Center", "") + p("Center", "Jo Writer"))).titlePage).toMatchObject({
        title: "NIGHT SHIFT",
        credit: "",
        author: "Jo Writer",
      });
      expect(scriptFromFdx(page(p("Center", "NIGHT SHIFT") + p("Center", "Jo Writer"))).titlePage).toMatchObject({
        title: "NIGHT SHIFT",
        author: "Jo Writer",
      });
    });

    it("takes a date-looking left line as the draft date, and a lone title as just a title", () => {
      const script = scriptFromFdx(page(p("Center", "NIGHT SHIFT") + p("Left", "Draft: 1/2/2026") + p("Left", "jo@example.com")));
      expect(script.titlePage).toMatchObject({ title: "NIGHT SHIFT", draftDate: "Draft: 1/2/2026", contact: "jo@example.com" });
    });

    it("has no title page when its paragraphs are empty, and none when the file has none", () => {
      expect(scriptFromFdx(page(p("Center", "") + p("Left", ""))).titlePage).toBeUndefined();
      const none = scriptFromFdx(content('<Paragraph Type="Action"><Text>x</Text></Paragraph>'));
      expect(none.titlePage).toBeUndefined();
      expect(none).toMatchObject({ title: "", author: "" });
    });
  });

  it("is one sequence, even for an empty script", () => {
    expect(scriptFromFdx("<FinalDraft><Content/></FinalDraft>").sequences).toEqual([{ title: "", blocks: [] }]);
  });

  it("reads a UTF-8 byte order mark and a truncated file as far as it goes", () => {
    const xml = content('<Paragraph Type="Action"><Text>One.</Text></Paragraph><Paragraph Type="Action"><Text>Two');
    expect(read(`﻿${xml}`).map(text)).toEqual(["One.", "Two"]);
    const cut = '<FinalDraft><Content><Paragraph Type="Action"><Text>One.</Text></Paragraph><Paragraph Type="Ac';
    expect(read(cut).map(text)).toEqual(["One."]);
  });
});

describe("hostile input", () => {
  const notFdx = "That doesn't look like a Final Draft file.";

  it("says plainly when the file is not FDX", () => {
    for (const source of ["", "hello", "{}", "<html><body>hi</body></html>", "<?xml version='1.0'?><screenplay/>", "%PDF-1.7 \u0000"]) {
      expect(() => scriptFromFdx(source)).toThrow(notFdx);
    }
  });

  it("refuses nesting no real file has, quickly", () => {
    const started = Date.now();
    expect(() => scriptFromFdx(`<FinalDraft>${"<a>".repeat(100_000)}`)).toThrow(/nested too deeply/);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("reads a five megabyte Text node", () => {
    const big = "a".repeat(5 * 1024 * 1024);
    const started = Date.now();
    const blocks = read(content(`<Paragraph Type="Action"><Text>${big}</Text></Paragraph>`));
    expect(blocks).toHaveLength(1);
    expect(text(blocks[0])).toHaveLength(big.length);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("never expands an entity a file declares", () => {
    const xml =
      '<?xml version="1.0"?><!DOCTYPE FinalDraft [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>' +
      '<FinalDraft><Content><Paragraph Type="Action"><Text>&b; &#0; &#xD800; &#x110000; &unknown;</Text></Paragraph></Content></FinalDraft>';
    expect(read(xml).map(text)).toEqual(["&b; &#0; &#xD800; &#x110000; &unknown;"]);
  });

  it("stops at a tag that never ends instead of searching on", () => {
    const started = Date.now();
    const xml = `<FinalDraft><Content><Paragraph Type="Action"><Text>One.</Text></Paragraph><Paragraph x="${"y".repeat(2_000_000)}`;
    expect(read(xml).map(text)).toEqual(["One."]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("reads two hundred thousand paragraphs in a moment", () => {
    const started = Date.now();
    const blocks = read(content('<Paragraph Type="Action"><Text>x</Text></Paragraph>'.repeat(200_000)));
    expect(blocks).toHaveLength(200_000);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("does not confuse an end tag with a different element's for the structure above it", () => {
    const blocks = read(content('<Paragraph Type="Action"><Text>One.</Paragraph></Text></Paragraph><Paragraph Type="Action"><Text>Two.</Text></Paragraph>'));
    expect(blocks.map(text)).toEqual(["One.", "Two."]);
  });
});

describe("importing FDX", () => {
  const bytes = (xml: string) => new TextEncoder().encode(xml);

  it("knows the .fdx extension, and lists the format", () => {
    expect(detectFormat("script.fdx")).toBe("fdx");
    expect(detectFormat("Script.FDX")).toBe("fdx");
    expect(IMPORT_FORMATS).toContain("fdx");
  });

  it("makes a screenplay of one sequence, with its title page, scene numbers and dual dialogue", () => {
    const xml = fdxFromScript(NIGHT_SHIFT_FDX, { sceneNumbers: true });
    const imported = importFile("night-shift.fdx", bytes(xml));
    expect(imported.kind).toBe("screenplay");
    expect(imported.title).toBe("NIGHT SHIFT");
    expect(imported.author).toBe("Jo Writer");
    expect(imported.chapters).toHaveLength(1);
    expect(imported.script?.sceneNumbers).toBe(true);
    expect(imported.script?.titlePage?.contact).toBe("Jo Writer\n12 Main St\njo@example.com");
    const html = imported.chapters[0].html;
    expect(html).toContain('<p data-sp="character" data-sp-dual="1">STEEL</p>');
    expect(html).toContain('<p data-sp="centered">THE END</p>');
    expect(styledBlocksFromHtml(html).filter((b) => b.dual)).toHaveLength(1);
    expect(html).toBe(scriptBlocksToHtml(blocksOf(scriptFromFdx(xml))));
  });

  it("falls back to the file's name when the file has no title", () => {
    const imported = importFile("Draft 3.fdx", bytes(content('<Paragraph Type="Action"><Text>Hi.</Text></Paragraph>')));
    expect(imported.title).toBe("Draft 3");
    expect(imported.author).toBeUndefined();
  });

  it("reads a UTF-16 file", () => {
    const xml = content('<Paragraph Type="Action"><Text>café</Text></Paragraph>');
    const le = new Uint8Array(Buffer.from(`﻿${xml}`, "utf16le"));
    expect(decodeFdx(le)).toContain("café");
    expect(parseFdx(decodeFdx(le)).chapters[0].html).toContain("café");
    const be = Buffer.from(`﻿${xml}`, "utf16le").swap16();
    expect(decodeFdx(new Uint8Array(be))).toContain("café");
  });

  it("refuses a file that is not FDX, or has nothing in it, in words the author can read", () => {
    expect(() => importFile("a.fdx", bytes("not xml"))).toThrow(ImportError);
    expect(() => importFile("a.fdx", bytes("not xml"))).toThrow("That doesn't look like a Final Draft file.");
    expect(() => importFile("a.fdx", bytes("<FinalDraft><Content/></FinalDraft>"))).toThrow("Nothing to import");
  });
});

describe("open-source readers as oracles", () => {
  const golden = fixture("night-shift.fdx");

  it("a strict XML parser accepts the file the way every reader below does", () => {
    const doc = new DOMParser().parseFromString(golden, "text/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  });

  it("afterwriting's FDX converter sees the same script in our file", () => {
    // afterwriting.fountain is that converter's output for night-shift.fdx (see the note in the file).
    const theirs = scriptFromFountain(fixture("afterwriting.fountain"));
    const ours = scriptFromFdx(golden);
    // It joins a paragraph's Text runs with a space, so its text is compared without any.
    const bare = (blocks: StyledBlock[]) => squeezed(blocks).map((line) => line.replace(/\s+/g, ""));
    expect(bare(blocksOf(ours))).toEqual(bare(blocksOf(theirs)));
    // Including the pair that sits side by side, the centered line and the title.
    expect(squeezed(blocksOf(theirs))).toContain("character ^: STEEL");
    expect(squeezed(blocksOf(theirs))).toContain("centered: THE END");
    expect(theirs.titlePage).toMatchObject({
      title: ours.titlePage?.title,
      credit: ours.titlePage?.credit,
      author: ours.titlePage?.author,
    });
  });

  it("@draftfirst/core reads the same paragraphs, numbers and title page", () => {
    const { script, diagnostics } = draftFirstParse(golden);
    // The one thing it notes is the paragraph that wraps the DualDialogue.
    expect(diagnostics.map((d) => d.code)).toEqual(["FDX_NESTED_PARAGRAPH"]);
    const theirs = script.elements.filter((e) => e.text !== "");
    const ours = blocksOf(scriptFromFdx(golden));
    const typeOf: Record<string, string> = {
      "scene-heading": "scene",
      // It reads centered text only from a General paragraph; an Action with a center alignment is action to it.
      centered: "action",
    };
    expect(theirs.map((e) => [e.type, e.text.replace(/\s+/g, " ")])).toEqual(
      ours.map((b) => [typeOf[b.element] ?? b.element, (b.element === "parenthetical" ? `(${text(b)})` : text(b)).replace(/\s+/g, " ")])
    );
    expect(theirs.filter((e) => e.type === "scene").map((e) => e.sceneNumber)).toEqual(["1", "2"]);
    const page = Object.fromEntries(script.titlePage.map((entry) => [entry.key, entry.values]));
    expect(page.Title).toEqual(["NIGHT SHIFT"]);
    expect(page.Credit).toEqual(["Written by"]);
    expect(page.Author).toEqual(["Jo Writer"]);
    expect(page.Source).toEqual(["Based on a true story"]);
  });

  it("screenplain's FDX for a Fountain script reads as the Fountain does", () => {
    const fountain = scriptFromFountain(fixture("screenplain-night.fountain"));
    const theirs = scriptFromFdx(fixture("screenplain-night.fdx"));
    expect(detail(blocksOf(theirs))).toEqual(detail(blocksOf(fountain)));
    // Its dual dialogue (two pairs), its centered line, its emphasis and its line break inside action all come through.
    expect(blocksOf(theirs).filter((b) => b.dual).map(text)).toEqual(["MARA", "STEEL"]);
    expect(blocksOf(theirs).some((b) => b.element === "centered" && text(b) === "THE END")).toBe(true);
    expect(blocksOf(theirs)[1].runs.some((r) => r.italic && r.text === "MARA")).toBe(true);
    expect(text(blocksOf(theirs)[1])).toContain("presses in.\nShe does not move.");
  });

  it("and what we write for that script says the same as what screenplain writes", () => {
    const fountain = scriptFromFountain(fixture("screenplain-night.fountain"));
    const ours = scriptFromFdx(fdxFromScript(fountain));
    expect(detail(blocksOf(ours))).toEqual(detail(blocksOf(scriptFromFdx(fixture("screenplain-night.fdx")))));
  });
});
