// ThermaSight — fusion scoring, episode extraction, health assessment.
// Combines the isolation score and the contextual residual score, applies
// persistence logic (sustained deviations matter more than isolated ones),
// then turns scores into episodes and a per-unit health number.

import { clamp, type Episode, type EquipmentReport, type NumericCol, type Series, type Severity } from "./types";
import { quantileSorted, spearman } from "./models";
import { WARMUP } from "./features";

export interface ScoreOpts {
  ifWeight: number;
  residualWeight: number;
  thresholdQuantile: number;
  joinWindow: number; // max steps between flagged points still in one run
}

export const DEFAULT_SCORE_OPTS: ScoreOpts = {
  ifWeight: 0.25,
  residualWeight: 0.75,
  thresholdQuantile: 0.975,
  joinWindow: 12,
};

export interface Scored {
  score: number[];
  flagged: boolean[];
  severity: Severity[];
  threshold: number;
  runs: { s: number; e: number }[];
}

const MIN_THRESHOLD = 0.35; // candidates are defined relative to the unit's own score tail
const ALERT_FLOOR = 0.7;
const ACTION_FLOOR = 0.8;

/** Linear-interpolated quantile over a sorted array (numpy-style). */
function qLin(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

export function scoreSeries(ifScore: number[], residualZ: number[], opts: ScoreOpts = DEFAULT_SCORE_OPTS): Scored {
  const n = ifScore.length;
  const resAnom = residualZ.map((z) => 1 - Math.exp(-0.5 * Math.pow(z / 1.8, 2)));
  const raw = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    raw[i] = clamp(opts.ifWeight * Math.min(ifScore[i], 0.55) + opts.residualWeight * resAnom[i], 0, 1);
  }
  const active = raw.filter((v, i) => i >= WARMUP && v > 1e-9);
  // Candidates are the unit's own 97.5th-percentile tail. No absolute floor:
  // a fixed floor degenerates to "everything flagged" on differently scaled
  // datasets.
  const threshold =
    active.length > 0 ? Math.max(MIN_THRESHOLD, quantileSorted(active, opts.thresholdQuantile)) : 0.6;
  const cand = raw.map((v, i) => i >= WARMUP && v > threshold);

  // Runs, allowing joins of up to joinWindow steps. A single extreme point is
  // still kept when it sits in the unit's top 1%.
  const rescue = active.length > 0 ? qLin(active, 0.99) : 0.9;
  const runs: { s: number; e: number }[] = [];
  let runStart = -1;
  let lastTrue = -1;
  for (let i = 0; i <= n; i++) {
    const isTrue = i < n && cand[i];
    if (isTrue) {
      if (runStart < 0) runStart = i;
      lastTrue = i;
    } else if (runStart >= 0 && (i - lastTrue > opts.joinWindow || i === n)) {
      const len = lastTrue - runStart + 1;
      if (len >= 2 || raw[runStart] > rescue) runs.push({ s: runStart, e: lastTrue });
      runStart = -1;
    }
  }

  const inRun = new Uint8Array(n);
  const runLen = new Int32Array(n);
  for (const r of runs) {
    for (let i = r.s; i <= r.e; i++) {
      inRun[i] = 1;
      runLen[i] = r.e - r.s + 1;
    }
  }

  const score = new Array<number>(n);
  // Keep the run boost modest so peak scores do not saturate at the top.
  for (let i = 0; i < n; i++) {
    score[i] = inRun[i] ? clamp(raw[i] + 0.03 * Math.min(1, runLen[i] / 10), 0, 1) : raw[i];
  }

  // Severity is relative to the unit's own flagged periods, with absolute
  // floors as guards: the worst ~10% of episodes are "action", the next ~30%
  // "alert", the rest of the tail "watch".
  let alertFloor = ALERT_FLOOR;
  let actionFloor = ACTION_FLOOR;
  if (runs.length > 0) {
    const peaks = runs.map((r) => Math.max(...score.slice(r.s, r.e + 1))).sort((a, b) => a - b);
    alertFloor = Math.max(ALERT_FLOOR, qLin(peaks, 0.6));
    actionFloor = Math.max(ACTION_FLOOR, qLin(peaks, 0.9));
  }

  const runSev = new Map<number, Severity>();
  for (const r of runs) {
    let pk = r.s;
    for (let i = r.s + 1; i <= r.e; i++) if (score[i] > score[pk]) pk = i;
    const pv = score[pk];
    const sev: Severity = pv >= actionFloor ? "action" : pv >= alertFloor ? "alert" : "watch";
    for (let i = r.s; i <= r.e; i++) runSev.set(i, sev);
  }

  const flagged = new Array<boolean>(n).fill(false);
  const severity = new Array<Severity>(n).fill("normal");
  for (let i = 0; i < n; i++) {
    const sev = runSev.get(i);
    if (sev) {
      flagged[i] = true;
      severity[i] = sev;
    }
  }
  for (let i = 0; i < WARMUP; i++) {
    score[i] = 0;
    flagged[i] = false;
    severity[i] = "normal";
  }

  return { score, flagged, severity, threshold, runs };
}

export function degradationTrend(residualZ: number[], n: number): number {
  const win = Math.min(n, 90 * 48);
  if (win < 240) return 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = n - win; i < n; i += 4) {
    xs.push(i);
    ys.push(residualZ[i]);
  }
  return spearman(xs, ys);
}

export function computeHealth(times: number[], score: number[], trend: number): number {
  const n = times.length;
  if (n < WARMUP) return 100;
  const cutoff = times[n - 1] - 30 * 86400000;
  let cnt = 0;
  let bad = 0;
  for (let i = n - 1; i >= 0 && times[i] >= cutoff; i--) {
    cnt++;
    if (score[i] >= 0.7) bad++;
  }
  const exposure = cnt ? bad / cnt : 0;
  const penalty = exposure * 55 + Math.max(0, trend) * 30;
  return clamp(Math.round(100 - penalty), 5, 100);
}

export interface EpisodeInput {
  equipmentId: string;
  run: { s: number; e: number };
  series: Series;
  score: number[];
  severity: Severity[];
  residualZ: number[];
  trend: number;
}

/** Build a partial episode shell (timing + peak). Interpretation fills the rest. */
export function episodeShell(input: EpisodeInput): Pick<Episode, "id" | "equipmentId" | "startIndex" | "endIndex" | "startTime" | "endTime" | "durationHours" | "peakIndex" | "peakScore" | "severity"> {
  const { s, e } = input.run;
  let peak = s;
  for (let i = s + 1; i <= e; i++) if (input.score[i] > input.score[peak]) peak = i;
  const sev = input.severity[peak] === "normal" ? "watch" : (input.severity[peak] as Exclude<Severity, "normal">);
  const startTime = input.series.times[s];
  const endTime = input.series.times[e];
  return {
    id: `${input.equipmentId}-${startTime}`,
    equipmentId: input.equipmentId,
    startIndex: s,
    endIndex: e,
    startTime,
    endTime,
    durationHours: Math.round(((endTime - startTime) / 3.6e6) * 10) / 10,
    peakIndex: peak,
    peakScore: Math.round(input.score[peak] * 1000) / 1000,
    severity: sev,
  };
}

export function equipmentStats(s: Series): { energyTotalKwh: number; energyMeanKwh: number } {
  const en = s.data["Chiller Energy Consumption"];
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < en.length; i++) {
    if (Number.isFinite(en[i])) {
      sum += en[i];
      cnt++;
    }
  }
  return { energyTotalKwh: Math.round(sum), energyMeanKwh: cnt ? Math.round((sum / cnt) * 10) / 10 : 0 };
}

export function fleetStats(equipment: Record<string, EquipmentReport>, series: Record<string, Series>) {
  let energy = 0;
  for (const eq of Object.keys(series)) energy += equipmentStats(series[eq]).energyTotalKwh;
  const bySeverity = { watch: 0, alert: 0, action: 0 };
  const atRisk: string[] = [];
  for (const eq of Object.keys(equipment)) {
    const rep = equipment[eq];
    for (const ep of rep.episodes) bySeverity[ep.severity]++;
    if (rep.health != null && rep.health < 60) atRisk.push(eq);
  }
  return { energyTotalKwh: energy, bySeverity, atRisk };
}

/** For numeric display in the UI. */
export const SEVERITY_RANK: Record<Severity, number> = { normal: 0, watch: 1, alert: 2, action: 3 };
export { WARMUP };

export type NumericColRef = NumericCol;