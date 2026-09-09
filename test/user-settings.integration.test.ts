import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { getUserSettings, persistSettings, replaceUserSettings, updateUserSettings } from "@/lib/user-settings";

describe("user settings persistence", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns defaults for a new account and stores patches", async () => {
    const user = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const initial = await getUserSettings(user.id);
    expect(initial).toMatchObject({
      theme: "parchment",
      editorFont: "serif",
      editorFontSize: 19,
      autoCorrect: true,
      chatWidth: 380,
    });

    const updated = await updateUserSettings(user.id, {
      theme: "inkwell",
      editorFont: "sans",
      editorFontSize: 23,
      autoCorrect: false,
      chatWidth: 480,
    });
    expect(updated).toMatchObject({
      theme: "inkwell",
      editorFont: "sans",
      editorFontSize: 23,
      autoCorrect: false,
      chatWidth: 480,
    });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(initial.updatedAt));

    const loaded = await getUserSettings(user.id);
    expect(loaded).toEqual(updated);
  });

  it("rejects an empty patch and an unknown theme", async () => {
    const user = await registerUser({
      email: "bob@example.com",
      password: "long-enough-pw",
    });
    await expect(updateUserSettings(user.id, {})).rejects.toMatchObject({ status: 400 });
    await expect(updateUserSettings(user.id, { theme: "neon" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("keeps the newer document when persisting a full copy", async () => {
    const user = await registerUser({
      email: "cam@example.com",
      password: "long-enough-pw",
    });
    const server = await updateUserSettings(user.id, { theme: "ember" });
    const olderLocal = {
      ...server,
      theme: "sage" as const,
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    await persistSettings(user.id, server);
    const kept = await getUserSettings(user.id);
    expect(kept.theme).toBe("ember");

    const newerLocal = {
      ...server,
      theme: "candle" as const,
      editorFont: "sans" as const,
      updatedAt: new Date(Date.parse(server.updatedAt) + 60_000).toISOString(),
    };
    await persistSettings(user.id, newerLocal);
    expect((await getUserSettings(user.id)).theme).toBe("candle");
    expect(olderLocal.theme).toBe("sage");
  });

  it("rejects a PUT without updatedAt and keeps the newer document", async () => {
    const user = await registerUser({
      email: "dee@example.com",
      password: "long-enough-pw",
    });
    const server = await updateUserSettings(user.id, { theme: "ember" });
    await expect(replaceUserSettings(user.id, { theme: "sage" })).rejects.toMatchObject({
      status: 400,
    });
    expect((await getUserSettings(user.id)).theme).toBe("ember");

    const kept = await replaceUserSettings(user.id, {
      ...server,
      theme: "sage",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(kept.theme).toBe("ember");

    const replaced = await replaceUserSettings(user.id, {
      ...server,
      theme: "candle",
      editorFont: "sans",
      updatedAt: new Date(Date.parse(server.updatedAt) + 60_000).toISOString(),
    });
    expect(replaced.theme).toBe("candle");
  });
});
