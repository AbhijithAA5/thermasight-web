// ThermaSight — all anomalies, filterable by severity, each opening the
// investigation drawer.
import { useMemo, useState } from "react";
import { useApp } from "../lib/store";
import { fmtDurationHours, fmtSig, fmtTime } from "../lib/format";
import { PatternChip, SeverityChip } from "./chips";
import { IconChevronRight } from "../lib/icons";

type Filter = "all" | "action" | "alert" | "watch";

export function AnomaliesView() {
  const { state, selectEpisode } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const result = state.result;
  const list = useMemo(
    () => (result ? result.episodes.filter((e) => filter === "all" || e.severity === filter) : []),
    [result, filter],
  );
  if (!result) return null;

  const counts = { all: result.episodes.length, action: 0, alert: 0, watch: 0 };
  for (const e of result.episodes) counts[e.severity]++;

  return (
    <main className="ts-container ts-page">
      <div className="flex items-center justify-between gap-4">
        <h2 className="ts-section-title">Anomalies</h2>
        <div className="ts-pill-group" role="group" aria-label="Filter by severity">
          {(["all", "action", "alert", "watch"] as Filter[]).map((f) => (
            <button key={f} className={`ts-pill ${filter === f ? "ts-pill-active" : ""}`} onClick={() => setFilter(f)}>
              <span className="mono">{f}</span>
              <span className="ts-pill-count mono">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <p className="ts-empty mono">no anomalies with this filter</p>
      ) : (
        <ul className="ts-anomaly-list">
          {list.map((ep) => (
            <li key={ep.id}>
              <button className="ts-anomaly-card" onClick={() => selectEpisode(ep.id)}>
                <div className="flex items-center gap-3">
                  <SeverityChip s={ep.severity} />
                  <span className="mono ts-anomaly-equip">{ep.equipmentId}</span>
                </div>
                <div className="ts-anomaly-time mono">
                  {fmtTime(ep.startTime)} · {fmtDurationHours(ep.durationHours)}
                </div>
                <div className="ts-anomaly-meta">
                  {ep.patternTags.slice(0, 2).map((t) => (
                    <PatternChip key={t} t={t} />
                  ))}
                  <span className="ts-anomaly-score mono">peak {fmtSig(ep.peakScore, 2)}</span>
                </div>
                <IconChevronRight className="h-4 w-4 ts-anomaly-chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}