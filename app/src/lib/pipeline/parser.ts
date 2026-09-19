// ThermaSight — ingestion. Parses any CSV conforming to the YUKTHI 2026 data
// contract: identifies columns by name (case/whitespace tolerant), keeps
// (equipment_id, timestamp) record identity, never hard-codes row counts or
// timestamps.

import {
  EQUIPMENT_COL,
  NUMERIC_COLS,
  TARGET_COL,
  TIMESTAMP_COL,
  type ColName,
  type DataQuality,
  type NumericCol,
  type Series,
} from "./types";

export class DatasetError extends Error {}

interface RawGroup {
  times: number[];
  hours: number[];
  days: number[];
  values: Record<NumericCol, number[]>;
  observed: Record<NumericCol, number[]>;
}

interface ParsedTs {
  ms: number;
  hour: number;
  dow: number;
}

/** Minimal RFC-4180-ish splitter: quoted fields, escaped quotes, CRLF/LF. */
export function splitCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  const firstRow: string[] = [];
  let rowsDone = false;
  let row = firstRow;
  let cur = "";
  let inQ = false;
  const pushCell = () => {
    row.push(cur);
    cur = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      pushCell();
    } else if (ch === "\n") {
      pushCell();
      rows.push(row);
      row = [];
      rowsDone = true;
    } else if (ch === "\r") {
      // skip CR; LF ends the line
    } else {
      cur += ch;
    }
  }
  if (cur.length || row.length) {
    pushCell();
    rows.push(row);
  }
  // Drop trailing blank lines.
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  let headers: string[] = [];
  let body = rows;
  if (rows.length) {
    headers = rows[0].map((h) => h.trim());
    body = rows.slice(1);
  }
  return { headers, rows: body };
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // strip unit annotations e.g. (L/sec), (C), (F), (kWh)
    .replace(/[\s_-]+/g, "");

export function mapColumns(headers: string[]): { map: Map<ColName, number>; missing: NumericCol[] } {
  const idx = headers.map(norm);
  const wanted: ColName[] = [TIMESTAMP_COL, EQUIPMENT_COL, ...NUMERIC_COLS];
  const map = new Map<ColName, number>();
  for (const w of wanted) {
    const i = idx.indexOf(norm(w));
    if (i >= 0) map.set(w, i);
  }
  // timestamp + equipment_id + the energy target are required; every other
  // measurement column is optional and degrades to all-missing when absent.
  const required: ColName[] = [TIMESTAMP_COL, EQUIPMENT_COL, TARGET_COL];
  const missingRequired = required.filter((w) => !map.has(w));
  if (missingRequired.length) {
    const found = headers.length ? headers.join(", ") : "(none — the file appears to have no header row)";
    throw new DatasetError(
      `Missing required column(s): ${missingRequired.join(", ")}. Found columns in your file: ${found}. ` +
        "Per the YUKTHI 2026 data specification, timestamp, equipment_id and a 'Chiller Energy Consumption' " +
        "column are required; the other measurement columns may be provided as available, but blank values are also accepted.",
    );
  }
  const missing = NUMERIC_COLS.filter((c) => !map.has(c));
  return { map, missing };
}

/** Parse a timestamp string as written (no timezone conversion; hour/dow come
 *  from the literal fields so diurnal patterns are not shifted). */
export function parseTs(v: string): ParsedTs | null {
  const s = v.trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?/);
  if (!m) return null;
  const Y = +m[1];
  const Mo = +m[2];
  const D = +m[3];
  const H = +m[4];
  const Mi = +m[5];
  const Se = m[6] ? +m[6] : 0;
  const ms = Date.UTC(Y, Mo - 1, D, H, Mi, Se);
  if (Number.isNaN(ms)) return null;
  const dow = new Date(ms).getUTCDay();
  return { ms, hour: H + Mi / 60 + (m[7] ? +m[7] / 1000 / 3600 : 0), dow };
}

export function buildDataset(
  text: string,
  fileName: string,
): { quality: DataQuality; series: Record<string, Series> } {
  const { headers, rows } = splitCsv(text);
  const { map: colIdx, missing: missingColumns } = mapColumns(headers);
  if (!rows.length) throw new DatasetError("The file has a header row but no observations.");
  if (!headers.length || headers.every((h) => h.trim() === ""))
    throw new DatasetError("The file appears to be empty. Upload a CSV with a header row and at least one observation.");

  const tIdx = colIdx.get(TIMESTAMP_COL)!;
  const eIdx = colIdx.get(EQUIPMENT_COL)!;
  const groups = new Map<string, RawGroup>();
  const seen = new Set<string>();
  let badRows = 0;
  let duplicatePairs = 0;

  for (const r of rows) {
    const ts = parseTs(r[tIdx] ?? "");
    if (!ts) {
      badRows++;
      continue;
    }
    const eq = (r[eIdx] ?? "").trim();
    if (!eq) {
      badRows++;
      continue;
    }
    const key = `${eq}\u0000${ts.ms}`;
    if (seen.has(key)) {
      duplicatePairs++;
      continue;
    }
    seen.add(key);
    let g = groups.get(eq);
    if (!g) {
      g = {
        times: [],
        hours: [],
        days: [],
        values: {} as Record<NumericCol, number[]>,
        observed: {} as Record<NumericCol, number[]>,
      };
      for (const c of NUMERIC_COLS) {
        g.values[c] = [];
        g.observed[c] = [];
      }
      groups.set(eq, g);
    }
    g.times.push(ts.ms);
    g.hours.push(ts.hour);
    g.days.push(ts.dow);
    for (const c of NUMERIC_COLS) {
      const idx = colIdx.get(c);
      const raw = idx === undefined ? "" : (r[idx] ?? "").trim();
      const v = raw === "" ? NaN : Number(raw);
      g.values[c].push(Number.isFinite(v) ? v : NaN);
      g.observed[c].push(Number.isFinite(v) ? 1 : 0);
    }
  }

  if (!groups.size) throw new DatasetError("No valid observations found in the file.");

  const series: Record<string, Series> = {};
  const equipmentIds = [...groups.keys()].sort();
  let totalRows = 0;

  for (const eq of equipmentIds) {
    const g = groups.get(eq)!;
    const order = g.times.map((_, i) => i).sort((a, b) => g.times[a] - g.times[b]);
    const times: number[] = [];
    const hours: number[] = [];
    const days: number[] = [];
    const data = {} as Record<NumericCol, number[]>;
    const observed = {} as Record<NumericCol, Uint8Array>;
    for (const c of NUMERIC_COLS) {
      data[c] = [];
      observed[c] = new Uint8Array(order.length);
    }
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      times.push(g.times[i]);
      hours.push(g.hours[i]);
      days.push(g.days[i]);
      for (const c of NUMERIC_COLS) {
        data[c].push(g.values[c][i]);
        observed[c][k] = g.observed[c][i];
      }
    }
    series[eq] = { equipmentId: eq, times, hours, days, data, observed };
    totalRows += times.length;
  }

  // Quality statistics.
  const missingByColumn: Partial<Record<NumericCol, number>> = {};
  for (const c of NUMERIC_COLS) {
    if (missingColumns.includes(c)) continue; // absent columns are reported separately
    let miss = 0;
    for (const eq of equipmentIds) {
      const obs = series[eq].observed[c];
      for (let i = 0; i < obs.length; i++) if (!obs[i]) miss++;
    }
    if (miss > 0) missingByColumn[c] = miss;
  }

  let gapCount = 0;
  let maxGapHours = 0;
  let allIntervals: number[] = [];
  for (const eq of equipmentIds) {
    const t = series[eq].times;
    for (let i = 1; i < t.length; i++) allIntervals.push(t[i] - t[i - 1]);
  }
  allIntervals.sort((a, b) => a - b);
  const med = allIntervals.length ? allIntervals[Math.floor(allIntervals.length / 2)] : 1800000;
  for (const eq of equipmentIds) {
    const t = series[eq].times;
    for (let i = 1; i < t.length; i++) {
      const d = t[i] - t[i - 1];
      if (d > Math.max(med * 1.5, 3.6e6)) {
        gapCount++;
        maxGapHours = Math.max(maxGapHours, d / 3.6e6);
      }
    }
  }

  let periodStart = Infinity;
  let periodEnd = -Infinity;
  for (const eq of equipmentIds) {
    const t = series[eq].times;
    if (t[0] < periodStart) periodStart = t[0];
    if (t[t.length - 1] > periodEnd) periodEnd = t[t.length - 1];
  }

  const quality: DataQuality = {
    fileName,
    rowCount: totalRows,
    equipmentCount: equipmentIds.length,
    equipmentIds,
    periodStart,
    periodEnd,
    missingByColumn,
    missingColumns,
    duplicatePairs,
    gapCount,
    maxGapHours: Math.round(maxGapHours * 10) / 10,
    columnsFound: headers,
    badRows,
  };

  return { quality, series };
}