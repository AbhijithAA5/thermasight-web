// ThermaSight — equipment explorer: variable + unit selection, the main
// time-series instrument, and the unit's anomaly list.
import { useApp } from "../lib/store";
import { COLUMN_UNITS, NUMERIC_COLS, type NumericCol } from "../lib/pipeline/types";
import { fmtDurationHours, fmtSig, fmtTime } from "../lib/format";
import { TimeSeriesChart, type Band } from "./charts/TimeSeriesChart";
import { SeverityChip, patternLabel } from "./chips";
import { IconChevronDown, IconChevronRight } from "../lib/icons";

export function Explorer() {
  const { state, setEquipment, setVariable, selectEpisode, setTimeRange, setTab } = useApp();
  const result = state.result;
  if (!result) return null;

  const ids = result.quality.equipmentIds;
  const eq = state.equipmentId ?? ids[0];
  const rep = result.equipment[eq];
  const s = result.series[eq];
  const variable: NumericCol = state.variable;
  const unit = COLUMN_UNITS[variable];
  const values = s.data[variable];

  const bands: Band[] = rep.episodes.map((ep) => ({
    id: ep.id,
    startIndex: ep.startIndex,
    endIndex: ep.endIndex,
    severity: ep.severity,
  }));

  return (
    <main className="ts-container ts-page">
      <div className="ts-explorer-back">
        <button className="ts-link dim" onClick={() => setTab("overview")}>
          ← Back to overview
        </button>
      </div>
      <div className="ts-explorer-controls">
        <div className="ts-pill-group" role="group" aria-label="Equipment">
          {ids.map((id) => {
            const h = result.equipment[id].health;
            return (
              <button
                key={id}
                className={`ts-pill ${eq === id ? "ts-pill-active" : ""}`}
                onClick={() => setEquipment(id)}
              >
                <span
                  className="ts-pill-dot"
                  style={{ background: h == null ? "var(--ts-hair)" : h >= 75 ? "var(--ts-ok)" : h >= 55 ? "var(--ts-warn)" : "var(--ts-danger)" }}
                  aria-hidden
                />
                <span className="mono">{id}</span>
              </button>
            );
          })}
        </div>

        <label className="ts-select-wrap">
          <span className="sr-only">Variable</span>
          <select
            className="ts-select mono"
            value={variable}
            onChange={(e) => setVariable(e.target.value as NumericCol)}
          >
            {NUMERIC_COLS.map((c) => (
              <option key={c} value={c}>
                {c} ({COLUMN_UNITS[c]})
              </option>
            ))}
          </select>
          <IconChevronDown className="ts-select-chevron" />
        </label>

        {state.timeRange && (
          <button className="ts-link dim" onClick={() => setTimeRange(null)}>
            reset zoom
          </button>
        )}
        <span className="ts-utc-note mono">timestamps in UTC</span>
      </div>

      <section className="ts-panel ts-chart-panel">
        <div className="ts-chart-head">
          <div>
            <h2 className="ts-section-title">
              {variable} <span className="ts-unit mono">{unit}</span>
            </h2>
            <p className="ts-chart-sub mono">
              {eq} · {s.times.length.toLocaleString()} observations · anomaly bands drawn from the learned model
            </p>
          </div>
          <div className="ts-legend">
            <span className="ts-legend-item">
              <span className="ts-legend-swatch ts-legend-watch" /> watch
            </span>
            <span className="ts-legend-item">
              <span className="ts-legend-swatch ts-legend-alert" /> alert
            </span>
            <span className="ts-legend-item">
              <span className="ts-legend-swatch ts-legend-action" /> action
            </span>
          </div>
        </div>
        <TimeSeriesChart
          times={s.times}
          values={values}
          severity={rep.severity}
          bands={bands}
          range={state.timeRange}
          onRangeChange={setTimeRange}
          onOpenBand={(id) => selectEpisode(id)}
          unit={unit}
          label={variable}
        />
      </section>

      <section className="ts-panel">
        <h2 className="ts-section-title">Anomalies for {eq}</h2>
        {rep.episodes.length === 0 ? (
          <p className="ts-empty mono">no anomalies detected for this unit</p>
        ) : (
          <ul className="ts-ep-list">
            {rep.episodes.map((ep) => (
              <li key={ep.id} className="ts-ep-row">
                <button className="ts-ep-row-main" onClick={() => selectEpisode(ep.id)}>
                  <SeverityChip s={ep.severity} />
                  <span className="ts-ep-time mono">{fmtTime(ep.startTime)}</span>
                  <span className="ts-ep-detail mono">
                    {fmtDurationHours(ep.durationHours)} · peak {fmtSig(ep.peakScore, 2)}
                  </span>
                  <span className="ts-ep-pattern">{patternLabel(ep.patternTags[0] ?? "contextual_energy_spike")}</span>
                  <IconChevronRight className="h-4 w-4 ts-ep-chevron" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}