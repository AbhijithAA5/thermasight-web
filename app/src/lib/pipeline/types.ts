// ThermaSight — data contract types (YUKTHI 2026 Intelligent Energy & Equipment Monitoring).
// Everything downstream is built against this contract; no hard-coded observations.

export const TIMESTAMP_COL = "timestamp" as const;
export const EQUIPMENT_COL = "equipment_id" as const;

export const NUMERIC_COLS = [
  "Chilled Water Rate",
  "Cooling Water Temperature",
  "Building Load",
  "Chiller Energy Consumption",
  "Outside Temperature",
  "Dew Point",
  "Humidity",
  "Wind Speed",
  "Pressure",
] as const;

export type NumericCol = (typeof NUMERIC_COLS)[number];
export type ColName = typeof TIMESTAMP_COL | typeof EQUIPMENT_COL | NumericCol;

export const TARGET_COL: NumericCol = "Chiller Energy Consumption";

export const CONTEXT_COLS: NumericCol[] = [
  "Building Load",
  "Chilled Water Rate",
  "Cooling Water Temperature",
  "Outside Temperature",
  "Dew Point",
  "Humidity",
  "Wind Speed",
  "Pressure",
];

export const COLUMN_UNITS: Record<NumericCol, string> = {
  "Chilled Water Rate": "l/s",
  "Cooling Water Temperature": "\u00b0C",
  "Building Load": "RT",
  "Chiller Energy Consumption": "kWh",
  "Outside Temperature": "\u00b0F",
  "Dew Point": "\u00b0F",
  Humidity: "%",
  "Wind Speed": "m/s",
  Pressure: "inHg",
};

/** One equipment unit's chronological series (sorted, deduped by timestamp). */
export interface Series {
  equipmentId: string;
  /** epoch ms of each observation (wall-clock as written in the file) */
  times: number[];
  /** hour-of-day 0..23.99 read from the raw timestamp string (timezone-agnostic) */
  hours: number[];
  /** day-of-week 0..6 (ISO) */
  days: number[];
  /** per-column values; NaN = missing */
  data: Record<NumericCol, number[]>;
  /** per-column observed flag (1 = present in source), parallel to data */
  observed: Record<NumericCol, Uint8Array>;
}

export interface DataQuality {
  fileName: string;
  rowCount: number;
  equipmentCount: number;
  equipmentIds: string[];
  periodStart: number;
  periodEnd: number;
  missingByColumn: Partial<Record<NumericCol, number>>;
  /** measurement columns entirely absent from the file (degraded to all-missing) */
  missingColumns: NumericCol[];
  duplicatePairs: number;
  gapCount: number;
  maxGapHours: number;
  columnsFound: string[];
  badRows: number;
}

export type Severity = "normal" | "watch" | "alert" | "action";

export interface Contributor {
  column: NumericCol;
  z: number;
  value: number;
  baselineMedian: number;
  unit: string;
  direction: "high" | "low";
  weight: number;
}

export type PatternTag =
  | "contextual_energy_spike"
  | "high_consumption_low_load"
  | "cooling_water_drift"
  | "flow_imbalance"
  | "sensor_stuck"
  | "transient_spike"
  | "degradation_trend"
  | "offhours_standby"
  | "concurrent_context_shift"
  | "unclassified";

export interface Recommendation {
  action: string;
  rationale: string;
  priority: "low" | "medium" | "high";
}

export interface EvidenceRow {
  column: NumericCol;
  observed: number;
  expected: number;
  unit: string;
  z: number;
}

export interface Episode {
  id: string;
  equipmentId: string;
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  durationHours: number;
  peakIndex: number;
  peakScore: number;
  severity: Exclude<Severity, "normal">;
  patternTags: PatternTag[];
  narrative: string;
  contributors: Contributor[];
  evidence: EvidenceRow[];
  recommendations: Recommendation[];
}

export interface EquipmentReport {
  equipmentId: string;
  score: number[];
  severity: Severity[];
  flagged: boolean[];
  threshold: number;
  health: number | null;
  degradationTrend: number;
  episodes: Episode[];
  energyTotalKwh: number;
  energyMeanKwh: number;
  count: number;
  /** true when the unit could not be modelled (too few points / no usable energy) */
  insufficientData?: boolean;
  insufficientReason?: string;
  /** feature counts actually used (columns may be absent from the source CSV) */
  modelFeatures?: { if: number; mlp: number };
  /** predictive-maintenance advisory (null for insufficient units) */
  maintenance?: {
    status: "ok" | "plan" | "recommended" | "due";
    horizonDays: number;
    slopePerDay: number;
    recentDrift: number;
  } | null;
  /** per-calendar-day seasonal degradation series (energy vs 45-day baseline) */
  daily?: { days: number[]; energy: number[]; seasonal: number[]; residZ: number[] };
}

export interface ModelMetadata {
  isolationForest: { trees: number; maxSamples: number; features: number };
  residualModel: { hiddenUnits: number; epochs: number; trainLoss: number; valLoss: number; features: number };
  fusion: { ifWeight: number; residualWeight: number; thresholdQuantile: number; joinWindow: number };
  runtimeMs: number;
}

export interface PipelineResult {
  quality: DataQuality;
  series: Record<string, Series>;
  equipment: Record<string, EquipmentReport>;
  episodes: Episode[];
  model: ModelMetadata;
  nominalIntervalMinutes: number;
  generatedAt: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}