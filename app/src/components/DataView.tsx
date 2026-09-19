// ThermaSight — data source: upload any contract-conforming CSV or load the
// synthetic demo; shows the quality report of the current dataset.
import { useRef, useState } from "react";
import { useApp } from "../lib/store";
import { COLUMN_UNITS, NUMERIC_COLS, type NumericCol } from "../lib/pipeline/types";
import { fmtDurationHours, fmtShort, fmtSig } from "../lib/format";
import { IconCancel, IconCheckCircle, IconFolder, IconWarning } from "../lib/icons";

export function DataView() {
  const { state, runFile, loadDemo, loadReal, clear, setTab } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const result = state.result;
  const q = result?.quality;

  const onFile = async (f: File | undefined | null) => {
    if (!f || busy) return;
    setBusy(true);
    try {
      await runFile(f);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="ts-container ts-page">
      <h2 className="ts-section-title">Data source</h2>

      <section className="ts-panel ts-dropzone-wrap">
        <div
          className={`ts-dropzone ${dragOver ? "ts-dropzone-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void onFile(e.dataTransfer.files?.[0]);
          }}
        >
          <IconFolder className="h-8 w-8 ts-dropzone-icon" />
          <p className="ts-dropzone-title mono">drop a CSV, or click to browse</p>
          <p className="ts-dropzone-body">
            The parser reads columns by name: timestamp, equipment_id, then the nine measurements from the YUKTHI 2026
            data specification. Blank cells become missing values.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button className="ts-btn ts-btn-primary" onClick={() => inputRef.current?.click()} disabled={busy || state.running}>
            {busy || state.running ? "Analysing" : "Upload CSV"}
          </button>
        </div>

        <div className="ts-dropzone-alt">
          <span className="ts-dropzone-body">No file handy?</span>
          <button className="ts-link" onClick={loadReal} disabled={state.running}>
            Analyse the bundled YUKTHI development dataset (25,003 rows)
          </button>
          <button className="ts-link" onClick={loadDemo} disabled={state.running}>
            Analyse the built-in demo dataset
          </button>
        </div>
      </section>

      {state.error && (
        <div className="ts-alert" role="alert">
          <IconWarning className="h-4 w-4" />
          <p>{state.error}</p>
        </div>
      )}

      {q && result && (
        <section className="ts-panel">
          <div className="flex items-center justify-between gap-4">
            <h2 className="ts-section-title">Quality report</h2>
            <button className="ts-link dim" onClick={clear}>
              clear dataset
            </button>
          </div>

          <dl className="ts-q-grid mono">
            <div>
              <dt>File</dt>
              <dd>{q.fileName}</dd>
            </div>
            {q.missingColumns && q.missingColumns.length > 0 && (
              <div>
                <dt>Absent columns</dt>
                <dd className="ts-tx-warn">{q.missingColumns.join(", ")}</dd>
              </div>
            )}
            <div>
              <dt>Observations</dt>
              <dd>{q.rowCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Units</dt>
              <dd>{q.equipmentIds.join(", ")}</dd>
            </div>
            <div>
              <dt>Period</dt>
              <dd>
                {fmtShort(q.periodStart)} to {fmtShort(q.periodEnd)}
              </dd>
            </div>
            <div>
              <dt>Duplicate pairs</dt>
              <dd>{q.duplicatePairs}</dd>
            </div>
            <div>
              <dt>Gaps</dt>
              <dd>
                {q.gapCount} (longest {fmtDurationHours(q.maxGapHours)})
              </dd>
            </div>
          </dl>

          <h3 className="ts-q-sub">Missing values by column</h3>
          <div className="ts-q-missing">
            {NUMERIC_COLS.map((c) => {
              const n = q.missingByColumn[c as NumericCol] ?? 0;
              return (
                <div key={c} className="ts-q-missing-row">
                  <span>{c}</span>
                  <span className={`mono ${n > 0 ? "ts-tx-warn" : "ts-tx-ok"}`}>
                    {n > 0 ? `${n} (${((n / q.rowCount) * 100).toFixed(3)}%)` : "0"}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="ts-q-foot mono">
            {q.duplicatePairs === 0 ? (
              <span className="ts-tx-ok">
                <IconCheckCircle className="h-3.5 w-3.5" /> record identity clean
              </span>
            ) : (
              <span className="ts-tx-warn">
                <IconWarning className="h-3.5 w-3.5" /> duplicate pairs found, first occurrence kept
              </span>
            )}
            {q.badRows > 0 && (
              <span className="ts-tx-warn">
                <IconCancel className="h-3.5 w-3.5" /> {q.badRows} rows skipped (invalid timestamp or unit)
              </span>
            )}
            <span>nominal interval {result.nominalIntervalMinutes} min</span>
          </div>

          {q.fileName === "yukthi-demo-chillers.csv" && (
            <p className="ts-demo-note">
              This is the synthetic demo dataset, generated to match the specification (same columns, units, cadence and
              missing-value rates) with known fault scenarios embedded. The participant CSV from the hackathon can be
              uploaded in its place; the pipeline does not change.
            </p>
          )}

          <button className="ts-link dim" onClick={() => setTab("explorer")}>
            open the explorer with this dataset <span aria-hidden>→</span>
          </button>
        </section>
      )}
      <p className="ts-utc-note mono" style={{ marginTop: "1rem" }}>
        all timestamps rendered in the UTC frame of the pipeline
      </p>
    </main>
  );
}