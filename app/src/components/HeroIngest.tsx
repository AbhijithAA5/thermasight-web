// ThermaSight — landing screen (shown until a dataset is analysed).
import { useApp } from "../lib/store";
import { IconCheck, IconFolder, IconInfo, IconWarning } from "../lib/icons";

export function HeroIngest() {
  const { setTab } = useApp();

  return (
    <main className="ts-hero">
      <div className="ts-container">
        <div className="max-w-[46rem] mx-auto text-center">
          <p className="ts-kicker">YUKTHI 2026 · intelligent energy and equipment monitoring</p>
          <h1 className="ts-hero-title">See what your chillers are really doing.</h1>
          <p className="ts-hero-sub">
            Unsupervised ML learns each unit&apos;s normal behaviour from its own history, then flags the deviations
            that matter, with the evidence and the next step.
          </p>
          <div className="ts-hero-cta justify-center">
            <button className="ts-btn ts-btn-primary" onClick={() => setTab("data")}>
              <IconFolder className="h-4 w-4" />
              Upload CSV
            </button>
          </div>
          <p className="ts-hero-note">
            Upload a CSV that follows the YUKTHI 2026 data specification, or open the Data tab to run the bundled
            25,003-row development dataset.
          </p>
        </div>

        <section className="ts-how">
          <div className="ts-how-item">
            <IconInfo className="h-4 w-4 ts-how-icon" />
            <h3 className="ts-how-title">Learn</h3>
            <p className="ts-how-body">
              Two models per unit: an isolation forest over all measurements, and a network that predicts expected
              energy from load, water temperatures and ambient conditions.
            </p>
          </div>
          <div className="ts-how-item ts-how-item-tint">
            <IconWarning className="h-4 w-4 ts-how-icon" />
            <h3 className="ts-how-title">Detect</h3>
            <p className="ts-how-body">
              Scores are fused with persistence logic: an isolated blip is noted, a sustained deviation is escalated.
            </p>
          </div>
          <div className="ts-how-item">
            <IconCheck className="h-4 w-4 ts-how-icon" />
            <h3 className="ts-how-title">Act</h3>
            <p className="ts-how-body">
              Each anomaly carries its contributing measurements, a plain-language narrative and evidence-based
              recommendations for investigation.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}