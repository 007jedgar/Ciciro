import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffSchemas, liveSchemaSql, upgradeScriptsFor } from "./d1-schema.mjs";

/**
 * Refuse to ship a build whose Prisma schema the production D1 cannot serve.
 *
 * `prisma db push` never reaches the Worker's D1, so schema changes ship as
 * `prisma/d1-*.sql` scripts someone has to run by hand. When they are missed,
 * Prisma selects columns that do not exist and nearly every route 500s. This
 * compares the live D1 with `prisma/schema.prisma` before the deploy happens.
 *
 * Usage: node scripts/check-d1-schema.mjs [--warn-only] [--local]
 * `--local` checks wrangler's local D1 instead of production. Arguments after
 * `--` go to wrangler, e.g. `-- --persist-to=<dir>`.
 * Skip in an emergency with CICIRO_SKIP_D1_CHECK=1.
 *
 * Reads D1 with `wrangler d1 execute --remote`, so the credentials running it
 * need D1 read access. On Workers Builds that is the build API token.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATABASE = "DB";
const separator = process.argv.indexOf("--");
const wranglerArgs = separator === -1 ? [] : process.argv.slice(separator + 1);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed:\n${output}`);
  }
  return result.stdout;
}

function expectedSql() {
  return run("npx", [
    "prisma",
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--script",
  ]);
}

function liveSql() {
  const out = run("npx", [
    "wrangler",
    "d1",
    "execute",
    DATABASE,
    process.argv.includes("--local") ? "--local" : "--remote",
    "--json",
    "--command",
    "SELECT type, name, sql FROM sqlite_master",
    ...wranglerArgs,
  ]);
  // Wrangler can print a banner before the JSON.
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  return liveSchemaSql(parsed[0].results);
}

function main() {
  const warnOnly = process.argv.includes("--warn-only");
  if (process.env.CICIRO_SKIP_D1_CHECK === "1") {
    console.warn("D1 schema check skipped (CICIRO_SKIP_D1_CHECK=1).");
    return 0;
  }
  const fail = warnOnly ? 0 : 1;

  let live;
  try {
    live = liveSql();
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    console.error(
      "\nCould not read the production D1 schema. On Workers Builds, give the build API token" +
        " Account > D1 > Read (My Profile > API Tokens). Set CICIRO_SKIP_D1_CHECK=1 to deploy anyway."
    );
    return fail;
  }

  const { errors, warnings, missing } = diffSchemas(expectedSql(), live);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (errors.length === 0) {
    console.log("D1 schema check passed: production D1 has everything prisma/schema.prisma needs.");
    return 0;
  }

  console.error("Production D1 is behind prisma/schema.prisma:");
  for (const error of errors) console.error(`  - ${error}`);
  const scripts = upgradeScriptsFor(join(root, "prisma"), missing);
  if (scripts.length) {
    console.error("\nApply these before deploying:");
    for (const script of scripts) console.error(`  npx wrangler d1 execute ciciro --remote --file=${script}`);
  } else {
    console.error("\nNo prisma/d1-*.sql script covers this yet. Write one (see docs/hosting.md) and apply it.");
  }
  console.error("\nSet CICIRO_SKIP_D1_CHECK=1 to deploy anyway.");
  return fail;
}

process.exitCode = main();
