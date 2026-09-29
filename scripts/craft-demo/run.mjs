// Bundles the craft-defaults demo with esbuild (so its "@/lib" imports resolve
// the way Next and Vitest resolve them) and runs it. See cli.ts for options.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(root, ".craft-demo", ".build");
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, "cli.mjs");

await build({
  entryPoints: [join(root, "scripts/craft-demo/cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  alias: { "@": join(root, "src") },
  logLevel: "warning",
});

const { main } = await import(pathToFileURL(outfile).href);
process.exitCode = await main(process.argv.slice(2));
