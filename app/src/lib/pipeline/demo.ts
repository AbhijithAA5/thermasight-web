// ThermaSight — synthetic demo dataset, physics-informed and deterministic.
// Conforms to the YUKTHI 2026 data contract (same columns, units, 30-minute
// cadence, ~25,000 rows, missing values at spec-like rates, occasional gaps).
// Embeds realistic fault scenarios so the pipeline has something to find:
//   - CHILLER-01: 3.5-day condenser-side fault window + a transient spike
//   - CHILLER-02: progressive efficiency degradation over ~3 months
//   - CHILLER-03: frozen flow sensor window + a flow imbalance day
// Everything downstream treats this as ordinary input; the UI labels it as a
// synthetic demo so it is never confused with real plant data.

import { mulberry32, gauss } from "./models";

export const DEMO_FILE_NAME = "yukthi-demo-chillers.csv";

const START = Date.UTC(2019, 7, 18, 0, 0, 0); // 2019-08-18T00:00:00Z
const SLOTS_PER_DAY = 48;
const DAYS = 290;

const HEADS = [
  "timestamp",
  "equipment_id",
  "Chilled Water Rate",
  "Cooling Water Temperature",
  "Building Load",
  "Chiller Energy Consumption",
  "Outside Temperature",
  "Dew Point",
  "Humidity",
  "Wind Speed",
  "Pressure",
];

interface UnitCfg {
  id: string;
  dStart: number;
  dEnd: number;
  share: number;
  effJitter: number;
}

const UNITS: UnitCfg[] = [
  { id: "CHILLER-01", dStart: 0, dEnd: 128, share: 0.42, effJitter: 0.02 },
  { id: "CHILLER-02", dStart: 0, dEnd: 262, share: 0.36, effJitter: 0.015 },
  { id: "CHILLER-03", dStart: 0, dEnd: 208, share: 0.22, effJitter: 0.025 },
];

function envAt(rng: () => number, d: number, slot: number) {
  const hour = (slot / SLOTS_PER_DAY) * 24;
  const outsideF =
    52 + 26 * Math.cos((2 * Math.PI * d) / 365) + 7 * Math.sin((2 * Math.PI * (slot / SLOTS_PER_DAY - 0.42)) * 2 * Math.PI * 0.5) + gauss(rng) * 1.4;
  const dewF = outsideF - (14 + 6 * Math.sin((2 * Math.PI * d) / 365)) + gauss(rng) * 1.1;
  const tC = (outsideF - 32) / 1.8;
  const dC = (dewF - 32) / 1.8;
  const e1 = Math.exp((17.625 * dC) / (243.04 + dC));
  const e2 = Math.exp((17.625 * tC) / (243.04 + tC));
  const humidity = Math.max(22, Math.min(96, (100 * e1) / e2 + gauss(rng) * 3));
  const wind = Math.max(0.2, Math.min(11, 3.2 + 2.6 * gauss(rng) + 1.6 * Math.sin((2 * Math.PI * d) / 7)));
  const pressure = Math.max(29.2, Math.min(30.5, 29.9 + 0.13 * Math.sin((2 * Math.PI * d) / 9) + 0.05 * gauss(rng)));
  return { outsideF, dewF, humidity, wind, pressure };
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export function generateDemoCsv(): string {
  const rng = mulberry32(20260818);
  const lines: string[] = [HEADS.join(",")];
  const ts = (d: number, slot: number) => {
    const dt = new Date(START + d * 86400000 + slot * 1800000);
    const p = (v: number) => String(v).padStart(2, "0");
    return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:00`;
  };

  // Precomputed gap windows (each skips 4-18 consecutive rows).
  const gaps = new Set<string>();
  for (let g = 0; g < 8; g++) {
    const u = UNITS[Math.floor(rng() * UNITS.length)];
    const d = u.dStart + Math.floor(rng() * (u.dEnd - u.dStart - 2));
    const slot = Math.floor(rng() * SLOTS_PER_DAY);
    const len = 4 + Math.floor(rng() * 15);
    for (let k = 0; k < len; k++) gaps.add(`${u.id}:${d}:${slot + k}`);
  }

  // Target missing counts (spec-like shares of ~25k rows).
  const MISSING: [string, number][] = [
    ["Chilled Water Rate", 40],
    ["Cooling Water Temperature", 5],
    ["Building Load", 19],
    ["Chiller Energy Consumption", 9],
    ["Humidity", 20],
    ["Wind Speed", 23],
    ["Pressure", 12],
  ];
  const missingSet = new Set<string>();
  for (const [col, count] of MISSING) {
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < count * 50) {
      const u = UNITS[Math.floor(rng() * UNITS.length)];
      const d = u.dStart + Math.floor(rng() * (u.dEnd - u.dStart));
      const slot = Math.floor(rng() * SLOTS_PER_DAY);
      if (gaps.has(`${u.id}:${d}:${slot}`)) continue;
      missingSet.add(`${u.id}:${d}:${slot}:${col}`);
      placed++;
    }
  }

  const isMissing = (u: string, d: number, slot: number, col: string) =>
    gaps.has(`${u}:${d}:${slot}`) || missingSet.has(`${u}:${d}:${slot}:${col}`);

  const fmt = (v: number, dp = 2) => v.toFixed(dp);
  const blank = (u: string, d: number, slot: number, col: string) => (isMissing(u, d, slot, col) ? "" : "");

  // Anomaly slice definitions.
  const inWindow = (d: number, slot: number, d0: number, d1: number, s0 = 0, s1 = SLOTS_PER_DAY) => {
    const t = d + slot / SLOTS_PER_DAY;
    return t >= d0 && t < d1 && slot >= s0 && slot < s1;
  };
  // CHILLER-03 frozen flow sensor: freeze value captured at window start.
  let c3frozenVal: number | null = null;
  const c3StuckD0 = 85;
  const c3StuckD1 = 85.5;

  let rows = 0;
  for (const u of UNITS) {
    const c3frozenCol: number[] = [];
    for (let d = u.dStart; d < u.dEnd; d++) {
      const dow = new Date(START + d * 86400000).getUTCDay();
      const weekend = dow === 0 || dow === 6 ? 0.86 : 1;
      const seasonal = 0.58 + 0.42 * Math.cos((2 * Math.PI * d) / 365);
      // Slow daily efficiency drift (realistic; keeps slot-to-slot telemetry smooth).
      const dayEff = 1 + u.effJitter * gauss(rng);
      for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
        if (gaps.has(`${u.id}:${d}:${slot}`)) continue;
        const t = d + slot / SLOTS_PER_DAY;
        const env = envAt(rng, d, slot);
        const hour = (slot / SLOTS_PER_DAY) * 24;
        const diurnal = 0.78 + 0.22 * Math.sin((2 * Math.PI * (hour - 9)) / 24);
        const loadRT = Math.max(1, 260 * seasonal * diurnal * weekend * (1 + gauss(rng) * 0.025));
        const loadShare = u.share * loadRT;

        // Chilled water rate (l/s).
        let cwr = 0.0215 * loadShare + 0.12 + gauss(rng) * 0.06;

        // Cooling water temperature (C).
        let cwt = 26.3 + 0.011 * loadShare + 0.09 * (env.outsideF - 75) + gauss(rng) * 0.35;

        // Energy (kWh per 30 min).
        let eff = dayEff;

        // --- injected scenarios ---
        if (u.id === "CHILLER-01") {
          if (inWindow(d, slot, 88, 91.6)) {
            cwt += 4.5;
            eff *= 1.22;
            cwr *= 1.08;
          }
          if (inWindow(d, slot, 60, 60.5)) eff *= 1.85;
        }
        if (u.id === "CHILLER-02" && t >= 172) {
          eff *= 1 + 0.17 * smooth((t - 172) / 90);
        }
        if (u.id === "CHILLER-03") {
          if (inWindow(d, slot, 72, 73.5)) {
            cwr *= 0.6;
            eff *= 0.82; // reduced flow raises lift and efficiency penalty
            cwt += 1.8;
          }
          if (inWindow(d, slot, c3StuckD0, c3StuckD1)) {
            if (c3frozenVal === null) c3frozenVal = cwr;
            cwr = c3frozenVal;
            eff *= 0.86; // frozen flow signal shifts the control response
            cwt += 1.5;
          }
        }

        const outsideF = env.outsideF;
        const kw = Math.max(0.6, 3 + 0.62 * loadShare * eff + 0.05 * Math.max(0, outsideF - 75));
        const kwh = Math.max(0.25, kw * 0.5 + gauss(rng) * 0.15);

        const v = (col: string, val: number, dp: number): string => {
          if (isMissing(u.id, d, slot, col)) return "";
          return fmt(val, dp);
        };

        lines.push(
          [
            ts(d, slot),
            u.id,
            v("Chilled Water Rate", cwr, 2),
            v("Cooling Water Temperature", cwt, 2),
            v("Building Load", loadShare, 1),
            v("Chiller Energy Consumption", kwh, 2),
            v("Outside Temperature", outsideF, 1),
            v("Dew Point", env.dewF, 1),
            v("Humidity", env.humidity, 1),
            v("Wind Speed", env.wind, 2),
            v("Pressure", env.pressure, 2),
          ].join(","),
        );
        rows++;
        if (u.id === "CHILLER-03") c3frozenCol.push(cwr);
      }
    }
    void c3frozenCol;
  }

  // Sort rows chronologically (parser also sorts, but keep the file tidy).
  const body = lines.slice(1).sort((a, b) => {
    const ka = a.indexOf(",");
    const kb = b.indexOf(",");
    const ta = a.slice(0, ka);
    const tb = b.slice(0, kb);
    const c = ta < tb ? -1 : ta > tb ? 1 : 0;
    if (c !== 0) return c;
    const ea = a.slice(ka + 1, a.indexOf(",", ka + 1));
    const eb = b.slice(kb + 1, b.indexOf(",", kb + 1));
    return ea < eb ? -1 : ea > eb ? 1 : 0;
  });
  return [HEADS.join(","), ...body].join("\n");
}

export function demoRowCount(): string {
  const csv = generateDemoCsv();
  return csv.split("\n").length - 1 + "";
}