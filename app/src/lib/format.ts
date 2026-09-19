// ThermaSight — display formatting (all timestamps rendered in the UTC frame
// the pipeline uses; the UI notes this once in the chart header).

import type { Severity } from "./pipeline/types";

export function fmtSig(v: number, dp = 1): string {
  if (!Number.isFinite(v)) return "-";
  return v.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: 0 });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function fmtShort(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtAxis(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

export function fmtDurationHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${fmtSig(h, 1)} h`;
  return `${fmtSig(h / 24, 1)} d`;
}

export function fmtEnergy(kwh: number): string {
  if (Math.abs(kwh) >= 1_000_000) return `${fmtSig(kwh / 1_000_000, 2)} GWh`;
  if (Math.abs(kwh) >= 1000) return `${fmtSig(kwh / 1000, 1)} MWh`;
  return `${fmtSig(kwh, 0)} kWh`;
}

export function severityLabel(s: Severity): string {
  switch (s) {
    case "action":
      return "Action";
    case "alert":
      return "Alert";
    case "watch":
      return "Watch";
    default:
      return "Nominal";
  }
}

export const MONTHS_SHORT = MONTHS;