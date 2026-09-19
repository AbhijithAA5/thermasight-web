// ThermaSight — anomaly investigation drawer: narrative, evidence, contributing
// factors, pattern classification, recommendations.
import { useApp } from "../lib/store";
import type { Episode } from "../lib/pipeline/types";
import { fmtDurationHours, fmtSig, fmtTime, severityLabel } from "../lib/format";
import { PatternChip, SeverityChip } from "./chips";
import { IconClose } from "../lib/icons";

function FactorBar({ ep }: { ep: Episode }) {
  const top = ep.contributors[0];
  if (!top) return null;
  return (
    <div className="ts-factors">
      {ep.contributors.map((c) => (
        <div key={c.column} className="ts-factor">
          <div className="flex items-baseline justify-between gap-3">
            <span className="ts-factor-name">{c.column}</span>
            <span className="ts-factor-val mono">
              {c.direction === "high" ? "+" : "\u2212"}
              {fmtSig(Math.abs(c.z), 1)} σ
            </span>
          </div>
          <div className="ts-factor-track">
            <div
              className="ts-factor-fill"
              style={{
                width: `${Math.max(6, Math.min(100, Math.abs(c.z) * 16))}%`,
                background: Math.abs(c.z) >= 2.5 ? "var(--ts-danger)" : Math.abs(c.z) >= 1.8 ? "var(--ts-warn)" : "var(--ts-accent)",
              }}
            />
          </div>
          <span className="ts-factor-meta mono">
            {fmtSig(c.value, 2)} {c.unit} vs baseline {fmtSig(c.baselineMedian, 2)} {c.unit}
          </span>
        </div>
      ))}
    </div>
  );
}

function PriorityChip({ p }: { p: "low" | "medium" | "high" }) {
  const cls = p === "high" ? "ts-prio-high" : p === "medium" ? "ts-prio-medium" : "ts-prio-low";
  return <span className={`ts-tag ${cls}`}>{p} priority</span>;
}

export function AnomalyDrawer() {
  const { state, selectEpisode } = useApp();
  const result = state.result;
  const ep = result?.episodes.find((e) => e.id === state.selectedEpisodeId) ?? null;
  if (!ep) return null;

  return (
    <div className="ts-drawer-layer">
      <button className="ts-drawer-backdrop" onClick={() => selectEpisode(null)} aria-label="Close investigation" />
      <aside className="ts-drawer" role="dialog" aria-modal="true" aria-label={`Anomaly on ${ep.equipmentId}`}>
        <div className="ts-drawer-head">
          <div className="flex items-center gap-2">
            <span className="mono ts-drawer-equip">{ep.equipmentId}</span>
            <SeverityChip s={ep.severity} />
          </div>
          <button className="ts-icon-btn" onClick={() => selectEpisode(null)} aria-label="Close">
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        <div className="ts-drawer-scroll">
          <dl className="ts-drawer-meta mono">
            <div>
              <dt>Window</dt>
              <dd>
                {fmtTime(ep.startTime)} to {fmtTime(ep.endTime)}
              </dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{fmtDurationHours(ep.durationHours)}</dd>
            </div>
            <div>
              <dt>Peak score</dt>
              <dd>{fmtSig(ep.peakScore, 3)}</dd>
            </div>
            <div>
              <dt>Severity</dt>
              <dd>{severityLabel(ep.severity)}</dd>
            </div>
          </dl>

          <section className="ts-drawer-section">
            <h3 className="ts-drawer-h">What happened</h3>
            <p className="ts-drawer-narrative">{ep.narrative}</p>
            {ep.patternTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {ep.patternTags.map((t) => (
                  <PatternChip key={t} t={t} />
                ))}
              </div>
            )}
          </section>

          <section className="ts-drawer-section">
            <h3 className="ts-drawer-h">Contributing measurements</h3>
            <FactorBar ep={ep} />
          </section>

          <section className="ts-drawer-section">
            <h3 className="ts-drawer-h">Evidence</h3>
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Measurement</th>
                  <th className="text-right">Observed</th>
                  <th className="text-right">Expected</th>
                  <th className="text-right">Deviation</th>
                </tr>
              </thead>
              <tbody>
                {ep.evidence.map((e) => (
                  <tr key={e.column}>
                    <td>{e.column}</td>
                    <td className="mono text-right">{fmtSig(e.observed, 2)}</td>
                    <td className="mono text-right">{fmtSig(e.expected, 2)}</td>
                    <td className={`mono text-right ${Math.abs(e.z) >= 2 ? "ts-tx-danger" : Math.abs(e.z) >= 1.5 ? "ts-tx-warn" : ""}`}>
                      {e.z > 0 ? "+" : ""}
                      {fmtSig(e.z, 1)} σ
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="ts-drawer-note">Expected values are the unit&apos;s own recent baseline (12-hour trailing median), so the comparison is contextual, not absolute.</p>
          </section>

          <section className="ts-drawer-section">
            <h3 className="ts-drawer-h">Recommended next steps</h3>
            <ol className="ts-recs">
              {ep.recommendations.map((r) => (
                <li key={r.action} className="ts-rec">
                  <PriorityChip p={r.priority} />
                  <div>
                    <p className="ts-rec-action">{r.action}</p>
                    <p className="ts-rec-rationale">{r.rationale}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </aside>
    </div>
  );
}