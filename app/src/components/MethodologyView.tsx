// ThermaSight — methodology: the data-to-insight pipeline, the ML layer with
// live model metadata, and honest scope notes.
import { useApp } from "../lib/store";
import { fmtSig } from "../lib/format";

const STEPS = [
  { title: "Ingest", body: "Any CSV conforming to the YUKTHI 2026 data contract. Columns are located by name, records are keyed by (equipment_id, timestamp), and each unit becomes its own chronological series." },
  { title: "Quality", body: "Missing values are counted per column, duplicate pairs are detected, irregular gaps are measured. Nothing is hard-coded about row counts or specific timestamps." },
  { title: "Features", body: "Short gaps are interpolated, longer gaps carry forward. Time-of-day and day-of-week are encoded as cycles; trailing 24-hour rolling statistics and lags describe recent dynamics without leaking the future." },
  { title: "Learn", body: "Two models per unit: an isolation forest finds structurally unusual combinations of measurements, and a small network reconstructs expected energy from operating context." },
  { title: "Detect", body: "Isolation score and contextual residual are fused, calibrated per unit, and filtered through persistence logic: isolated blips stay low, sustained deviations escalate." },
  { title: "Interpret", body: "Every episode gets its contributing measurements, a pattern classification, a plain-language narrative and evidence-based recommended next steps." },
];

export function MethodologyView() {
  const { state } = useApp();
  const result = state.result;

  return (
    <main className="ts-container ts-page">
      <h2 className="ts-section-title">How the analysis works</h2>
      <p className="ts-method-lead">
        The pipeline is a reusable data-to-insight chain. It learns each unit&apos;s own normal, so the same code
        runs unchanged on the demo data, the participant dataset, or a live feed that follows the contract.
      </p>

      <ol className="ts-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="ts-step">
            <span className="ts-step-idx mono">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <h3 className="ts-step-title">{s.title}</h3>
              <p className="ts-step-body">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="ts-panel ts-model-panel">
        <h2 className="ts-section-title">The machine-learning layer</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <article className="ts-model-card">
            <h3 className="ts-model-title">Isolation forest</h3>
            <p className="ts-model-body">
              Grows random partition trees per unit and measures how few splits a row needs to be isolated. Rows that
              isolate quickly are structurally unusual across <em>all</em> measurements at once, which catches
              multi-variable signatures a single threshold would miss.
            </p>
            {result && (
              <dl className="ts-model-stats mono">
                <div>
                  <dt>Trees per unit</dt>
                  <dd>{result.model.isolationForest.trees}</dd>
                </div>
                <div>
                  <dt>Sample size</dt>
                  <dd>{result.model.isolationForest.maxSamples}</dd>
                </div>
                <div>
                  <dt>Features</dt>
                  <dd>{result.model.isolationForest.features}</dd>
                </div>
              </dl>
            )}
          </article>

          <article className="ts-model-card">
            <h3 className="ts-model-title">Contextual residual network</h3>
            <p className="ts-model-body">
              A small feed-forward network learns expected energy from load, water temperatures, ambient conditions and
              recent dynamics. The residual (actual minus expected) is the contextual anomaly signal: high energy is
              only anomalous when the context does not explain it.
            </p>
            {result && (
              <dl className="ts-model-stats mono">
                <div>
                  <dt>Hidden units</dt>
                  <dd>{result.model.residualModel.hiddenUnits}</dd>
                </div>
                <div>
                  <dt>Features</dt>
                  <dd>{result.model.residualModel.features}</dd>
                </div>
                <div>
                  <dt>Epochs</dt>
                  <dd>{result.model.residualModel.epochs}</dd>
                </div>
              </dl>
            )}
          </article>
        </div>

        {result && (
          <div className="ts-fusion">
            <span className="ts-fusion-label mono">fusion</span>
            <span className="mono">
              score = {fmtSig(result.model.fusion.ifWeight, 2)} × isolation + {fmtSig(result.model.fusion.residualWeight, 2)} ×
              residual, threshold at the {fmtSig(result.model.fusion.thresholdQuantile * 100, 1)}th percentile, runs joined
              within {result.model.fusion.joinWindow} intervals
            </span>
            <span className="ts-fusion-timing mono">runtime {fmtSig(result.model.runtimeMs / 1000, 1)} s</span>
          </div>
        )}
      </section>

      <section className="ts-panel">
        <h2 className="ts-section-title">Honest scope</h2>
        <ul className="ts-scope-list">
          <li>
            The development dataset has no fault labels, so the system is explicitly <em>unsupervised</em>: it flags
            deviations from learned normal behaviour. It names the evidence and the likely pattern class; it does not
            claim a specific physical fault unless the data pattern supports one.
          </li>
          <li>
            Detected episodes (like every mechanism here) are per equipment unit, so behavioural differences between
            units are respected instead of being misread as anomalies.
          </li>
          <li>
            Gaps are treated as missing context, not as faults, per the data specification. The model never sees future
            observations when scoring a point (trailing windows only).
          </li>
        </ul>
      </section>
    </main>
  );
}