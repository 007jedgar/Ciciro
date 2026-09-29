import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { strFromU8, unzipSync } from "fflate";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/tokens";
import { buildMarkdown } from "@/lib/export/markdown";
import { DOCX_WORD_BUDGET, EXPORTED_MODELS, accountExportStream } from "@/lib/account/export";
import { GET } from "@/app/api/account/export/route";
import { allModelNames, seedAccount, wipeDatabase } from "./account-fixture";

async function readAll(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { bytes, chunks };
}

function unzipText(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  return Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => !name.endsWith(".docx"))
      .map(([name, data]) => [name, strFromU8(data)])
  );
}

function exportRequest(token: string | null) {
  return new NextRequest("http://localhost/api/account/export", {
    headers: token ? { [SESSION_HEADER]: token } : {},
  });
}

// Deterministic, poorly compressible prose so the large test moves real bytes.
function prose(seed: number, words: number): string {
  const vocab = "salt wind girl pans ran over the harbour lamp keeper tide rope gull bell stone quiet morning ".split(" ");
  let x = seed || 1;
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out.push(`${vocab[x % (vocab.length - 1)]}${x % 97}`);
  }
  return out.join(" ");
}

describe("account data export", () => {
  beforeEach(wipeDatabase);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("covers every model", () => {
    expect([...EXPORTED_MODELS].sort()).toEqual(allModelNames().sort());
  });

  it("requires a session", async () => {
    const res = await GET(exportRequest(null));
    expect(res.status).toBe(401);
  });

  it("downloads everything the account owns, and nothing else", async () => {
    const other = await seedAccount("other");
    const me = await seedAccount("mine");

    const res = await GET(exportRequest(me.sessionToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="ciciro-data-\d{4}-\d{2}-\d{2}\.zip"$/
    );
    const { bytes } = await readAll(res.body!);
    const files = unzipText(bytes);

    const account = JSON.parse(files["data/account.json"]);
    expect(account).toMatchObject({
      id: me.userId,
      email: "mine@example.com",
      name: "Author mine",
      settings: { theme: "night", editorFontSize: 19 },
    });
    expect(account).not.toHaveProperty("passwordHash");

    // Every table file is valid JSON holding only this account's rows.
    for (const [name, text] of Object.entries(files)) {
      if (name.startsWith("data/") && name !== "data/account.json") {
        const rows = JSON.parse(text) as unknown[];
        expect(rows.length, `${name} is empty`).toBeGreaterThan(0);
      }
      expect(text, `${name} leaks the other account`).not.toContain("other");
    }
    const chapters = JSON.parse(files["data/chapters.json"]) as { title: string; archivedAt: string | null }[];
    expect(chapters.map((c) => c.title).sort()).toEqual(["Cut scene", "Opening"]);
    expect(JSON.parse(files["data/chapter-edit-log.json"])[0].payload).toEqual({
      blockId: "b1",
      html: "<p>x</p>",
    });
    expect(JSON.parse(files["data/writing-days.json"])[0]).toMatchObject({ words: 500 });
    expect(JSON.parse(files["data/sign-in-sessions.json"])[0]).toMatchObject({ userAgent: "vitest" });
    expect(JSON.parse(files["data/email-links.json"])[0]).toMatchObject({
      purpose: "verify_email",
      email: "mine@example.com",
    });

    // No secrets: password hash, session token hash, share token, reader IP hash.
    const everything = Object.values(files).join("\n");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: me.userId } });
    expect(everything).not.toContain(row.passwordHash);
    expect(everything).not.toContain(hashSessionToken(me.sessionToken));
    expect(everything).not.toContain(hashSessionToken("mine-email-token"));
    expect(everything).not.toContain("mine-share-token");
    expect(everything).not.toContain("mine-client-hash");
    expect(everything).not.toContain("tokenHash");
    expect(everything).not.toContain("lockToken");

    // The manuscript, readable without Ciciro.
    const folder = "manuscripts/The mine Book";
    expect(files[`${folder}/The mine Book.md`]).toBe(
      buildMarkdown({
        title: "The mine Book",
        author: "Author mine",
        chapters: [{ title: "Opening", order: 0, content: "<p>The mine chapter begins.</p>" }],
      })
    );
    expect(files[`${folder}/story-bible/characters/hero.md`]).toBe("# Hero\n\nBrave.");
    expect(files[`${folder}/scratchpad.md`]).toBe("## Research\n\nSalt pans\n");
    const docx = await JSZip.loadAsync(unzipSync(bytes)[`${folder}/The mine Book.docx`]);
    const xml = await docx.file("word/document.xml")!.async("string");
    expect(xml).toContain("The mine chapter begins.");
    expect(xml).not.toContain("Archived words.");
    expect(other.userId).not.toBe(me.userId);
  });

  it("keeps same-named manuscripts apart and bible paths inside their folder", async () => {
    const me = await seedAccount("mine");
    const twin = await prisma.project.create({
      data: { userId: me.userId, title: "The mine Book", author: "Author mine" },
    });
    await prisma.bibleFile.create({
      data: { projectId: twin.id, path: "../../escape.md", content: "stay put" },
    });
    await prisma.project.create({ data: { userId: me.userId, title: "a/b: c?" } });

    const files = unzipText((await readAll(accountExportStream(me.userId))).bytes);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "manuscripts/The mine Book/The mine Book.md",
        "manuscripts/The mine Book (2)/The mine Book (2).md",
        "manuscripts/The mine Book (2)/story-bible/escape.md",
        "manuscripts/a b c/a b c.md",
      ])
    );
    expect(Object.keys(files).every((name) => !name.includes(".."))).toBe(true);
  });

  it("ends with a manifest that counts every data file", async () => {
    const me = await seedAccount("mine");
    const files = unzipText((await readAll(accountExportStream(me.userId))).bytes);
    const names = Object.keys(files);
    expect(names[names.length - 1]).toBe("manifest.json");
    const manifest = JSON.parse(files["manifest.json"]);
    expect(manifest.completed).toBe(true);
    for (const [file, count] of Object.entries(manifest.records as Record<string, number>)) {
      const data = JSON.parse(files[`data/${file}.json`]);
      expect(Array.isArray(data) ? data.length : 1, file).toBe(count);
    }
    expect(manifest.records.chapters).toBeGreaterThan(0);
  });

  it("streams a large account in bounded chunks", async () => {
    const me = await seedAccount("mine");
    const CHAPTERS = 240;
    const WORDS = 2_500; // ~600k words: past the Word budget, so Markdown only
    expect(CHAPTERS * WORDS).toBeGreaterThan(DOCX_WORD_BUDGET);
    const big = await prisma.project.create({
      data: { userId: me.userId, title: "Doorstop", author: "Author mine" },
    });
    await prisma.chapter.createMany({
      data: Array.from({ length: CHAPTERS }, (_, i) => ({
        projectId: big.id,
        title: `Part ${i + 1}`,
        order: i,
        content: `<p>${prose(i + 1, WORDS)}</p>`,
        wordCount: WORDS,
      })),
    });
    const chapters = await prisma.chapter.findMany({ where: { projectId: big.id }, select: { id: true } });
    await prisma.chapterSnapshot.createMany({
      data: chapters.map((c, i) => ({
        chapterId: c.id,
        projectId: big.id,
        kind: "session",
        content: `<p>${prose(i + 1000, WORDS)}</p>`,
      })),
    });
    await prisma.chapterOp.createMany({
      data: Array.from({ length: 6_000 }, (_, i) => ({
        chapterId: chapters[i % chapters.length].id,
        projectId: big.id,
        opId: `op-${i}`,
        seq: Math.floor(i / chapters.length) + 1,
        baseRevision: 0,
        actor: "user",
        type: "replace_block",
        payload: JSON.stringify({ blockId: `b${i}`, html: `<p>${prose(i, 30)}</p>` }),
      })),
    });

    const { bytes, chunks } = await readAll(accountExportStream(me.userId));
    const largest = Math.max(...chunks.map((c) => c.length));
    // The archive leaves in many pieces, none holding more than a page or two
    // of rows, rather than as one buffer the size of the account.
    expect(chunks.length).toBeGreaterThan(40);
    expect(largest).toBeLessThan(2_000_000);
    expect(bytes.length).toBeGreaterThan(10 * largest);

    const files = unzipText(bytes);
    expect(JSON.parse(files["data/chapters.json"])).toHaveLength(CHAPTERS + 2);
    expect(JSON.parse(files["data/chapter-snapshots.json"])).toHaveLength(CHAPTERS + 1);
    expect(JSON.parse(files["data/chapter-edit-log.json"])).toHaveLength(6_001);
    const md = files["manuscripts/Doorstop/Doorstop.md"];
    expect(md.match(/^## Part \d+$/gm)).toHaveLength(CHAPTERS);
    expect(md.indexOf("## Part 240")).toBeGreaterThan(md.indexOf("## Part 239"));
    expect(Object.keys(unzipSync(bytes))).not.toContain("manuscripts/Doorstop/Doorstop.docx");
    expect(Object.keys(files)).toContain("manuscripts/The mine Book/The mine Book.md");
  }, 120_000);
});
