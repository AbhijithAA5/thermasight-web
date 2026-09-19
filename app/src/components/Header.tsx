// ThermaSight — masthead: brand, live status strip, view tabs.
import { useApp, type Tab } from "../lib/store";
import { fmtSig } from "../lib/format";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "explorer", label: "Explorer" },
  { id: "anomalies", label: "Anomalies" },
  { id: "methodology", label: "Method" },
  { id: "data", label: "Data" },
];

function Brand() {
  return (
    <span className="ts-brand">
      <svg viewBox="0 0 24 24" className="ts-brand-mark" aria-hidden>
        <path
          d="M12 2.4 L20.6 7.2 V16.8 L12 21.6 L3.4 16.8 V7.2 Z"
          fill="none"
          stroke="var(--ts-accent)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M12 6.8 c -3.1 3.6 -4.6 6.1 -4.6 8.1 a 4.6 4.6 0 0 0 9.2 0 c 0 -2 -1.5 -4.5 -4.6 -8.1 Z" fill="var(--ts-accent)" opacity="0.85" />
      </svg>
      <span className="ts-brand-name">ThermaSight</span>
      <span className="ts-brand-sub">chiller intelligence</span>
    </span>
  );
}

export function Header() {
  const { state, setTab, clear } = useApp();
  const episodes = state.result?.episodes.length ?? 0;
  const units = state.result?.quality.equipmentCount ?? 0;

  return (
    <header className="ts-header">
      <div className="ts-header-inner">
        <button onClick={() => setTab("overview")} aria-label="ThermaSight home" className="ts-header-brand">
          <Brand />
        </button>

        {state.result && (
          <button className="ts-btn ts-btn-ghost ts-btn-home" onClick={clear} aria-label="Back to the start screen">
            ← Home
          </button>
        )}

        <nav className="ts-tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`ts-tab ${state.tab === t.id ? "ts-tab-active" : ""}`}
              onClick={() => setTab(t.id)}
              aria-current={state.tab === t.id ? "page" : undefined}
            >
              {t.label}
              {t.id === "anomalies" && episodes > 0 && <span className="ts-tab-count">{episodes}</span>}
            </button>
          ))}
        </nav>

        <div className="ts-header-status">
          {state.result ? (
            <>
              <span className="ts-status-chip">
                <span className="ts-chip-dot ts-chip-dot-ok" aria-hidden />
                {units} {units === 1 ? "unit" : "units"}
              </span>
              <span className="ts-status-meta mono">{state.sourceLabel}</span>
              <span className="ts-status-meta mono dim">{fmtSig(episodes, 0)} anomalies</span>
            </>
          ) : (
            <span className="ts-status-meta mono dim">no dataset loaded</span>
          )}
        </div>
      </div>
    </header>
  );
}