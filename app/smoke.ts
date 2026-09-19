// Smoke test: run the full pipeline on the synthetic demo dataset, verify the
// injected fault scenarios are detected, and report the episode list.
import { generateDemoCsv } from "./src/lib/pipeline/demo";
import { runPipeline, timeLabel } from "./src/lib/pipeline/engine";

const csv = generateDemoCsv();
console.log(`demo rows: ${csv.split("\n").length - 1}`);

const t0 = Date.now();
const result = await runPipeline(csv, "yukthi-demo-chillers.csv", (p) => {
  if (p.fraction >= 1) console.log(`  ${p.detail}`);
});
console.log(`pipeline runtime: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const q = result.quality;
console.log(`quality: ${q.rowCount} rows, ${q.equipmentCount} units, gaps=${q.gapCount}, dups=${q.duplicatePairs}`);
console.log(`missing: ${JSON.stringify(q.missingByColumn)}`);

const D0 = Date.UTC(2019, 7, 18);
const dOf = (ms: number) => (ms - D0) / 86400000;

const WINDOWS: { name: string; id: string; d0: number; d1: number }[] = [
  { name: "c1 transient spike (12h)", id: "CHILLER-01", d0: 60, d1: 60.6 },
  { name: "c1 condenser fault (3.5d)", id: "CHILLER-01", d0: 88, d1: 91.7 },
  { name: "c2 degradation ramp (from Feb)", id: "CHILLER-02", d0: 172, d1: 262 },
  { name: "c3 flow imbalance (24h)", id: "CHILLER-03", d0: 72, d1: 73.3 },
  { name: "c3 frozen sensor (8h)", id: "CHILLER-03", d0: 85, d1: 85.4 },
];

for (const w of WINDOWS) {
  const hits = result.episodes.filter(
    (e) => e.equipmentId === w.id && dOf(e.startTime) < w.d1 && dOf(e.endTime) > w.d0,
  );
  const sev = hits.map((h) => h.severity).join(",");
  const near = result.episodes.filter(
    (e) =>
      e.equipmentId === w.id &&
      ((dOf(e.startTime) >= w.d0 - 3 && dOf(e.startTime) <= w.d1 + 3) || (dOf(e.endTime) >= w.d0 - 3 && dOf(e.endTime) <= w.d1 + 3)),
  );
  console.log(
    `HIT ${w.name.padEnd(30)} ${hits.length ? `FOUND (${sev})` : "MISSED"}${near.length ? ` | nearby: ${near.map((h) => `${timeLabel(h.startTime).slice(0, 12)}:${h.severity}[${h.patternTags.join("|")}]`).join(" ")}` : ""}`,
  );
}

// Verify where the injected windows actually landed in the CSV.
{
  const { series } = await import("./src/lib/pipeline/parser").then((m) => m.buildDataset(csv, "verify"));
  for (const w of WINDOWS) {
    if (w.id !== "CHILLER-01" && w.id !== "CHILLER-03") continue;
    const s = series[w.id];
    const col = s.data["Chiller Energy Consumption"];
    const inW: number[] = [];
    const base: number[] = [];
    for (let i = 0; i < s.times.length; i++) {
      const dd = (s.times[i] - D0) / 86400000;
      if (dd >= w.d0 && dd < w.d1) inW.push(col[i]);
      else if (dd >= w.d0 - 3 && dd < w.d0 - 2) base.push(col[i]);
    }
    const mean = (a: number[]) => (a.length ? (a.reduce((x, y) => (Number.isFinite(y) ? x + y : x), 0) / a.length).toFixed(1) : "n/a");
    console.log(`INJECT ${w.name.padEnd(30)} window-energy=${mean(inW)} kWh/int (n=${inW.length}) baseline-1d-ago=${mean(base)} kWh/int`);
  }
}

console.log("\n--- per-unit episodes (top 8) ---");
for (const id of q.equipmentIds) {
  const rep = result.equipment[id];
  console.log(`\n== ${id}: health=${rep.health}, trend=${rep.degradationTrend}, episodes=${rep.episodes.length}, threshold=${rep.threshold.toFixed(3)}`);
  for (const ep of rep.episodes.slice(0, 8)) {
    console.log(
      `  ${ep.severity.padEnd(6)} ${timeLabel(ep.startTime)}  dur=${ep.durationHours}h peak=${ep.peakScore}  [${ep.patternTags.join(", ")}]`,
    );
  }
}

let bad = 0;
for (const id of q.equipmentIds) {
  const rep = result.equipment[id];
  for (const s of rep.score) if (!Number.isFinite(s)) bad++;
  for (const ep of rep.episodes) {
    if (!Number.isFinite(ep.peakScore) || !ep.narrative || !ep.recommendations.length || !ep.contributors.length) bad++;
  }
}
console.log(`\nintegrity failures: ${bad}`);
console.log(`episodes total: ${result.episodes.length}`);
const summary = result.episodes.reduce((acc, e) => {
  acc[e.severity] = (acc[e.severity] ?? 0) + 1;
  return acc;
}, {} as Record<string, number>);
console.log(`by severity: ${JSON.stringify(summary)}`);