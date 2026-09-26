import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { diffSchemas, liveSchemaSql, upgradeScriptsFor } from "../scripts/d1-schema.mjs";

const root = join(__dirname, "..");

/** Build a database from `sql`, apply `changes`, and dump it the way D1 reports it. */
function liveFrom(sql: string, changes = ""): string {
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  db.exec(changes);
  const rows = db.prepare("SELECT type, name, sql FROM sqlite_master").all() as Array<{
    type: string;
    name: string;
    sql: string | null;
  }>;
  db.close();
  return liveSchemaSql(rows);
}

describe("diffSchemas against the real Prisma schema", () => {
  let expected = "";
  beforeAll(() => {
    expected = execFileSync(
      "npx",
      ["prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
      { cwd: root, encoding: "utf8" }
    );
  }, 60_000);

  it("passes when D1 matches", () => {
    expect(diffSchemas(expected, liveFrom(expected))).toEqual({ errors: [], warnings: [], missing: [] });
  });

  it("catches the 2026-09-26 outage: Project.kind and new tables never applied", () => {
    const live = liveFrom(
      expected,
      `ALTER TABLE "Project" DROP COLUMN "kind";
       DROP TABLE "WeeklyReview";
       DROP TABLE "ShareComment";
       DROP TABLE "ShareLink";`
    );
    const { errors, missing } = diffSchemas(expected, live);
    expect(errors).toEqual(
      expect.arrayContaining([
        "missing column Project.kind",
        "missing table WeeklyReview",
        "missing table ShareLink",
        "missing table ShareComment",
      ])
    );
    expect(upgradeScriptsFor(join(root, "prisma"), missing)).toEqual([
      "prisma/d1-manuscript-kind.sql",
      "prisma/d1-share-links.sql",
      "prisma/d1-weekly-reviews.sql",
    ]);
  });

  it("ignores D1's own tables", () => {
    const live = liveFrom(expected, `CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID;`);
    expect(diffSchemas(expected, live).errors).toEqual([]);
  });

  it("the suggested scripts bring a stale D1 back in line", () => {
    const stale = liveFrom(
      expected,
      `ALTER TABLE "Project" DROP COLUMN "kind";
       DROP TABLE "ShareComment";
       DROP TABLE "ShareLink";
       DROP TABLE "WeeklyReview";
       DROP TABLE "ProjectRecap";`
    );
    const { missing } = diffSchemas(expected, stale);
    const scripts = upgradeScriptsFor(join(root, "prisma"), missing);
    const fixed = liveFrom(stale, scripts.map((s) => readFileSync(join(root, s), "utf8")).join("\n"));
    expect(diffSchemas(expected, fixed)).toEqual({ errors: [], warnings: [], missing: [] });
  });
});

describe("diffSchemas rules", () => {
  const base = `CREATE TABLE "T" ("id" TEXT NOT NULL PRIMARY KEY, "a" TEXT NOT NULL, "b" INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX "T_a_key" ON "T"("a");
    CREATE INDEX "T_b_idx" ON "T"("b");`;

  it("matches indexes by columns, not by name", () => {
    const live = `CREATE TABLE "T" ("id" TEXT NOT NULL PRIMARY KEY, "a" TEXT NOT NULL, "b" INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX "renamed_unique" ON "T"("a");
      CREATE INDEX "renamed" ON "T"("b");`;
    expect(diffSchemas(base, live).errors).toEqual([]);
    expect(diffSchemas(base, live).warnings).toEqual([]);
  });

  it("fails on a missing unique index but only warns on a missing plain index", () => {
    const live = `CREATE TABLE "T" ("id" TEXT NOT NULL PRIMARY KEY, "a" TEXT NOT NULL, "b" INTEGER NOT NULL DEFAULT 0);`;
    const { errors, warnings } = diffSchemas(base, live);
    expect(errors).toEqual(["missing unique index on T(a)"]);
    expect(warnings).toEqual(["missing index on T(b)"]);
  });

  it("fails on a leftover required column Prisma never writes", () => {
    const live = `CREATE TABLE "T" ("id" TEXT NOT NULL PRIMARY KEY, "a" TEXT NOT NULL, "b" INTEGER NOT NULL DEFAULT 0,
        "old" TEXT NOT NULL, "optional" TEXT, "defaulted" TEXT NOT NULL DEFAULT '');
      CREATE UNIQUE INDEX "T_a_key" ON "T"("a");
      CREATE INDEX "T_b_idx" ON "T"("b");`;
    expect(diffSchemas(base, live).errors).toEqual([
      "T.old is NOT NULL with no default, but Prisma never writes it",
    ]);
  });
});
