// ThermaSight — animated plant schematic (functional diagram, decorative-free
// flow motion gated by prefers-reduced-motion). Lane color/speed reflect the
// unit's current health once a dataset is loaded.

import { useApp } from "../lib/store";
import { fmtSig } from "../lib/format";

export function PlantSchematic() {
  const { state } = useApp();
  const ids = state.result?.quality.equipmentIds ?? ["CHILLER-01", "CHILLER-02", "CHILLER-03"];
  const healthOf = (id: string) =>
    state.result?.equipment[id] ? state.result.equipment[id].health : null;
  const color = (id: string) => {
    const h = healthOf(id);
    return h == null ? "var(--ts-hair)" : h >= 75 ? "var(--ts-ok)" : h >= 55 ? "var(--ts-warn)" : "var(--ts-danger)";
  };
  const flowClass = (id: string) => {
    if (!state.result) return "ts-flow";
    const rep = state.result.equipment[id];
    if (!rep) return "ts-flow";
    const worst = rep.episodes.some((e) => e.severity === "action" || e.severity === "alert");
    return worst ? "ts-flow ts-flow-fast" : rep.health != null && rep.health < 70 ? "ts-flow" : "ts-flow ts-flow-slow";
  };

  const laneY = (i: number) => 64 + i * 64;

  return (
    <div className="ts-schematic" aria-hidden>
      <svg viewBox="0 0 400 236" className="block w-full" style={{ height: "auto" }}>
        <defs>
          <marker id="tsArw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="var(--ts-text-dim)" />
          </marker>
        </defs>

        {ids.slice(0, 3).map((id, i) => {
          const y = laneY(i);
          const c = color(id);
          return (
            <g key={id}>
              <path d={`M92,${y} H 318`} fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" markerEnd="url(#tsArw)" opacity="0.85" />
              <path d={`M92,${y} H 318`} fill="none" stroke={c} strokeWidth="9" strokeLinecap="round" opacity="0.14" />
              <path
                d={`M92,${y} H 318`}
                fill="none"
                stroke={c}
                strokeWidth="2.4"
                strokeDasharray="7 14"
                className={flowClass(id)}
              />
              <rect x="14" y={y - 16} width="72" height="32" rx="6" fill="var(--ts-panel2)" stroke={c} strokeOpacity="0.55" strokeWidth="1" />
              <text x="50" y={y + 4} textAnchor="middle" className="ts-schematic-label" fill="var(--ts-text)">
                {id}
              </text>
              <rect x="322" y={y - 16} width="64" height="32" rx="6" fill="var(--ts-panel2)" stroke="var(--ts-hair)" />
              <text x="354" y={y + 4} textAnchor="middle" className="ts-schematic-label" fill="var(--ts-text-dim)">
                load
              </text>
              {state.result && (
                <text x="205" y={y - 22} textAnchor="middle" className="ts-schematic-sub" fill={c}>
                  health {healthOf(id) == null ? "n/a" : `${fmtSig(healthOf(id) as number, 0)}/100`}
                </text>
              )}
            </g>
          );
        })}

        {/* cooling tower */}
        <g>
          <rect x="352" y="8" width="14" height="30" rx="7" fill="var(--ts-panel2)" stroke="var(--ts-hair)" />
          <ellipse cx="359" cy="6" rx="12" ry="5" fill="var(--ts-panel2)" stroke="var(--ts-hair)" />
          <g className={state.result ? "ts-fan" : ""} style={{ transformOrigin: "359px 6px" }}>
            <path d="M347,6 H351 M359,3 V6 M367,6 H371 M359,9 V6" stroke="var(--ts-accent)" strokeWidth="1.4" strokeLinecap="round" />
          </g>
        </g>
      </svg>
    </div>
  );
}