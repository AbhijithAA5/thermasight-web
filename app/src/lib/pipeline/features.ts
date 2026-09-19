// ThermaSight — preprocessing + feature engineering.
// Missing values, time features, trailing rolling statistics, lags, robust
// standardization. Everything is computed per equipment unit, and the rolling
// windows are strictly trailing (no leakage from future observations).

import { clamp, NUMERIC_COLS, TARGET_COL, type NumericCol, type Series } from "./types";

export function median(vals: number[] | ArrayLike<number>): number {
  const n = vals.length;
  if (!n) return NaN;
  const a = Array.from(vals).sort((x, y) => x - y);
  const m = a[Math.floor(n / 2)];
  if (n % 2) return m;
  return (m + a[Math.floor(n / 2) - 1]) / 2;
}

export function mad(vals: number[] | ArrayLike<number>, center?: number): number {
  const c = center ?? median(vals);
  const dev = Array.from(vals).map((v) => Math.abs(v - c));
  return 1.4826 * median(dev);
}

export function robustStats(vals: number[]): { m: number; s: number } {
  const m = median(vals);
  const s = mad(vals, m);
  return { m, s };
}

/** Fill missing values: linear interpolation across short gaps (<= 4x the
 *  nominal interval), last-value carry-forward across long gaps. */
export function imputeSeries(s: Series, nominalMinutes: number): Series {
  const maxInterpMs = nominalMinutes * 60_000 * 4;
  const data = {} as Record<NumericCol, number[]>;
  for (const c of NUMERIC_COLS) {
    const v = s.data[c];
    const n = v.length;
    const out = v.slice();
    let i = 0;
    while (i < n) {
      if (Number.isFinite(out[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && !Number.isFinite(out[j])) j++;
      const prev = i > 0 ? out[i - 1] : undefined;
      const next = j < n ? out[j] : undefined;
      const prevT = i > 0 ? s.times[i - 1] : undefined;
      const nextT = j < n ? s.times[j] : undefined;
      if (
        prev !== undefined &&
        next !== undefined &&
        prevT !== undefined &&
        nextT !== undefined &&
        nextT - prevT <= maxInterpMs
      ) {
        for (let k = i; k < j; k++) {
          const f = (s.times[k] - prevT) / (nextT - prevT);
          out[k] = prev + (next - prev) * f;
        }
      } else {
        const fill = prev !== undefined ? prev : next !== undefined ? next : NaN;
        for (let k = i; k < j; k++) out[k] = fill;
      }
      i = j;
    }
    data[c] = out;
  }
  return { ...s, data };
}

export interface FeatureStats {
  perCol: Record<NumericCol, { m: number; s: number }>;
}

export interface FeatureSet {
  /** standardized rows for the Isolation Forest */
  ifX: number[][];
  /** standardized context/dynamics rows for the residual model */
  mlpX: number[][];
  /** robust-z target (energy) for the residual model */
  y: number[];
  /** residual of the target in robust-z units is computed downstream */
  names: { if: string[]; mlp: string[] };
  stats: FeatureStats;
  /** robust-z of each numeric column (for interpretation) */
  colZ: Record<NumericCol, number[]>;
  /** columns actually used (columns absent/all-missing are excluded) */
  usableCols: NumericCol[];
}

const W = 48; // trailing window = 24h at 30-min cadence

function trailingMean(a: number[], i: number, w: number): number {
  let sum = 0;
  for (let k = i - w; k < i; k++) sum += a[k];
  return sum / w;
}

const slug = (c: string) => c.replace(/\s+/g, "_").toLowerCase();

export function buildFeatures(s: Series): FeatureSet {
  const n = s.times.length;
  const stats: FeatureStats = { perCol: {} as FeatureStats["perCol"] };
  for (const c of NUMERIC_COLS) {
    const { m, s: sd } = robustStats(s.data[c]);
    stats.perCol[c] = { m, s: sd || 1e-9 };
  }
  // Columns that arrive entirely missing (absent from the file, or all-blank)
  // must not poison the model inputs — drop them from the vectors.
  const usable = NUMERIC_COLS.filter(
    (c) => Number.isFinite(stats.perCol[c].m) && stats.perCol[c].s > 1e-9,
  );
  const z = (c: NumericCol, i: number) =>
    clamp((s.data[c][i] - stats.perCol[c].m) / stats.perCol[c].s, -6, 6);
  const energyOk = usable.includes(TARGET_COL);
  const loadOk = usable.includes("Building Load");
  const ctx = usable.filter((c) => c !== TARGET_COL);

  // Trailing rolling means/stds for energy + load (strictly trailing).
  const enRollMean = new Array<number>(n).fill(0);
  const enRollStd = new Array<number>(n).fill(0);
  const ldRollMean = new Array<number>(n).fill(0);
  let enSum = 0;
  let enSum2 = 0;
  let ldSum = 0;
  const finite = (v: number) => (Number.isFinite(v) ? v : 0);
  for (let i = 0; i < n; i++) {
    if (energyOk) {
      const ei = finite(s.data[TARGET_COL][i]);
      enSum += ei;
      enSum2 += ei * ei;
    }
    if (loadOk) ldSum += finite(s.data["Building Load"][i]);
    if (i >= W) {
      if (energyOk) {
        const ej = finite(s.data[TARGET_COL][i - W]);
        enSum -= ej;
        enSum2 -= ej * ej;
      }
      if (loadOk) ldSum -= finite(s.data["Building Load"][i - W]);
    }
    if (i >= W - 1) {
      if (energyOk) {
        const mn = enSum / W;
        enRollMean[i] = mn;
        enRollStd[i] = Math.sqrt(Math.max(0, enSum2 / W - mn * mn));
      }
      if (loadOk) ldRollMean[i] = ldSum / W;
    } else {
      if (energyOk) {
        enRollMean[i] = finite(s.data[TARGET_COL][i]);
        enRollStd[i] = 0;
      }
      if (loadOk) ldRollMean[i] = finite(s.data["Building Load"][i]);
    }
  }

  const hour = s.hours;
  const day = s.days;
  const ifX: number[][] = [];
  const mlpX: number[][] = [];
  const y: number[] = [];
  const colZ: Record<NumericCol, number[]> = {} as Record<NumericCol, number[]>;
  for (const c of usable) colZ[c] = [];

  const ifNames = [...usable.map(slug), "hour_sin", "hour_cos", "dow_sin", "dow_cos"];
  if (energyOk) ifNames.push("en_roll_mean", "en_roll_std", "en_lag1", "en_lag48");
  if (loadOk) ifNames.push("ld_roll_mean");
  const mlpNames = [
    ...ctx.map(slug),
    "hour_sin", "hour_cos", "dow_sin", "dow_cos", "doy_sin", "doy_cos",
  ];
  if (energyOk) mlpNames.push("en_lag1", "en_lag48");

  for (let i = 0; i < n; i++) {
    const hSin = Math.sin((hour[i] / 24) * 2 * Math.PI);
    const hCos = Math.cos((hour[i] / 24) * 2 * Math.PI);
    const dSin = Math.sin((day[i] / 7) * 2 * Math.PI);
    const dCos = Math.cos((day[i] / 7) * 2 * Math.PI);
    const doyFrac = (s.times[i] % 31557600000) / 31557600000;
    const doySin = Math.sin(doyFrac * 2 * Math.PI);
    const doyCos = Math.cos(doyFrac * 2 * Math.PI);
    const lag1 = energyOk && i > 0 ? z(TARGET_COL, i - 1) : 0;
    const lag48 = energyOk && i >= 48 ? z(TARGET_COL, i - 48) : 0;

    const rowIf = usable.map((c) => z(c, i)).concat([hSin, hCos, dSin, dCos]);
    if (energyOk) {
      const enRm = (enRollMean[i] - stats.perCol[TARGET_COL].m) / stats.perCol[TARGET_COL].s;
      const enRs = enRollStd[i] / (stats.perCol[TARGET_COL].s || 1);
      rowIf.push(clamp(enRm, -6, 6), clamp(enRs, -6, 6), lag1, lag48);
    }
    if (loadOk) {
      const ldRm = (ldRollMean[i] - stats.perCol["Building Load"].m) / stats.perCol["Building Load"].s;
      rowIf.push(clamp(ldRm, -6, 6));
    }
    ifX.push(rowIf);

    const rowMlp = ctx.map((c) => z(c, i)).concat([hSin, hCos, dSin, dCos, doySin, doyCos]);
    if (energyOk) rowMlp.push(lag1, lag48);
    mlpX.push(rowMlp);
    y.push(energyOk ? z(TARGET_COL, i) : 0);

    for (const c of usable) colZ[c].push(z(c, i));
  }

  return {
    ifX,
    mlpX,
    y,
    names: { if: ifNames, mlp: mlpNames },
    stats,
    colZ,
    usableCols: usable,
  };
}

export const WARMUP = 96; // points excluded from scoring (rolling windows not yet meaningful)