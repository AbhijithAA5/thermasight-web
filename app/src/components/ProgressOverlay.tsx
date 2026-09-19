// ThermaSight — analysis progress overlay.
import { useApp } from "../lib/store";

export function ProgressOverlay() {
  const { state } = useApp();
  if (!state.running) return null;
  const p = state.progress ?? { stage: "Starting", fraction: 0 };
  const pct = Math.round(p.fraction * 100);
  return (
    <div className="ts-progress-layer" role="status" aria-live="polite">
      <div className="ts-progress-card">
        <p className="ts-progress-stage mono">{p.stage}</p>
        {p.detail && <p className="ts-progress-detail mono">{p.detail}</p>}
        <div className="ts-progress-track" aria-hidden>
          <div className="ts-progress-fill" style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
        <p className="ts-progress-pct mono">{pct}%</p>
      </div>
    </div>
  );
}