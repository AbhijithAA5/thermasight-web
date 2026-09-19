// ThermaSight — interpretation layer. Converts raw scores into human-readable
// evidence: which measurements deviated from the recent baseline (contributing
// factors), what kind of operational pattern this matches, and a plain-language
// narrative with concrete numbers.

import {
  COLUMN_UNITS,
  NUMERIC_COLS,
  TARGET_COL,
  type Contributor,
  type NumericCol,
  type PatternTag,
  type Series,
} from "./types";
import { median } from "./features";

const TRAIL = 24; // trailing baseline window (12h at 30-min cadence)

/**
 * For a point index, compute each column's deviation from its recent baseline
 * (robust z vs trailing median/MAD). Returns top contributors with weights.
 */
export function analyzeContributors(
  s: Series,
  idx: number,
  globalStats: Record<NumericCol, { m: number; s: number }>,
): Contributor[] {
  const out: Contributor[] = [];
  const start = Math.max(0, idx - TRAIL);
  for (const c of NUMERIC_COLS) {
    const v = s.data[c][idx];
    if (!Number.isFinite(v)) continue;
    const window = s.data[c].slice(start, idx);
    const base = median(window);
    const devs = window.map((x) => Math.abs(x - base));
    const sdev = 1.4826 * median(devs);
    const scale = sdev > 1e-9 ? sdev : globalStats[c].s || 1;
    const z = (v - base) / scale;
    out.push({
      column: c,
      z: Math.round(z * 100) / 100,
      value: Math.round(v * 100) / 100,
      baselineMedian: Math.round(base * 100) / 100,
      unit: COLUMN_UNITS[c],
      direction: z > 0 ? "high" : "low",
      weight: 0,
    });
  }
  const maxAbs = Math.max(1e-9, ...out.map((o) => Math.abs(o.z)));
  for (const o of out) o.weight = Math.round((Math.abs(o.z) / maxAbs) * 100) / 100;
  out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return out.slice(0, 4);
}

export interface PatternContext {
  series: Series;
  idx: number;
  runLength: number; // flagged run length in steps
  residualZ: number;
  contributors: Contributor[];
  trend: number; // spearman trend of residual (-1..1)
  colZ: Record<NumericCol, number[]>;
  globalStats: Record<NumericCol, { m: number; s: number }>;
}

const zOf = (contributors: Contributor[], c: NumericCol): number | null => {
  const f = contributors.find((o) => o.column === c);
  return f ? f.z : null;
};

/** Classify what kind of operational pattern an anomaly looks like. */
export function detectPatterns(ctx: PatternContext): PatternTag[] {
  const tags = new Set<PatternTag>();
  const { series: s, idx, runLength, residualZ, contributors, trend, globalStats } = ctx;
  const en = zOf(contributors, TARGET_COL);
  const ld = zOf(contributors, "Building Load");
  const cwr = zOf(contributors, "Chilled Water Rate");
  const cwt = zOf(contributors, "Cooling Water Temperature");
  const hour = s.hours[idx];

  // Sensor stuck: any channel frozen over >= 12 trailing points while the
  // channel normally varies (global robust scale is meaningful).
  for (const c of NUMERIC_COLS) {
    const v = s.data[c][idx];
    if (!Number.isFinite(v)) continue;
    let run = 1;
    for (let k = idx - 1; k >= 0 && k >= idx - 48; k--) {
      if (Math.abs(s.data[c][k] - v) < 1e-9) run++;
      else break;
    }
    if (run >= 12 && globalStats[c].s > 1e-9) tags.add("sensor_stuck");
  }

  if (en !== null && ld !== null && en > 2.2 && Math.abs(ld) < 1.2) tags.add("high_consumption_low_load");
  if (cwt !== null && cwt > 1.8 && residualZ > 1.8 && runLength >= 8) tags.add("cooling_water_drift");
  if (cwr !== null && Math.abs(cwr) > 1.8 && (ld === null || Math.abs(ld) < 1.5)) tags.add("flow_imbalance");
  if (runLength <= 2 && en !== null && en > 3.5) tags.add("transient_spike");
  if ((hour >= 22 || hour < 6) && en !== null && en > 1.6 && (ld === null || ld < 0.4)) tags.add("offhours_standby");
  if (trend > 0.35 && idx > s.times.length * 0.4) tags.add("degradation_trend");
  if (
    residualZ > 2 &&
    ((ld !== null && Math.abs(ld) > 2) || (cwr !== null && Math.abs(cwr) > 2) || (cwt !== null && Math.abs(cwt) > 2))
  ) {
    tags.add("concurrent_context_shift");
  }
  if (en !== null && en > 2.2 && !tags.has("high_consumption_low_load")) tags.add("contextual_energy_spike");

  return [...tags];
}

const fmt2 = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(1));

/** Plain-language narrative built from evidence (no invented claims). */
export function buildNarrative(
  equipmentId: string,
  timeLabel: string,
  contributors: Contributor[],
  patterns: PatternTag[],
  residualZ: number,
): string {
  void residualZ;
  const en = contributors.find((c) => c.column === TARGET_COL);
  const parts: string[] = [];
  if (en) {
    const dir = en.z > 0 ? "above" : "below";
    const sigma = fmt2(Math.abs(en.z));
    parts.push(
      `At ${timeLabel}, ${equipmentId} consumed ${fmt2(en.value)} ${en.unit} per interval, ${dir} its 12-hour baseline of ${fmt2(en.baselineMedian)} ${en.unit} (${en.z > 0 ? "+" : "\u2212"}${sigma} \u03c3).`,
    );
  } else {
    parts.push(`At ${timeLabel}, ${equipmentId} deviated from its expected operating pattern.`);
  }
  const other = contributors.filter((c) => c.column !== TARGET_COL && Math.abs(c.z) >= 1.2).slice(0, 2);
  if (other.length) {
    const desc = other
      .map((c) => `${c.column} sits ${c.direction} at ${fmt2(Math.abs(c.z))} \u03c3 from its recent baseline`)
      .join(", ");
    parts.push(`Supporting evidence: ${desc}.`);
  }
  if (patterns.includes("degradation_trend")) {
    parts.push(
      "The residual trend across recent months is rising, consistent with gradual efficiency loss rather than a single event.",
    );
  }
  if (patterns.includes("transient_spike") && !patterns.includes("degradation_trend")) {
    parts.push(
      "The deviation is transient (2 or fewer intervals), so a passing operational event is more likely than a persistent fault.",
    );
  }
  if (patterns.includes("sensor_stuck")) {
    parts.push("One or more channels are frozen at a constant value for hours, which is a sensor or transmission signature.");
  }
  return parts.join(" ");
}