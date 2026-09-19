// ThermaSight — pipeline orchestrator. Data → quality → imputation → features
// → models (Isolation Forest + contextual residual MLP) → fusion scoring →
// episodes → interpretation → insights. Pure client-side, chunked so the UI
// stays responsive, deterministic seeds for reproducibility.

import {
  CONTEXT_COLS,
  TARGET_COL,
  type Episode,
  type EquipmentReport,
  type ModelMetadata,
  type NumericCol,
  type PipelineResult,
  type Series,
  type Severity,
} from "./types";
import { buildDataset, DatasetError } from "./parser";
import { buildFeatures, imputeSeries, median, WARMUP } from "./features";
import { IsolationForest, MLPRegressor } from "./models";
import {
  computeHealth,
  DEFAULT_SCORE_OPTS,
  degradationTrend,
  episodeShell,
  equipmentStats,
  SEVERITY_RANK,
  scoreSeries,
  type ScoreOpts,
} from "./scoring";
import { analyzeContributors, buildNarrative, detectPatterns } from "./interpretation";
import { recommendationsForPatterns } from "./recommendations";

export interface Progress {
  stage: string;
  fraction: number; // 0..1
  detail?: string;
}

export type ProgressFn = (p: Progress) => void;

const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0));

export function timeLabel(ms: number): string {
  const d = new Date(ms);
  const pad = (v: number) => String(v).padStart(2, "0");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function medianInterval(times: number[]): number {
  if (times.length < 2) return 1800000;
  const ints: number[] = [];
  for (let i = 1; i < times.length; i++) ints.push(times[i] - times[i - 1]);
  ints.sort((a, b) => a - b);
  return ints[Math.floor(ints.length / 2)];
}

const MIN_DATA = WARMUP + 24; // trailing baseline window (96) + a minimum train set

function insufficientReport(s: Series, reason: string): EquipmentReport {
  const n = s.times.length;
  const stats = equipmentStats(s);
  return {
    equipmentId: s.equipmentId,
    score: new Array<number>(n).fill(0),
    severity: new Array<Severity>(n).fill("normal"),
    flagged: new Array<boolean>(n).fill(false),
    threshold: 0,
    health: null,
    degradationTrend: 0,
    episodes: [],
    energyTotalKwh: stats.energyTotalKwh,
    energyMeanKwh: stats.energyMeanKwh,
    count: n,
    insufficientData: true,
    insufficientReason: reason,
    maintenance: null,
    daily: { days: [], energy: [], seasonal: [], residZ: [] },
    modelFeatures: { if: 0, mlp: 0 },
  };
}

async function runEquipment(
  s: Series,
  nominalMinutes: number,
  opts: ScoreOpts,
  onProgress: ProgressFn,
  base: number,
  span: number,
): Promise<EquipmentReport> {
  await yieldToMain();
  const n = s.times.length;
  if (n < MIN_DATA) {
    return insufficientReport(
      s,
      `only ${n} observations (minimum ${MIN_DATA} needed for the trailing baseline and model training)`,
    );
  }
  const imputed = imputeSeries(s, nominalMinutes);
  onProgress({ stage: "Feature engineering", fraction: base + span * 0.3, detail: s.equipmentId });

  const feats = buildFeatures(imputed);
  if (!feats.usableCols.includes(TARGET_COL)) {
    return insufficientReport(s, "no usable 'Chiller Energy Consumption' values in the file");
  }
  const trainFrom = Math.min(WARMUP, n);

  const ifForest = new IsolationForest();
  const ifX = feats.ifX.slice(trainFrom);
  ifForest.fit(ifX, 80, 256, 7 + s.equipmentId.length);
  const ifScore = ifForest.score(feats.ifX);

  onProgress({ stage: "Training residual model", fraction: base + span * 0.55, detail: s.equipmentId });
  const mlp = new MLPRegressor();
  const mlpX = feats.mlpX.slice(trainFrom);
  const y = feats.y.slice(trainFrom);
  const loss = mlp.fit(mlpX, y, { epochs: 130, seed: 11 + s.equipmentId.length });
  const pred = mlp.predict(feats.mlpX);

  // Residual in robust units: actual energy-z minus expected energy-z.
  // Two bias corrections before scaling, both standard practice:
  //  1. hour-of-day median (a consistent diurnal pattern is normal behaviour)
  //  2. expected-value bins (systematic model bias at extreme loads/contexts)
  const resid = feats.y.map((yi, i) => yi - pred[i]);
  const hourSamples: number[][] = Array.from({ length: 24 }, () => []);
  for (let i = trainFrom; i < n; i++) hourSamples[Math.min(23, Math.floor(s.hours[i]))].push(resid[i]);
  const hourMed = hourSamples.map((vals) => (vals.length ? median(vals) : 0));
  const residHourAdj = resid.map((r, i) => (i >= trainFrom ? r - hourMed[Math.min(23, Math.floor(s.hours[i]))] : r));
  const BINS = 8;
  const predLo = Math.min(...pred.slice(trainFrom));
  const predHi = Math.max(...pred.slice(trainFrom));
  const binOf = (v: number) => Math.min(BINS - 1, Math.max(0, Math.floor(((v - predLo) / (predHi - predLo || 1)) * BINS)));
  const binSamples: number[][] = Array.from({ length: BINS }, () => []);
  for (let i = trainFrom; i < n; i++) binSamples[binOf(pred[i])].push(residHourAdj[i]);
  const binMed = binSamples.map((vals) => (vals.length ? median(vals) : 0));
  const residAdj = residHourAdj.map((r, i) => (i >= trainFrom ? r - binMed[binOf(pred[i])] : r));
  const absDevs = residAdj.slice(trainFrom).map((r) => Math.abs(r)).sort((a, b) => a - b);
  const residScale = 1.4826 * (absDevs.length ? absDevs[Math.floor(absDevs.length / 2)] : 1);
  const residualZ = residAdj.map((r) => r / (residScale || 1));
  void loss;
  void CONTEXT_COLS;

  onProgress({ stage: "Scoring and detection", fraction: base + span * 0.72, detail: s.equipmentId });
  const scored = scoreSeries(ifScore, residualZ, opts);
  for (let i = 0; i < WARMUP && i < n; i++) {
    scored.score[i] = 0;
    scored.flagged[i] = false;
    scored.severity[i] = "normal";
  }

  const trend = degradationTrend(residualZ, n);
  const health = computeHealth(s.times, scored.score, trend);
  const stats = equipmentStats(s);

  // ---- seasonal degradation + predictive maintenance summary ----
  const dayIndex = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const d = Math.floor(s.times[i] / 86400000);
    const arr = dayIndex.get(d) ?? [];
    arr.push(i);
    dayIndex.set(d, arr);
  }
  const dayMs = [...dayIndex.keys()].sort((a, b) => a - b);
  const dEnergy: number[] = [];
  const dResid: number[] = [];
  const rawEn = imputed.data[TARGET_COL];
  for (const d of dayMs) {
    const idx = dayIndex.get(d)!;
    let es = 0;
    for (const i of idx) es += rawEn[i] ?? 0;
    dEnergy.push(es / idx.length);
    let rs = 0;
    for (const i of idx) rs += residualZ[i];
    dResid.push(rs / idx.length);
  }
  const nD = dayMs.length;
  const dSeason: number[] = [];
  for (let k = 0; k < nD; k++) {
    const lo = Math.max(0, k - 22);
    const hi = Math.min(nD, k + 23);
    dSeason.push(median(dEnergy.slice(lo, hi)));
  }
  const recent = Math.max(0, nD - 90);
  const xs: number[] = [];
  for (let k = recent; k < nD; k++) xs.push(k);
  const ys = dResid.slice(recent);
  let slope = 0;
  if (xs.length >= 14) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let denom = 0;
    for (const x of xs) denom += (x - mx) ** 2;
    let num = 0;
    for (let k = 0; k < xs.length; k++) num += (xs[k] - mx) * (ys[k] - my);
    slope = denom ? num / denom : 0;
  }
  const drift = ys.length
    ? ys.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, ys.length)
    : 0;
  const horizonDays = slope > 0 ? Math.max(7, Math.min(365, Math.floor(1.5 / slope))) : 365;
  let maintStatus: "ok" | "plan" | "recommended" | "due" = "ok";
  if (health < 70 || drift > 1.2 || slope > 0.015) maintStatus = "due";
  else if (drift > 0.7 || slope > 0.008) maintStatus = "recommended";
  else if (slope > 0.003 || drift > 0.3) maintStatus = "plan";
  const maintenance = {
    status: maintStatus,
    horizonDays,
    slopePerDay: Math.round(slope * 1000) / 1000,
    recentDrift: Math.round(drift * 100) / 100,
  };
  const daily = {
    days: dayMs,
    energy: dEnergy.map((x) => Math.round(x * 10) / 10),
    seasonal: dSeason.map((x) => Math.round(x * 10) / 10),
    residZ: dResid.map((x) => Math.round(x * 1000) / 1000),
  };

  // Episodes with interpretation.
  const episodes: Episode[] = [];
  for (const run of scored.runs) {
    const shell = episodeShell({ equipmentId: s.equipmentId, run, series: s, score: scored.score, severity: scored.severity, residualZ, trend });
    const peak = shell.peakIndex;
    const runLength = run.e - run.s + 1;
    const contributors = analyzeContributors(s, peak, feats.stats.perCol);
    const patterns = detectPatterns({
      series: s,
      idx: peak,
      runLength,
      residualZ: residualZ[peak] ?? 0,
      contributors,
      trend,
      colZ: feats.colZ,
      globalStats: feats.stats.perCol,
    });
    const narrative = buildNarrative(s.equipmentId, timeLabel(s.times[peak]), contributors, patterns, residualZ[peak] ?? 0);
    const evidence = contributors.slice(0, 3).map((c) => ({
      column: c.column,
      observed: c.value,
      expected: c.baselineMedian,
      unit: c.unit,
      z: c.z,
    }));
    episodes.push({
      ...shell,
      patternTags: patterns.length ? patterns : ["unclassified"],
      narrative,
      contributors,
      evidence,
      recommendations: recommendationsForPatterns(patterns, shell.severity),
    });
  }

  return {
    equipmentId: s.equipmentId,
    score: scored.score,
    severity: scored.severity,
    flagged: scored.flagged,
    threshold: scored.threshold,
    health,
    degradationTrend: Math.round(trend * 1000) / 1000,
    episodes,
    energyTotalKwh: stats.energyTotalKwh,
    energyMeanKwh: stats.energyMeanKwh,
    count: n,
    insufficientData: false,
    maintenance,
    daily,
    modelFeatures: { if: feats.names.if.length, mlp: feats.names.mlp.length },
  };
}

export async function runPipeline(
  csvText: string,
  fileName: string,
  onProgress: ProgressFn,
  opts: ScoreOpts = DEFAULT_SCORE_OPTS,
): Promise<PipelineResult> {
  const t0 = Date.now();
  onProgress({ stage: "Ingesting data", fraction: 0.03, detail: fileName });

  const { quality, series: rawSeries } = buildDataset(csvText, fileName);
  onProgress({ stage: "Ingesting data", fraction: 0.08, detail: `${quality.rowCount.toLocaleString()} observations, ${quality.equipmentCount} units` });
  await yieldToMain();

  const equipmentIds = Object.keys(rawSeries).sort();
  const nominalMs = medianInterval(rawSeries[equipmentIds[0]].times);
  const nominalMinutes = Math.max(1, Math.round(nominalMs / 60000));

  const equipment: Record<string, EquipmentReport> = {};
  const analyzedIds: string[] = [];
  const per = 0.85 / equipmentIds.length;
  for (let k = 0; k < equipmentIds.length; k++) {
    const id = equipmentIds[k];
    const report = await runEquipment(rawSeries[id], nominalMinutes, opts, onProgress, 0.12 + k * per, per);
    equipment[id] = report;
    if (!report.insufficientData) analyzedIds.push(id);
    onProgress({ stage: "Analysing", fraction: 0.12 + (k + 1) * per, detail: id });
  }

  if (!analyzedIds.length) {
    const reasons = equipmentIds
      .map((id) => `${id} -> ${equipment[id].insufficientReason ?? "unknown"}`)
      .join("; ");
    throw new DatasetError(
      `No equipment unit could be analysed: ${reasons}. Upload a CSV with at least ${MIN_DATA} ` +
        "observations per unit (including a usable 'Chiller Energy Consumption' column).",
    );
  }

  // Fleet episode list, severity first, then score.
  const episodes: Episode[] = [];
  for (const id of analyzedIds) episodes.push(...equipment[id].episodes);
  episodes.sort((a, b) => {
    const d = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (d !== 0) return d;
    return b.peakScore - a.peakScore;
  });

  const ifFeatures = Math.max(...analyzedIds.map((id) => equipment[id].modelFeatures?.if ?? 18));
  const mlpFeatures = Math.max(...analyzedIds.map((id) => equipment[id].modelFeatures?.mlp ?? 16));
  const model: ModelMetadata = {
    isolationForest: { trees: 80, maxSamples: 256, features: ifFeatures },
    residualModel: {
      hiddenUnits: 24,
      epochs: 150,
      trainLoss: NaN,
      valLoss: NaN,
      features: mlpFeatures,
    },
    fusion: {
      ifWeight: opts.ifWeight,
      residualWeight: opts.residualWeight,
      thresholdQuantile: opts.thresholdQuantile,
      joinWindow: opts.joinWindow,
    },
    runtimeMs: Date.now() - t0,
  };

  onProgress({ stage: "Done", fraction: 1, detail: `${episodes.length} anomalies detected` });
  return {
    quality,
    series: rawSeries,
    equipment,
    episodes,
    model,
    nominalIntervalMinutes: nominalMinutes,
    generatedAt: Date.now(),
  };
}

export type { DatasetError };
export type { NumericCol, Severity };