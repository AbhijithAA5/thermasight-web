# ThermaSight — Intelligent Energy & Equipment Monitoring

Submission for **YUKTHI 2026** (National-Level Hackathon), challenge track
*Intelligent Energy & Equipment Monitoring*.

A full-stack, machine-learning-driven application that learns normal chiller
behaviour from historical telemetry, detects meaningful contextual
abnormalities, and turns them into evidence-backed, actionable insights.

Live: https://thermasight.higgsfield.app · Stack: React 19 +
TanStack Start, TypeScript, Tailwind v4, pure client-side ML (no external
model services, no data leaves the browser).

---

## 1. The problem, framed

A chiller's energy consumption is not constant. It responds to building load,
water temperatures, ambient conditions, hour of day, and the interactions
between them. A simple threshold on energy therefore triggers constantly
during peak season and misses real faults during light loads. The core
requirement is **contextual anomaly detection**: a deviation is only an
anomaly if it is unusual *given the operating context*.

The development dataset ships with **no fault labels**, so the system is
explicitly unsupervised. It learns each unit's own normal behaviour and
reports deviations with evidence, severity and recommended investigation
steps. Nothing is hard-coded about rows, timestamps or units: any CSV that
conforms to the Data Specification is accepted as-is.

## 2. Data-to-insight pipeline

`Operational data → ingestion → quality → features → ML → fusion → episodes →
interpretation → recommendations`

| Stage | What happens |
|---|---|
| **Ingest** | Contract-driven CSV parser. Columns located by normalized name; records keyed by `(equipment_id, timestamp)`; each unit becomes its own chronological series; duplicate pairs counted, not silently dropped. |
| **Quality** | Missing values per column, irregular gaps (never treated as faults per spec), period and cadence statistics, all surfaced in the Data view. |
| **Features** | Missing values linearly interpolated across short gaps and carried forward across long ones. Time-of-day / day-of-week / day-of-year encoded as cycles. 24-hour trailing rolling mean and standard deviation of energy and load, plus lags. All features are **strictly trailing** (no future leakage). Robust z-scoring (median/MAD) per unit. |
| **Learn** | Two models per unit: (1) an **Isolation Forest** over the standardized feature set that isolates structurally unusual multi-variable rows; (2) a small feed-forward **residual network** (1 hidden layer, 24 units, momentum SGD with gradient clipping and early stopping) that predicts expected energy from operating context (load, water temperatures, ambient, dynamics). |
| **Detect (fusion)** | Residuals are bias-corrected (hour-of-day median, then expected-value bins) and robust-scaled. Isolation score and residual score are weighted (0.25 / 0.75), thresholded at the unit's own 97.5th percentile (floor 0.56), and passed through persistence logic: isolated blips stay low, sustained runs are boosted, runs within 12 intervals are joined. |
| **Interpret** | Each episode gets: contributing measurements (deviation vs the unit's own 12-hour trailing baseline, in σ), a pattern classification (energy-at-steady-load, condenser drift, flow imbalance, frozen sensor, transient, trend degradation, off-hours draw, mode shift), a plain-language narrative with concrete numbers, and evidence-based recommendations. |
| **Assess** | Per-unit health 0–100 from recent exposure + degradation trend (rank correlation of residuals over the last 90 days), severity tiers Watch / Alert / Action, and a fleet priority queue. |

## 3. Why this ML design

- **Unsupervised by necessity**: no labels exist in the development set; the
  system must *learn expected behaviour* and flag deviations. Both models
  reconstruct expectations rather than memorizing thresholds.
- **Contextual, not absolute**: the residual model answers
  "is this energy level normal *for these conditions*", so high demand peaks
  are not flagged, while energy rises at constant load are.
- **Ensemble diversity**: the forest sees interaction structure; the network
  sees context-conditioned expectations; the fusion reduces false alarms
  from either alone.
- **Honest severity**: thresholds are calibrated per unit from its own score
  distribution; persistence logic encodes the operational principle that a
  measurement unusual in isolation may be normal, while sustained deviation
  requires attention.

## 4. Determinism and reproducibility

- Seeded RNG (mulberry32) for model initialization, sampling and splits.
- The same CSV produces the same analysis run-to-run.
- Full model metadata (trees, features, fusion weights, runtime) shown in the
  Method view.

## 5. The demonstration dataset

The app ships with a **synthetic demo dataset** (~28,600 rows) generated to
match the Data Specification: identical columns, units, 30-minute cadence,
missing values at specification-like rates, and occasional gaps. It embeds
five realistic fault scenarios so the end-to-end workflow can be demonstrated
and verified:

| Unit | Scenario | Detected as |
|---|---|---|
| CHILLER-01 | 12-hour transient energy spike | Action |
| CHILLER-01 | 3.5-day condenser-side fault (energy +22%, cooling-water temperature +4.5 °C, flow +8%) | Alert/Action |
| CHILLER-02 | Progressive efficiency degradation over ~3 months (+17% energy at constant load) | Alert chain with rising severity, health drop |
| CHILLER-03 | 24-hour chilled-water flow imbalance (−40% flow, lift penalty) | Alert |
| CHILLER-03 | 12-hour frozen flow sensor (constant channel, control response) | Alert, tagged frozen-sensor |

The demo is clearly labelled in the UI. Upload the real participant CSV to
the Data view and the identical pipeline runs on it.

## 6. Running it — fully standalone, no platform services

The project is 100% self-contained: the ML model is trained in the browser,
the server is a plain Node.js process, and every dependency comes from public
npm. No Higgsfield account, no API keys, no remote services. The uploaded CSV
never leaves the machine.

**Quick start (any OS):**

- macOS / Linux: `./run.sh` (or `sh run.sh`)
- Windows: double-click `run.bat` (or run `npm install && npm run build && npm run start`)
- Manual: `bun install` (or `npm install`), then `bun run build`, then `bun run start`

The app is served at `http://localhost:3000` (`PORT=8080 ./run.sh` for a
custom port). Requirements: **Node.js 20+** or **Bun**; internet access is
needed once, for the initial dependency install. Offline afterwards.

Other commands:

- `bun run typecheck` — static check.
- `bun run smoke.ts` — executes the full pipeline on the demo dataset and
  verifies the injected scenarios are detected (useful for judging).
- `bun run dev` — Vite dev server with hot reload. Note: in this scaffold the
  framework's dev-mode SSR middleware does not mount route handlers outside
  its own build pipeline, so the dev server serves assets but not the SSR
  routes; use the production server above for a faithful run.
- The production bundle is also deployable to any host that runs Node or a
  Cloudflare Worker (the server entry exposes the standard `fetch` handler).

## 7. Honest scope and limitations

- Without fault labels, detections are *deviations from learned normal*, not
  confirmed faults; the interpretation layer names the evidence and the
  pattern class, and recommends investigation rather than asserting a
  specific physical failure.
- Slow degradation can be partially absorbed by the learned baseline
  (a known, documented property of unsupervised reconstruction); the trend
  component and rolling health score mitigate this.
- Very short unit histories (a few days) weaken both models; the pipeline
  excludes a warm-up window and reports accordingly.
- Timezone: timestamps are interpreted as written (UTC frame), stated in the
  chart header so diurnal analysis is not silently shifted.

## 8. Technology choices

TypeScript + React 19 + TanStack Start (server-rendered; the production
bundle runs as a plain Node process or a Cloudflare Worker): batteries-included
routing/SSR and no ML runtime dependency. The ML is implemented from scratch
in pure TypeScript (~600 lines) — auditable, deterministic, and deployable
anywhere without a model server. SVG-based custom data visualizations keep the
bundle small and the interactions crisp.