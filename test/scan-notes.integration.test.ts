import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), hasKey: true }));

vi.mock("@/lib/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/anthropic")>()),
  hasAnthropicKey: () => mocks.hasKey,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/tokens";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { createCanvasCard } from "@/lib/canvas";
import { ensureBible, getBibleFile, writeBibleFile } from "@/lib/bible";
import { applyScannedNotes, readScannedNotes } from "@/lib/scan-notes";
import { SCAN_PAGES_MAX, SCAN_READ_SCHEMA } from "@/lib/scan-notes-view";
import { POST as readRoute } from "@/app/api/projects/[id]/scan-notes/route";
import { POST as applyRoute } from "@/app/api/projects/[id]/scan-notes/apply/route";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

/** The model's reply for one photo: structured output, the JSON as the reply's text. */
function reply(input: unknown, stop_reason = "end_turn") {
  mocks.create.mockResolvedValueOnce({ stop_reason, content: [{ type: "text", text: JSON.stringify(input) }] });
}

async function seed(email = "ada@example.com") {
  const user = await registerUser({ email, password: "long-enough-pw" });
  const project = await createProject(user, { title: "Tides" });
  return { user, project };
}

async function chapterSnapshot(projectId: string) {
  return prisma.chapter.findMany({ where: { projectId }, orderBy: { order: "asc" } });
}

describe("scan notes", () => {
  beforeEach(async () => {
    mocks.hasKey = true;
    mocks.create.mockReset();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("reading", () => {
    it("reads every photo with its own forced tool call, in order, and returns one scan", async () => {
      const { user, project } = await seed();
      reply({ text: "# Kell\n- salt town", legibility: "clear", kind: "world", title: "Kell" });
      reply({ text: "- the fire [?]", legibility: "partial", kind: "plot", title: "" });
      const reading = await readScannedNotes(project.id, user, [{ data: JPEG }, { data: JPEG }]);

      expect(reading).toMatchObject({ status: "partial", kind: "world", title: "Kell", uncertain: 1 });
      expect(reading.text).toBe("# Kell\n- salt town\n\n- the fire [?]");

      expect(mocks.create).toHaveBeenCalledTimes(2);
      for (const [request] of mocks.create.mock.calls) {
        // These models reject a forced tool_choice: the reply is held to its shape by structured output.
        expect(request.tool_choice).toBeUndefined();
        expect(request.output_config).toEqual({ format: { type: "json_schema", schema: SCAN_READ_SCHEMA } });
        expect(request.max_tokens).toBeGreaterThan(0);
        const blocks = request.messages[0].content;
        expect(blocks.filter((b: { type: string }) => b.type === "image")).toHaveLength(1);
        expect(blocks[0].source).toMatchObject({ type: "base64", media_type: "image/jpeg" });
        expect(blocks[0].source.data).toBe(Buffer.from(JPEG).toString("base64"));
      }
    });

    it("reads the pages at the same time, so a scan takes as long as one page", async () => {
      const { user, project } = await seed();
      let running = 0;
      let peak = 0;
      mocks.create.mockImplementation(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        running -= 1;
        return {
          stop_reason: "tool_use",
          content: [{ type: "text", text: JSON.stringify({ text: "x", legibility: "clear", kind: "other", title: "" }) }],
        };
      });
      await readScannedNotes(project.id, user, Array.from({ length: 4 }, () => ({ data: JPEG })));
      expect(peak).toBe(4);
    });

    it("refuses a bad photo before any model call", async () => {
      const { user, project } = await seed();
      const heic = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
      await expect(readScannedNotes(project.id, user, [{ data: heic }])).rejects.toMatchObject({ status: 415 });
      await expect(readScannedNotes(project.id, user, [])).rejects.toMatchObject({ status: 400 });
      await expect(
        readScannedNotes(project.id, user, Array.from({ length: SCAN_PAGES_MAX + 1 }, () => ({ data: JPEG })))
      ).rejects.toMatchObject({ status: 400 });
      const big = new Uint8Array(5 * 1024 * 1024 + 1);
      big.set([0xff, 0xd8, 0xff]);
      await expect(readScannedNotes(project.id, user, [{ data: big }])).rejects.toMatchObject({ status: 413 });
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it("keeps the pages that read when one page's reply is cut off, and marks that page failed", async () => {
      const { user, project } = await seed();
      reply({ text: "first page", legibility: "clear", kind: "other", title: "" });
      reply({ text: "half of the second", legibility: "clear", kind: "other", title: "" }, "max_tokens");
      const reading = await readScannedNotes(project.id, user, [{ data: JPEG }, { data: JPEG }]);
      expect(reading.status).toBe("partial");
      expect(reading.text).toBe("first page");
      expect(reading.pages.map((p) => p.failed)).toEqual([false, true]);
    });

    it("fails when no page could be read at all (no JSON, the wrong JSON, or a call that errors)", async () => {
      const { user, project } = await seed();
      mocks.create.mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: "Sure! Here it is:" }] });
      await expect(readScannedNotes(project.id, user, [{ data: JPEG }])).rejects.toMatchObject({ status: 502 });
      reply({ nope: true });
      await expect(readScannedNotes(project.id, user, [{ data: JPEG }])).rejects.toMatchObject({ status: 502 });
      mocks.create.mockRejectedValueOnce(new Error("overloaded"));
      await expect(readScannedNotes(project.id, user, [{ data: JPEG }])).rejects.toMatchObject({ status: 502 });
    });

    it("reports a scan with no writing as unreadable instead of failing", async () => {
      const { user, project } = await seed();
      reply({ text: "", legibility: "unreadable", kind: "other", title: "" });
      const reading = await readScannedNotes(project.id, user, [{ data: JPEG }]);
      expect(reading.status).toBe("unreadable");
      expect(reading.text).toBe("");
    });

    it("needs a key, and only reads for the project's owner", async () => {
      const { user, project } = await seed();
      mocks.hasKey = false;
      await expect(readScannedNotes(project.id, user, [{ data: JPEG }])).rejects.toMatchObject({ status: 503 });
      mocks.hasKey = true;
      const other = await seed("bob@example.com");
      await expect(readScannedNotes(project.id, other.user, [{ data: JPEG }])).rejects.toMatchObject({});
      expect(mocks.create).not.toHaveBeenCalled();
    });
  });

  describe("adding to the story bible", () => {
    it("appends a dated section to an existing file and keeps everything already there", async () => {
      const { user, project } = await seed();
      await ensureBible(project.id);
      const before = await getBibleFile(project.id, "world.md");
      const result = await applyScannedNotes(project.id, user, {
        text: "# Kell\n- salt town",
        destination: { type: "bible", mode: "append", path: "world.md" },
      });
      expect(result).toMatchObject({ destination: "bible", path: "world.md", created: false });
      const after = await getBibleFile(project.id, "world.md");
      expect(after!.content.startsWith(before!.content.trimEnd())).toBe(true);
      expect(after!.content).toMatch(/## Scanned notes \(\d{4}-\d{2}-\d{2}\)\n\n### Kell\n- salt town\n$/);
      expect(after!.revision).toBe(before!.revision + 1);
    });

    it("adding the same notes again changes nothing", async () => {
      const { user, project } = await seed();
      const body = { text: "- one", destination: { type: "bible", mode: "append", path: "canon.md" } };
      await applyScannedNotes(project.id, user, body);
      const once = await getBibleFile(project.id, "canon.md");
      await applyScannedNotes(project.id, user, body);
      const twice = await getBibleFile(project.id, "canon.md");
      expect(twice).toEqual(once);
    });

    it("loses nothing when two scans land on one file at once", async () => {
      const { user, project } = await seed();
      await ensureBible(project.id);
      await Promise.all(
        ["- alpha", "- beta", "- gamma"].map((text) =>
          applyScannedNotes(project.id, user, { text, destination: { type: "bible", mode: "append", path: "plot.md" } })
        )
      );
      const { content } = (await getBibleFile(project.id, "plot.md"))!;
      for (const word of ["alpha", "beta", "gamma"]) expect(content).toContain(`- ${word}`);
    });

    it("refuses a path that is missing, not markdown, or escapes the bible", async () => {
      const { user, project } = await seed();
      const append = (path: string) =>
        applyScannedNotes(project.id, user, { text: "x", destination: { type: "bible", mode: "append", path } });
      await expect(append("characters/nobody.md")).rejects.toMatchObject({ status: 404 });
      await expect(append("../secrets.md")).rejects.toMatchObject({ status: 400 });
      await expect(append("notes.txt")).rejects.toMatchObject({ status: 400 });
      expect(await prisma.bibleFile.findUnique({ where: { projectId_path: { projectId: project.id, path: "notes.txt" } } })).toBeNull();
    });

    it("creates a new character from the usual template with the notes under it", async () => {
      const { user, project } = await seed();
      const result = await applyScannedNotes(project.id, user, {
        text: "- grew up in Hull\n- left at sixteen",
        destination: { type: "bible", mode: "new", kind: "character", name: "Mara Vale" },
      });
      expect(result).toMatchObject({ destination: "bible", path: "characters/mara-vale.md", created: true });
      const file = await getBibleFile(project.id, "characters/mara-vale.md");
      expect(file!.content.startsWith("# Mara Vale\n> Character\n")).toBe(true);
      expect(file!.content).toContain("## Voice");
      expect(file!.content).toMatch(/## Scanned notes \([\d-]+\)\n\n- grew up in Hull\n- left at sixteen\n$/);
    });

    it("joins a character that already exists instead of replacing it", async () => {
      const { user, project } = await seed();
      await writeBibleFile(project.id, "characters/mara-vale.md", "# Mara Vale\n> Character\n\n**Role:** the detective\n");
      const result = await applyScannedNotes(project.id, user, {
        text: "- afraid of boats",
        destination: { type: "bible", mode: "new", kind: "character", name: "Mara Vale" },
      });
      expect(result).toMatchObject({ path: "characters/mara-vale.md", created: false });
      const file = await getBibleFile(project.id, "characters/mara-vale.md");
      expect(file!.content).toContain("**Role:** the detective");
      expect(file!.content).toContain("- afraid of boats");
    });

    it("creates a plot line the same way", async () => {
      const { user, project } = await seed();
      const result = await applyScannedNotes(project.id, user, {
        text: "- the ledger goes missing",
        destination: { type: "bible", mode: "new", kind: "plot", name: "The ledger" },
      });
      expect(result).toMatchObject({ path: "plot/the-ledger.md", created: true });
      expect((await getBibleFile(project.id, "plot/the-ledger.md"))!.content).toContain("## Payoff");
    });

    it("never touches a chapter", async () => {
      const { user, project } = await seed();
      const before = await chapterSnapshot(project.id);
      await applyScannedNotes(project.id, user, {
        text: "- x",
        destination: { type: "bible", mode: "append", path: "canon.md" },
      });
      expect(await chapterSnapshot(project.id)).toEqual(before);
    });
  });

  describe("adding to the canvas", () => {
    it("makes a card per line below the existing cards, with an arrow per nested line", async () => {
      const { user, project } = await seed();
      const premise = await createCanvasCard(project.id, user, { title: "Premise", x: 120, y: 300 });
      const chapters = await chapterSnapshot(project.id);
      const result = await applyScannedNotes(project.id, user, {
        text: "- Act one\n  - Mara arrives\n  - The letter\n- Act two",
        destination: { type: "canvas" },
      });
      expect(result).toEqual({ destination: "canvas", cards: 4, arrows: 2 });

      const cards = await prisma.canvasCard.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } });
      expect(cards.map((c) => c.title).sort()).toEqual(["Act one", "Act two", "Mara arrives", "Premise", "The letter"]);
      for (const card of cards.filter((c) => c.id !== premise.id)) expect(card.y).toBeGreaterThan(premise.y);

      const byTitle = new Map(cards.map((c) => [c.title, c]));
      const edges = await prisma.canvasEdge.findMany({ where: { projectId: project.id } });
      expect(edges).toHaveLength(2);
      for (const edge of edges) expect(edge.fromId).toBe(byTitle.get("Act one")!.id);
      expect(await chapterSnapshot(project.id)).toEqual(chapters);
    });

    it("starts at the corner of an empty board", async () => {
      const { user, project } = await seed();
      await applyScannedNotes(project.id, user, { text: "- only", destination: { type: "canvas" } });
      const [card] = await prisma.canvasCard.findMany({ where: { projectId: project.id } });
      // placeOutline centres a lone root over its column: 80 + 276 / 2 - 240 / 2.
      expect([card!.x, card!.y]).toEqual([98, 80]);
    });

    it("adds nothing when the notes would not fit on the board", async () => {
      const { user, project } = await seed();
      await prisma.canvasCard.createMany({
        data: Array.from({ length: 198 }, (_, i) => ({ projectId: project.id, title: `c${i}`, x: i, y: i })),
      });
      await expect(
        applyScannedNotes(project.id, user, { text: "- a\n- b\n- c", destination: { type: "canvas" } })
      ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Nothing was added") });
      expect(await prisma.canvasCard.count({ where: { projectId: project.id } })).toBe(198);
      expect(await prisma.canvasEdge.count({ where: { projectId: project.id } })).toBe(0);
    });

    it("refuses notes with nothing to add, and another author's project", async () => {
      const { user, project } = await seed();
      await expect(applyScannedNotes(project.id, user, { text: " ", destination: { type: "canvas" } })).rejects.toMatchObject({
        status: 400,
      });
      const other = await seed("bob@example.com");
      await expect(
        applyScannedNotes(project.id, other.user, { text: "- x", destination: { type: "canvas" } })
      ).rejects.toMatchObject({});
      expect(await prisma.canvasCard.count({ where: { projectId: project.id } })).toBe(0);
    });
  });

  describe("routes", () => {
    async function authed() {
      const user = await prisma.user.create({ data: { email: "route@example.com", name: "Route", passwordHash: "" } });
      await prisma.session.create({
        data: { userId: user.id, tokenHash: hashSessionToken("route-token"), expiresAt: new Date(Date.now() + 3_600_000) },
      });
      const project = await prisma.project.create({ data: { userId: user.id, title: "Tides" } });
      return { project };
    }
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

    it("reads photos sent as multipart and answers with the reading", async () => {
      process.env.CICIRO_REQUIRE_AUTH = "true";
      try {
        const { project } = await authed();
        reply({ text: "- a note", legibility: "clear", kind: "outline", title: "" });
        const form = new FormData();
        form.append("page", new File([JPEG], "page-1.jpg", { type: "image/jpeg" }));
        const res = await readRoute(
          new NextRequest(`http://localhost/api/projects/${project.id}/scan-notes`, {
            method: "POST",
            headers: { [SESSION_HEADER]: "route-token" },
            body: form,
          }),
          ctx(project.id)
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ text: "- a note", status: "ok", kind: "outline" });

        const none = await readRoute(
          new NextRequest(`http://localhost/api/projects/${project.id}/scan-notes`, {
            method: "POST",
            headers: { [SESSION_HEADER]: "route-token" },
            body: new FormData(),
          }),
          ctx(project.id)
        );
        expect(none.status).toBe(400);
      } finally {
        delete process.env.CICIRO_REQUIRE_AUTH;
      }
    });

    it("adds text sent as JSON and rejects a body that names no destination", async () => {
      process.env.CICIRO_REQUIRE_AUTH = "true";
      try {
        const { project } = await authed();
        const post = (body: unknown) =>
          applyRoute(
            new NextRequest(`http://localhost/api/projects/${project.id}/scan-notes/apply`, {
              method: "POST",
              headers: { "content-type": "application/json", [SESSION_HEADER]: "route-token" },
              body: JSON.stringify(body),
            }),
            ctx(project.id)
          );
        const ok = await post({ text: "- one\n- two", destination: { type: "canvas" } });
        expect(ok.status).toBe(201);
        expect(await ok.json()).toEqual({ destination: "canvas", cards: 2, arrows: 0 });
        const bad = await post({ text: "- one" });
        expect(bad.status).toBe(400);
        expect(await bad.json()).toEqual({ error: "Choose where to add the notes." });
      } finally {
        delete process.env.CICIRO_REQUIRE_AUTH;
      }
    });
  });
});
