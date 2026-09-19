// ThermaSight — fleet overview: KPI band, equipment cards with health gauges,
// priority queue of anomalies.
import { useApp } from "../lib/store";
import { useId } from "react";
import type { PipelineResult } from "../lib/pipeline/types";
import { fleetStats } from "../lib/pipeline/scoring";
import { fmtEnergy, fmtSig, fmtTime } from "../lib/format";
import { Gauge, Sparkline } from "./charts/mini";
import { SeverityChip, patternLabel } from "./chips";

function healthColor(h: number | null): string {
  return h == null ? "var(--ts-hair)" : h >= 75 ? "var(--ts-ok)" : h >= 55 ? "var(--ts-warn)" : "var(--ts-danger)";
}

function pmLabel(m: { status: "ok" | "plan" | "recommended" | "due"; horizonDays: number } | null | undefined): string {
  if (!m) return "PM: n/a";
  const w = Math.max(1, Math.ceil(m.horizonDays / 7));
  if (m.status === "due") return `PM: due · ~${w}w`;
  if (m.status === "recommended") return `PM: recommended · ~${w}w`;
  if (m.status === "plan") return `PM: plan · ~${w}w`;
  return "PM: on track";
}

/** Seasonal degradation graph: daily mean energy vs the unit's 45-day
 *  seasonal baseline. Solid line above the dashed line = degrading. */
function DegradeGraph({ daily }: { daily: { days: number[]; energy: number[]; seasonal: number[] } }) {
  const gid = useId();
  const width = 260;
  const height = 56;
  const { days, energy, seasonal } = daily;
  const n = days.length;
  const stride = Math.max(1, Math.ceil(n / width));
  const t: number[] = [];
  const en: number[] = [];
  const se: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  let prev: number | null = null;
  for (let k = 0; k < n; k += stride) {
    let s = 0;
    let c = 0;
    let l = Infinity;
    let h = -Infinity;
    let ss = 0;
    let sc = 0;
    for (let i = k; i < Math.min(n, k + stride); i++) {
      const e = energy[i];
      if (!Number.isFinite(e)) continue;
      if (e < l) l = e;
      if (e > h) h = e;
      s += e;
      c++;
      const sv = seasonal[i];
      if (Number.isFinite(sv)) {
        ss += sv;
        sc++;
      }
    }
    if (c > 0) {
      let m = s / c;
      if (prev !== null) m = (prev + m * 2) / 3;
      prev = m;
      t.push(days[k]);
      en.push(m);
      lo.push(l);
      hi.push(h);
      se.push(sc ? ss / sc : m);
    }
  }
  if (!t.length) return null;
  const loAll = Math.min(...lo, ...se);
  const hiAll = Math.max(...hi, ...se);
  const span = hiAll - loAll || 1;
  const X = (ms: number) => ((ms - t[0]) / (t[t.length - 1] - t[0] || 1)) * (width - 2) + 1;
  const Y = (val: number) => 3 + (1 - (val - loAll) / span) * (height - 6);
  const line = t.map((ms, i) => `${i ? "L" : "M"}${X(ms).toFixed(1)},${Y(en[i]).toFixed(1)}`).join("");
  const band =
    t.map((ms, i) => `${i ? "L" : "M"}${X(ms).toFixed(1)},${Y(lo[i]).toFixed(1)}`).join("") +
    " " +
    [...t]
      .reverse()
      .map((ms, i) => {
        const j = t.length - 1 - i;
        return `L${X(ms).toFixed(1)},${Y(hi[j]).toFixed(1)}`;
      })
      .join("") +
    " Z";
  const sea = t.map((ms, i) => `${i ? "L" : "M"}${X(ms).toFixed(1)},${Y(se[i]).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden className="block" style={{ width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ts-accent)" stopOpacity="0.12" />
          <stop offset="100%" stopColor="var(--ts-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={band} fill="var(--ts-accent)" fillOpacity="0.06" stroke="none" />
      <path d={`${line} L${X(t[t.length - 1])},${height} L${X(t[0])},${height} Z`} fill={`url(#${gid})`} />
      <path d={sea} fill="none" stroke="var(--ts-text-mut)" strokeWidth="1.1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <path d={line} fill="none" stroke="var(--ts-accent)" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
import { IconChevronRight } from "../lib/icons";

function KPIs({ result }: { result: PipelineResult }) {
  const stat = fleetStats(result.equipment, result.series);
  const ids = result.quality.equipmentIds;
  const healths = ids.map((eq) => result.equipment[eq].health).filter((h): h is number => h != null);
  const avgHealth = healths.length ? Math.round(healths.reduce((a, b) => a + b, 0) / healths.length) : 0;
  return (
    <div className="ts-kpi-band">
      <div className="ts-kpi">
        <span className="ts-kpi-label">Fleet energy</span>
        <span className="ts-kpi-value mono">{fmtEnergy(stat.energyTotalKwh)}</span>
        <span className="ts-kpi-sub mono">across the observation period</span>
      </div>
      <div className="ts-kpi">
        <span className="ts-kpi-label">Anomalies</span>
        <span className="ts-kpi-value mono">{result.episodes.length}</span>
        <span className="ts-kpi-sub">
          {stat.bySeverity.action > 0 && (
            <span className="ts-kpi-chip ts-chip-action">{stat.bySeverity.action} action</span>
          )}
          {stat.bySeverity.alert > 0 && (
            <span className="ts-kpi-chip ts-chip-alert">{stat.bySeverity.alert} alert</span>
          )}
          {stat.bySeverity.watch > 0 && (
            <span className="ts-kpi-chip ts-chip-warn">{stat.bySeverity.watch} watch</span>
          )}
        </span>
      </div>
      <div className="ts-kpi">
        <span className="ts-kpi-label">Units at risk</span>
        <span className={`ts-kpi-value mono ${stat.atRisk.length > 0 ? "ts-tx-danger" : ""}`}>
          {stat.atRisk.length}<span className="ts-kpi-denom">/{ids.length}</span>
        </span>
        <span className="ts-kpi-sub mono">health below 60</span>
      </div>
      <div className="ts-kpi">
        <span className="ts-kpi-label">Fleet health</span>
        <span className={`ts-kpi-value mono ${avgHealth >= 75 ? "ts-tx-ok" : avgHealth >= 55 ? "ts-tx-warn" : "ts-tx-danger"}`}>{avgHealth}<span className="ts-kpi-denom">/100</span></span>
        <span className="ts-kpi-sub mono">learned from recent behaviour</span>
      </div>
    </div>
  );
}

export function FleetOverview() {
  const { state, setEquipment, selectEpisode, setTab } = useApp();
  const result = state.result;
  if (!result) return null;

  const ids = result.quality.equipmentIds;
  const queue = result.episodes.filter((e) => e.severity !== "watch").concat(result.episodes.filter((e) => e.severity === "watch")).slice(0, 7);

  return (
    <main className="ts-container ts-page">
      <KPIs result={result} />

      <div className="grid gap-6 lg:grid-cols-[1fr_330px]">
        <div>
          <h2 className="ts-section-title">Equipment</h2>
          <div className="ts-unit-grid">
            {ids.map((id) => {
              const rep = result.equipment[id];
              const s = result.series[id];
              const worst = rep.episodes[0];
              return (
                <article key={id} className="ts-panel ts-unit-card">
                  <div className="flex items-start gap-4">
                    <Gauge value={rep.health} size={84} label="health" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="ts-unit-name mono">{id}</h3>
                        <span className="ts-unit-dot" aria-hidden style={{ background: healthColor(rep.health) }} />
                        {worst ? <SeverityChip s={worst.severity} /> : <SeverityChip s="normal" />}
                      </div>
                      <dl className="ts-unit-stats">
                        <div>
                          <dt>Mean draw</dt>
                          <dd className="mono">{fmtSig(rep.energyMeanKwh, 1)} kWh/int</dd>
                        </div>
                        <div>
                          <dt>Anomalies</dt>
                          <dd className="mono">{rep.episodes.length}</dd>
                        </div>
                        <div>
                          <dt>Trend</dt>
                          <dd className="mono">{rep.degradationTrend > 0.01 ? "+" : ""}{fmtSig(rep.degradationTrend, 2)}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                  <div className="mt-3">
                    <Sparkline
                      times={s.times}
                      values={s.data["Chiller Energy Consumption"]}
                      flagged={rep.flagged}
                      color={rep.health != null && rep.health >= 60 ? "var(--ts-accent)" : "var(--ts-warn)"}
                    />
                  </div>
                  {rep.daily && rep.daily.days.length > 0 && (
                    <div className="mt-2">
                      <div className="ts-pm-row">
                        <span className={`ts-pm mono ts-pm-${rep.maintenance?.status ?? "ok"}`}>
                          {pmLabel(rep.maintenance)}
                        </span>
                        <span className="ts-degrade-cap mono">seasonal energy vs baseline</span>
                      </div>
                      <DegradeGraph daily={rep.daily} />
                    </div>
                  )}
                  <div className="ts-unit-foot">
                    <button className="ts-link" onClick={() => setEquipment(id)}>
                      Open unit <IconChevronRight className="h-3.5 w-3.5" />
                    </button>
                    {worst && (
                      <button className="ts-link dim" onClick={() => selectEpisode(worst.id)}>
                        {patternLabel(worst.patternTags[0] ?? "contextual_energy_spike")} · {fmtTime(worst.startTime)}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside>
          <div className="flex items-baseline justify-between">
            <h2 className="ts-section-title">Priority queue</h2>
            <button className="ts-link dim" onClick={() => setTab("anomalies")}>
              view all
            </button>
          </div>
          <ol className="ts-queue">
            {queue.map((ep) => (
              <li key={ep.id}>
                <button className={`ts-queue-row ts-queue-${ep.severity}`} onClick={() => selectEpisode(ep.id)}>
                  <div className="flex items-center gap-2">
                    <SeverityChip s={ep.severity} />
                    <span className="mono ts-queue-equip">{ep.equipmentId}</span>
                  </div>
                  <div className="ts-queue-meta mono">
                    {fmtTime(ep.startTime)} · score {fmtSig(ep.peakScore, 2)}
                  </div>
                  <div className="ts-queue-pattern">{patternLabel(ep.patternTags[0] ?? "contextual_energy_spike")}</div>
                </button>
              </li>
            ))}
            {!queue.length && <li className="ts-queue-empty mono">no anomalies on record</li>}
          </ol>
        </aside>
      </div>
    </main>
  );
}