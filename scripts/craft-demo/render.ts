// Renders a demo run as one self-contained HTML page: a summary of the blind
// judgments and text metrics, then every scene's matched pairs side by side,
// with the craft check's findings highlighted in each final passage and the
// editor's changes shown as a word diff. Uses Ciciro's parchment and ember
// theme tokens (src/app/globals.css) so it reads like the product.

import { diffWords } from "diff";
import type { CraftFinding } from "@/lib/prose-tells";
import {
  averageMetrics,
  costOf,
  tally,
  type Arm,
  type ArmRun,
  type DemoResult,
  type Judgment,
  type PairRun,
  type Tally,
} from "./engine";

const ARM_LABEL: Record<Arm, string> = { A: "Current pipeline", B: "With craft defaults" };

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphs(html: string): string {
  return html
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** The passage with each finding's quote marked, in order, skipping overlaps. */
export function annotate(text: string, findings: CraftFinding[]): string {
  const spans = findings
    .map((f) => ({ f, start: text.indexOf(f.quote) }))
    .filter((s) => s.start >= 0 && s.f.quote)
    .sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const { f, start } of spans) {
    if (start < at) continue;
    const end = start + f.quote.length;
    out += escapeHtml(text.slice(at, start));
    out += `<mark title="${escapeHtml(`${f.habit}: ${f.note}`)}"><span class="tag">${escapeHtml(f.habit)}</span>${escapeHtml(text.slice(start, end))}</mark>`;
    at = end;
  }
  out += escapeHtml(text.slice(at));
  return paragraphs(out);
}

function wordDiff(from: string, to: string): string {
  const html = diffWords(from, to)
    .map((part) => {
      const t = escapeHtml(part.value);
      if (part.added) return `<ins>${t}</ins>`;
      if (part.removed) return `<del>${t}</del>`;
      return t;
    })
    .join("");
  return paragraphs(html);
}

const fmt = (n: number, digits = 1) => n.toFixed(digits);

function badges(run: ArmRun): string {
  const m = run.metrics;
  const items = [
    `${m.words} words`,
    `${fmt(m.meanSentence)} words/sentence (spread ${fmt(m.sentenceSpread)})`,
    `${fmt(m.dashesPer1k)} dashes per 1k`,
    `${m.contrasts} staged contrasts`,
    `${run.finalFindings.length} flagged`,
    ...(run.editCutOff ? ["edit cut off: draft kept"] : []),
  ];
  return `<ul class="badges">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
}

function armColumn(arm: Arm, run: ArmRun): string {
  if (run.error) {
    return `<section class="arm arm-${arm}"><h4>${ARM_LABEL[arm]}</h4><p class="error">Failed: ${escapeHtml(run.error)}</p></section>`;
  }
  const check = run.craftCheck
    ? `<details><summary>What the check told the editor</summary><pre>${escapeHtml(run.craftCheck)}</pre></details>`
    : "";
  return `<section class="arm arm-${arm}">
  <h4>${ARM_LABEL[arm]}</h4>
  ${badges(run)}
  <div class="prose">${annotate(run.final, run.finalFindings)}</div>
  <details><summary>What the editor changed in the draft</summary><div class="prose diff">${wordDiff(run.draft, run.final)}</div></details>
  ${check}
</section>`;
}

function verdictText(v: Judgment["quality"]): string {
  return v === "tie" ? "tie" : ARM_LABEL[v];
}

function judgmentRow(j: Judgment): string {
  const order = j.firstShown === "A" ? "current shown first" : "craft defaults shown first";
  if (j.error) return `<li><span class="order">${order}</span> <span class="error">judge failed: ${escapeHtml(j.error)}</span></li>`;
  return `<li><span class="order">${order}</span> quality: <b>${verdictText(j.quality)}</b> · voice: <b>${verdictText(j.voice)}</b> · brief: <b>${verdictText(j.brief)}</b><br><span class="reason">${escapeHtml(j.reason)}</span></li>`;
}

function pairBlock(pair: PairRun): string {
  const judged = pair.judgments.length
    ? `<ul class="judgments">${pair.judgments.map(judgmentRow).join("")}</ul>`
    : "";
  return `<div class="pair">
  <h3>Sample ${pair.sample}</h3>
  <div class="columns">${armColumn("A", pair.A)}${armColumn("B", pair.B)}</div>
  ${judged}
</div>`;
}

function tallyRow(name: string, t: Tally): string {
  const total = t.A + t.B + t.tie || 1;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return `<tr><th>${name}</th><td>${t.B} <small>${pct(t.B)}</small></td><td>${t.A} <small>${pct(t.A)}</small></td><td>${t.tie} <small>${pct(t.tie)}</small></td></tr>`;
}

function summary(result: DemoResult): string {
  const t = tally(result);
  const a = averageMetrics(result, "A");
  const b = averageMetrics(result, "B");
  const cost = costOf(result.usage);
  const metricRow = (name: string, x: number, y: number, digits = 1) =>
    `<tr><th>${name}</th><td>${fmt(x, digits)}</td><td>${fmt(y, digits)}</td></tr>`;
  const costLine = `${result.dryRun ? "Estimated cost of a real run" : "Cost of this run"}: <b>$${fmt(cost.total, 2)}</b> (${Object.entries(
    cost.byModel
  )
    .map(([m, c]) => `${escapeHtml(m)} $${fmt(c, 2)}`)
    .join(", ")}; ${result.usage.length} calls)${cost.unpriced.length ? `; no price for ${escapeHtml(cost.unpriced.join(", "))}` : ""}.`;
  return `<section class="summary">
  <div class="card">
    <h2>Blind judgments</h2>
    <p class="muted">Opus judged each matched pair twice, once in each order, without knowing which pipeline wrote which passage.</p>
    <table><thead><tr><th></th><th>Craft defaults won</th><th>Current won</th><th>Tie</th></tr></thead>
    <tbody>${tallyRow("Quality", t.quality)}${tallyRow("Author's voice", t.voice)}${tallyRow("Follows the brief", t.brief)}</tbody></table>
  </div>
  <div class="card">
    <h2>Text measures, averaged</h2>
    <p class="muted">Counted in code on the final passages. "Flagged" is the craft check run over both arms' finals.</p>
    <table><thead><tr><th></th><th>Current</th><th>Craft defaults</th></tr></thead><tbody>
    ${metricRow("Words", a.words, b.words, 0)}
    ${metricRow("Words per sentence", a.meanSentence, b.meanSentence)}
    ${metricRow("Sentence length spread", a.sentenceSpread, b.sentenceSpread)}
    ${metricRow("Dashes per 1k words", a.dashesPer1k, b.dashesPer1k)}
    ${metricRow("Staged contrasts", a.contrasts, b.contrasts)}
    ${metricRow("Flagged by the check", a.flagged, b.flagged)}
    </tbody></table>
  </div>
  <p class="cost">${costLine}</p>
</section>`;
}

function sceneBlock(s: DemoResult["scenes"][number]): string {
  const { scene } = s;
  return `<article class="scene" id="${escapeHtml(scene.id)}">
  <h2>${escapeHtml(scene.title)} <small>${escapeHtml(scene.kind)}</small></h2>
  <p class="tests">${escapeHtml(scene.tests)}</p>
  <details class="setup"><summary>Brief, style.md, and the author's prose it continues</summary>
    <h4>Brief</h4><p>${escapeHtml(scene.brief)}</p>
    <h4>style.md</h4><pre>${escapeHtml(scene.styleMd)}</pre>
    <h4>Continues from</h4><div class="prose">${paragraphs(escapeHtml(scene.continuity))}</div>
  </details>
  ${s.pairs.map(pairBlock).join("")}
</article>`;
}

const STYLE = `
:root { color-scheme: light; --bg:#f2ebe0; --panel:#faf6ef; --panel-2:#ebe3d4; --ink:#2a2218; --ink-soft:#6e6354; --line:#d9cfbd; --accent:#b4552d; --accent-soft:#ecd9cc; --draft:#2f6b4f; --draft-soft:#dcebe2; --del:#a83b3b; --del-soft:#f3dcdc; --mark:#f6e3a8; }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --bg:#1a1713; --panel:#221e19; --panel-2:#2c2620; --ink:#ece5d8; --ink-soft:#a99e8d; --line:#3a332b; --accent:#d9754a; --accent-soft:#3a2a20; --draft:#6fbf95; --draft-soft:#223229; --del:#e08080; --del-soft:#362121; --mark:#4a3d1c; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font-family:"Source Sans 3", ui-sans-serif, system-ui, sans-serif; line-height:1.5; }
main { max-width:1240px; margin:0 auto; padding:32px 16px 64px; }
h1 { font-family:Literata, Georgia, serif; font-weight:600; font-size:2rem; margin:0 0 4px; }
h2 { font-family:Literata, Georgia, serif; font-weight:600; font-size:1.35rem; margin:0 0 8px; }
h2 small { font-family:inherit; font-size:.75rem; font-weight:500; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.06em; margin-left:6px; }
h3 { font-size:.8rem; text-transform:uppercase; letter-spacing:.08em; color:var(--ink-soft); margin:24px 0 8px; }
h4 { margin:0 0 8px; font-size:.95rem; }
.lede { color:var(--ink-soft); margin:0 0 24px; max-width:70ch; }
.banner { background:var(--accent-soft); border:1px solid var(--accent); color:var(--ink); padding:12px 16px; border-radius:10px; margin:0 0 24px; }
.summary { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:16px; margin-bottom:40px; }
@media (max-width: 760px) { .summary { grid-template-columns:minmax(0, 1fr); } }
.card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 20px; min-width:0; }
.muted { color:var(--ink-soft); font-size:.9rem; margin:0 0 12px; }
.cost { grid-column:1 / -1; margin:0; color:var(--ink-soft); }
table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
td { white-space:nowrap; }
td small { color:var(--ink-soft); }
.scene { border-top:1px solid var(--line); padding-top:28px; margin-top:28px; }
.tests { color:var(--ink-soft); margin:0 0 12px; }
details { margin:10px 0; }
summary { cursor:pointer; color:var(--accent); font-weight:600; font-size:.9rem; }
.setup { background:var(--panel-2); border-radius:10px; padding:10px 14px; }
pre { white-space:pre-wrap; word-break:break-word; background:var(--panel-2); padding:10px 12px; border-radius:8px; font-size:.85rem; margin:8px 0; }
.columns { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:16px; }
@media (max-width: 760px) { .columns { grid-template-columns:minmax(0, 1fr); } }
.arm { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 18px; min-width:0; }
.arm-B { border-color:var(--draft); }
.arm-B h4 { color:var(--draft); }
.badges { list-style:none; padding:0; margin:0 0 12px; display:flex; flex-wrap:wrap; gap:6px; }
.badges li { background:var(--panel-2); border-radius:999px; padding:2px 10px; font-size:.78rem; color:var(--ink-soft); }
.prose { font-family:Literata, Georgia, serif; font-size:1.02rem; line-height:1.65; overflow-wrap:anywhere; }
.prose p { margin:0 0 .8em; }
mark { background:var(--mark); color:inherit; border-radius:3px; padding:0 2px; }
mark .tag { white-space:nowrap; font-family:"Source Sans 3", ui-sans-serif, system-ui, sans-serif; font-size:.68rem; text-transform:uppercase; letter-spacing:.05em; color:var(--accent); margin-right:4px; vertical-align:1px; }
ins { background:var(--draft-soft); color:var(--draft); text-decoration:none; }
del { background:var(--del-soft); color:var(--del); }
.judgments { list-style:none; padding:0; margin:12px 0 0; display:grid; gap:8px; }
.judgments li { background:var(--panel-2); border-radius:10px; padding:10px 14px; font-size:.92rem; }
.order { font-size:.75rem; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-soft); margin-right:6px; }
.reason { color:var(--ink-soft); }
.error { color:var(--del); }
nav.toc { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 24px; }
nav.toc a { color:var(--accent); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:4px 12px; text-decoration:none; font-size:.88rem; }
`;

export function renderPage(result: DemoResult): string {
  const banner = result.dryRun
    ? `<div class="banner"><b>Dry run.</b> Every passage, finding, and verdict below is canned mock output, used to check the harness end to end. It says nothing about which pipeline writes better. The cost is an estimate for a real run.</div>`
    : "";
  const notes = (result.notes || [])
    .map((n) => `<div class="banner"><b>Note on this run.</b> ${escapeHtml(n)}</div>`)
    .join("");
  const toc = result.scenes
    .map((s) => `<a href="#${escapeHtml(s.scene.id)}">${escapeHtml(s.scene.title)}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Craft defaults side by side</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,400;7..72,600&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
<style>${STYLE}</style></head>
<body><main>
<h1>Craft defaults, side by side</h1>
<p class="lede">The same scenes and briefs, drafted by Ciciro's current pipeline and by the pipeline with craft defaults (drafter rules, the post-draft check, and the editor's craft section). Each sample is one auto-draft beat: ${escapeHtml(result.models.drafter)} drafts, ${escapeHtml(result.models.editor)} edits to final. Highlights mark what the craft check finds in each final passage. ${result.samples} sample${result.samples === 1 ? "" : "s"} per scene; run ${escapeHtml(result.startedAt.slice(0, 16).replace("T", " "))} UTC.</p>
${banner}
${notes}
${summary(result)}
<nav class="toc">${toc}</nav>
${result.scenes.map(sceneBlock).join("")}
</main></body></html>`;
}
