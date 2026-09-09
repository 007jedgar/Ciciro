import { spawnSync } from "node:child_process";

/**
 * Workers Builds runs `npm run build`, then `wrangler versions upload`.
 * Wrangler expects `.open-next/assets` from the OpenNext adapter. A plain
 * `next build` never creates that directory, so CI would fail the upload.
 *
 * OpenNext itself invokes `npm run build` for the Next compile. When that
 * nested call happens we skip the adapter and run prisma + next only.
 */
const workersCi = process.env.WORKERS_CI === "1";
const nested = process.env.CICIRO_OPENNEXT === "1";

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: false,
  });
  if (result.status) process.exit(result.status);
}

if (workersCi && !nested) {
  run("npx", ["opennextjs-cloudflare", "build"], { CICIRO_OPENNEXT: "1" });
} else {
  run("npx", ["prisma", "generate"]);
  run("npx", ["next", "build"]);
}
