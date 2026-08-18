import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = mkdtempSync(join(tmpdir(), "ciciro-vitest-"));
const env = {
  ...process.env,
  DATABASE_URL: `file:${join(tempDir, "test.db")}`,
  NODE_ENV: "test",
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  const syncStatus = run("npx", [
    "prisma",
    "db",
    "push",
    "--skip-generate",
    "--accept-data-loss",
  ]);
  if (syncStatus !== 0) process.exitCode = syncStatus;
  else process.exitCode = run("npx", ["vitest", "run", ...process.argv.slice(2)]);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
