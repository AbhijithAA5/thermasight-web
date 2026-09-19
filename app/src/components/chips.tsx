// ThermaSight — shared status chips.
import type { PatternTag, Severity } from "../lib/pipeline/types";
import { severityLabel } from "../lib/format";

const SEV_CLASS: Record<Severity, string> = {
  normal: "ts-chip-ok",
  watch: "ts-chip-warn",
  alert: "ts-chip-alert",
  action: "ts-chip-action",
};

export function SeverityChip({ s, className = "" }: { s: Severity; className?: string }) {
  return (
    <span className={`${SEV_CLASS[s]} ${className}`}>
      <span className="ts-chip-dot" aria-hidden />
      {severityLabel(s)}
    </span>
  );
}

const PATTERN_LABEL: Record<PatternTag, string> = {
  unclassified: "Unclassified",
  contextual_energy_spike: "Energy spike",
  high_consumption_low_load: "Energy up at steady load",
  cooling_water_drift: "Condenser drift",
  flow_imbalance: "Flow imbalance",
  sensor_stuck: "Frozen sensor",
  transient_spike: "Transient",
  degradation_trend: "Degradation trend",
  offhours_standby: "Off-hours draw",
  concurrent_context_shift: "Mode shift",
};

export function patternLabel(t: PatternTag): string {
  return PATTERN_LABEL[t];
}

export function PatternChip({ t }: { t: PatternTag }) {
  return <span className="ts-tag">{patternLabel(t)}</span>;
}