# ThermaSight — design brief (Phase 0)

- **Design read:** an industrial operations console for facilities engineers reviewing chiller-fleet telemetry; serious, calm, high-information-density, zero decorative fluff.
- **Concept spine:** "the plant as an instrument." Every surface is a live measurement panel; the app reads like the control room of a chiller plant, where cold is the subject.
- **Delivery tier:** editorial (functional monitoring application, non-animated).
- **Animation mode:** non-animated — functional monitoring console (a data dashboard, not a marketing journey).
- **Locked palette:** base `#0A1118` (near-black petrol), panels `#101A24` / `#15222E`, hairlines `#233444`, text `#E8EEF4` / `#9FB0C1` / `#5D7184`. Accent: restrained teal `#38C7B5` (chiller/cooling domain semantics; desaturated, no neon glow). Semantic status colors locked to meaning only: healthy `#4ADE80`, watch `#F5B84B`, alert `#F97362`, action `#E5484D`. Defends against the near-black+neon-cyan default by keeping the accent desaturated, using it sparingly (only interactive + brand edges), and letting mono numerals carry density.
- **Locked type:** system sans (ui-sans-serif stack) for UI, system mono (ui-monospace stack) for every number, timestamp, and metric. Console register: count-up numerals, tabular figures.
- **Section plan:**
  1. Masthead (brand + fleet status strip + view tabs) — top bar, sticky.
  2. Landing/ingest screen (hero: live plant schematic + CTA pair) — shown only before a dataset is loaded; layout: split hero, right = animated chiller loop diagram.
  3. Fleet overview (3 equipment cards with health gauges + KPI columns + sparkline) — asymmetric grid; alert feed rail on the right.
  4. Explorer (variable selector + main time-series chart with anomaly shading + brush) — full-width instrument panel.
  5. Anomaly investigation (drawer: evidence factors, pattern, narrative, recommendations) — right slide-in panel.
  6. Methodology (pipeline diagram: data → features → models → fusion → insights; model cards).
  7. Data source (upload / demo / quality report) — functional form, no marketing chrome.
- **Asset plan:** branded launch cover + OG + icon via the branding pipeline (industrial chiller scene); favicon from the icon job. No photography needs beyond that — the UI itself is the product surface. Custom inline plant-schematic SVG (functional diagram, not decoration).
- **CTA inventory:** "Analyse demo dataset" (primary, mono, teal fill), "Upload CSV" (secondary outline, same shape family), "Investigate" on anomaly rows (row-level link affordance). One corner-radius rule: 10px panels, 6px controls, 999px pills only for status chips.

## Palette defense
Teal-on-petrol is the chiller industry's own visual language and it is executed desaturated and functional (status colors carry meaning; accent is not layered as glow/gradient slop). All numerals are mono; all thresholds are model-returned, never decorative.