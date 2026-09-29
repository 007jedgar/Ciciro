import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, registerUser } from "@/lib/auth/session";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { GET } from "@/app/api/models/route";

// The models resolve once, at import, and Prisma loads a developer's .env
// before that. Blank overrides win (dotenv never replaces a set variable), so
// this asserts the shipped defaults whatever .env says.
vi.hoisted(() => {
  for (const name of [
    "CICIRO_EDITOR_MODEL",
    "CICIRO_MODEL",
    "CICIRO_DRAFTER_MODEL",
    "CICIRO_DRAFTER_FAST_MODEL",
  ]) {
    process.env[name] = "";
  }
});

describe("GET /api/models", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("requires a session", async () => {
    const res = await GET(new NextRequest("http://localhost/api/models"));
    expect(res.status).toBe(401);
  });

  it("returns the resolved editor, drafter and quick-draft models for a signed-in user", async () => {
    const user = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
    const session = await createSession(user.id);
    const res = await GET(
      new NextRequest("http://localhost/api/models", {
        headers: { [SESSION_HEADER]: session },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slots).toEqual([
      { key: "editor", role: "Editor", id: "claude-opus-5-5", name: "Claude Opus 5.5" },
      { key: "drafter", role: "Drafter", id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      { key: "quickDrafts", role: "Quick drafts", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/sk-ant|api[_-]?key/i);
  });
});
