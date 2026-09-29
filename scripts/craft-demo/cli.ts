// Command line for the craft-defaults side-by-side demo. Run it through
// `npm run demo:craft -- [options]` (scripts/craft-demo/run.mjs bundles it so
// the "@/lib" imports resolve). Writes index.html and results.json.
//
//   --dry-run        mock client: no key, no cost; prints the estimated real cost
//   --samples N      samples per scene and arm (default 3)
//   --scenes a,b     only these scene ids (default: all)
//   --out DIR        output directory (default .craft-demo)
//   --concurrency N  scene samples in flight at once (default 4)
//   --max-usd N      refuse a real run whose estimate is above N (default 25)

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { costOf, runDemo } from "./engine";
import { mockClient } from "./mock";
import { renderPage } from "./render";
import { SCENES } from "./scenes";

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const samples = Math.max(1, Number(arg(args, "samples") || 3));
  const concurrency = Math.max(1, Number(arg(args, "concurrency") || 4));
  const maxUsd = Number(arg(args, "max-usd") || 25);
  const out = resolve(arg(args, "out") || ".craft-demo");
  const only = arg(args, "scenes")?.split(",").map((s) => s.trim()).filter(Boolean);
  const scenes = only ? SCENES.filter((s) => only.includes(s.id)) : SCENES;
  if (!scenes.length) {
    console.error(`No scenes match. Known: ${SCENES.map((s) => s.id).join(", ")}`);
    return 1;
  }

  // Every real run is costed first, from a mock pass over the same scenes.
  const estimate = await runDemo({ client: mockClient(), scenes, samples, dryRun: true, concurrency });
  const estimated = costOf(estimate.usage);

  let result = estimate;
  if (!dryRun) {
    if (!hasAnthropicKey()) {
      console.error("ANTHROPIC_API_KEY is not set. Run with --dry-run, or export a key with Sonnet 5.5 and Opus 5.5 access.");
      return 1;
    }
    if (estimated.total > maxUsd) {
      console.error(`Estimated cost $${estimated.total.toFixed(2)} is above --max-usd ${maxUsd}. Lower --samples or raise the cap.`);
      return 1;
    }
    console.log(`Running ${scenes.length} scenes x ${samples} samples; estimated $${estimated.total.toFixed(2)}.`);
    result = await runDemo({
      client: getAnthropic(),
      scenes,
      samples,
      dryRun: false,
      concurrency,
      onProgress: (line) => console.log(line),
    });
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "results.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(out, "index.html"), renderPage(result));
  const cost = costOf(result.usage);
  console.log(
    `${dryRun ? "Dry run" : "Run"} complete: ${result.usage.length} calls, ${dryRun ? "estimated real cost" : "cost"} $${cost.total.toFixed(2)} (${Object.entries(
      cost.byModel
    )
      .map(([m, c]) => `${m} $${c.toFixed(2)}`)
      .join(", ")}).`
  );
  console.log(`Page: ${join(out, "index.html")}`);
  return 0;
}
