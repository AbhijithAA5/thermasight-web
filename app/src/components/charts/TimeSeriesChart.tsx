// ThermaSight — the main instrument: a time-series chart with anomaly bands,
// a hover crosshair, and a time-range brush. Pure SVG, SSR-safe (no window at
// render; the component is mounted client-side with data).

import { useCallback, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { clamp, type Severity } from "../../lib/pipeline/types";
import { fmtAxis, fmtTime, severityLabel } from "../../lib/format";

export interface Band {
  id: string;
  startIndex: number;
  endIndex: number;
  severity: Severity;
}

interface Props {
  times: number[];
  values: number[];
  severity: Severity[];
  bands: Band[];
  range: [number, number] | null;
  onRangeChange: (r: [number, number] | null) => void;
  onOpenBand: (id: string) => void;
  unit: string;
  label: string;
}

const W = 920;
const H = 300;
const PAD = { t: 14, r: 14, b: 26, l: 46 };
const INNER_W = W - PAD.l - PAD.r;
const INNER_H = H - PAD.t - PAD.b;

const SEV_OPACITY: Record<Severity, number> = { normal: 0, watch: 0.07, alert: 0.12, action: 0.2 };
const SEV_COLOR: Record<Severity, string> = {
  normal: "transparent",
  watch: "var(--ts-warn)",
  alert: "var(--ts-alert)",
  action: "var(--ts-danger)",
};

function niceTicks(lo: number, hi: number, max: number): number[] {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [lo];
  const rawStep = span / max;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(v);
  return out;
}

/** Smooth bucket sampling: ONE line point (mean) per column + min/max envelope.
 *  Two points per column (min+max) created the zigzag/noise look. */
function sampleBand(times: number[], values: number[], px: number): { idx: number[]; v: number[]; loV: number[]; hiV: number[] } {
  const n = times.length;
  const idx: number[] = [];
  const v: number[] = [];
  const loV: number[] = [];
  const hiV: number[] = [];
  if (!n) return { idx, v, loV, hiV };
  if (n <= px * 2) {
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(values[i])) {
        idx.push(i);
        v.push(values[i]);
        loV.push(values[i]);
        hiV.push(values[i]);
      }
    }
    return { idx, v, loV, hiV };
  }
  const stride = Math.ceil(n / px);
  for (let k = 0; k < n; k += stride) {
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    let cnt = 0;
    for (let i = k; i < Math.min(n, k + stride); i++) {
      const x = values[i];
      if (!Number.isFinite(x)) continue;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
      sum += x;
      cnt++;
    }
    if (cnt > 0) {
      idx.push(k);
      v.push(sum / cnt);
      loV.push(lo);
      hiV.push(hi);
    }
  }
  return { idx, v, loV, hiV };
}

export function TimeSeriesChart({ times, values, severity, bands, range, onRangeChange, onOpenBand, unit, label }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ mode: "pan" | "left" | "right" | null; x0: number; r0: [number, number] }>({ mode: null, x0: 0, r0: [0, 0] });

  const domain: [number, number] = range ?? [times[0] ?? 0, times[times.length - 1] ?? 0];
  const x = useCallback(
    (ms: number) => PAD.l + ((ms - domain[0]) / (domain[1] - domain[0] || 1)) * INNER_W,
    [domain],
  );

  const visible = useMemo(() => {
    const out: { idx: number[]; v: number[]; loV: number[]; hiV: number[] }[] = [];
    // Bucket per ~1px across a virtual 2x width for crisper rendering.
    const sampled = sampleBand(times, values, 1200);
    const idx: number[] = [];
    const v: number[] = [];
    const loV: number[] = [];
    const hiV: number[] = [];
    for (let k = 0; k < sampled.idx.length; k++) {
      const i = sampled.idx[k];
      if (times[i] >= domain[0] && times[i] <= domain[1]) {
        idx.push(i);
        v.push(sampled.v[k]);
        loV.push(sampled.loV[k]);
        hiV.push(sampled.hiV[k]);
      }
    }
    out.push({ idx, v, loV, hiV });
    return out;
  }, [times, values, domain]);

  let lo = Infinity;
  let hi = -Infinity;
  for (const seg of visible) {
    for (const val of seg.loV) if (val < lo) lo = val;
    for (const val of seg.hiV) if (val > hi) hi = val;
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  const padY = (hi - lo || 1) * 0.08;
  const yLo = lo - padY;
  const yHi = hi + padY;
  const y = (val: number) => PAD.t + (1 - (val - yLo) / (yHi - yLo || 1)) * INNER_H;

  const visibleBands = bands.filter(
    (b) => times[b.startIndex] <= domain[1] && times[b.endIndex] >= domain[0],
  );

  const linePath = visible
    .map((seg) =>
      seg.idx.map((i, k) => `${k ? "L" : "M"}${x(times[i]).toFixed(1)},${y(seg.v[k]).toFixed(1)}`).join(""),
    )
    .filter(Boolean)
    .join("");

  const bandPath = visible
    .map((seg) => {
      const fwd = seg.idx
        .map((i, k) => `${k ? "L" : "M"}${x(times[i]).toFixed(1)},${y(seg.loV[k]).toFixed(1)}`)
        .join("");
      const rev = [...seg.idx]
        .reverse()
        .map((i, k) => {
          const j = seg.idx.length - 1 - k;
          return `L${x(times[i]).toFixed(1)},${y(seg.hiV[j]).toFixed(1)}`;
        })
        .join("");
      return fwd + " " + rev + " Z";
    })
    .filter(Boolean)
    .join(" ");

  const areaPath =
    linePath && `${linePath} L${x(times[visible[0].idx[visible[0].idx.length - 1]])},${PAD.t + INNER_H} L${x(times[visible[0].idx[0]])},${PAD.t + INNER_H} Z`;

  const yTicks = niceTicks(yLo, yHi, 4);
  const xTicks = niceTicks(domain[0], domain[1], 6).filter((v) => v >= domain[0] && v <= domain[1]);

  // ---- Brush handlers (pointer capture on the brush svg) ----
  const fullDomain: [number, number] = [times[0] ?? 0, times[times.length - 1] ?? 0];
  const brushRef = useRef<SVGSVGElement>(null);
  const toX = (ev: RPointerEvent) => {
    const rect = brushRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return clamp(((ev.clientX - rect.left) / rect.width) * W, 0, W);
  };

  const onBrushDown = (ev: RPointerEvent, mode: "pan" | "left" | "right") => {
    if (mode === "pan" && !range) return;
    drag.current = { mode, x0: toX(ev), r0: range ?? [fullDomain[0], fullDomain[1]] };
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  };
  const onBrushMove = (ev: RPointerEvent) => {
    const d = drag.current;
    if (!d.mode) return;
    const dx = toX(ev) - d.x0;
    const msPerPx = (fullDomain[1] - fullDomain[0]) / INNER_W;
    const deltaMs = dx * msPerPx;
    const [full0, full1] = fullDomain;
    if (d.mode === "pan") {
      const span = d.r0[1] - d.r0[0];
      let n0 = d.r0[0] - deltaMs;
      n0 = clamp(n0, full0, Math.max(full0, full1 - span));
      onRangeChange([n0, n0 + span]);
    } else {
      const span = d.r0[1] - d.r0[0];
      const minSpan = Math.min(span * 0.1, 24 * 3600000);
      if (d.mode === "left") {
        const n0 = clamp(d.r0[0] + deltaMs, full0, d.r0[1] - minSpan);
        onRangeChange([n0, d.r0[1]]);
      } else {
        const n1 = clamp(d.r0[1] + deltaMs, d.r0[0] + minSpan, full1);
        onRangeChange([d.r0[0], n1]);
      }
    }
  };
  const onBrushUp = () => {
    drag.current.mode = null;
  };

  // Hover crosshair.
  const onChartMove = (ev: RPointerEvent) => {
    const rect = (ev.currentTarget as Element).getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    const ms = domain[0] + ((px - PAD.l) / INNER_W) * (domain[1] - domain[0]);
    // binary search nearest index
    let a = 0;
    let b = times.length - 1;
    while (a < b - 1) {
      const m = (a + b) >> 1;
      if (times[m] < ms) a = m;
      else b = m;
    }
    const i = Math.abs(times[a] - ms) < Math.abs(times[b] - ms) ? a : b;
    if (times[i] >= domain[0] && times[i] <= domain[1]) setHover(i);
  };

  const hoverBand = hover !== null ? bands.find((b) => hover >= b.startIndex && hover <= b.endIndex) : null;
  const hoverX = hover !== null ? x(times[hover]) : 0;
  const hoverY = hover !== null ? y(values[hover]) : 0;

  const brushX0 = PAD.l + (((range ? range[0] : fullDomain[0]) - fullDomain[0]) / (fullDomain[1] - fullDomain[0] || 1)) * INNER_W;
  const brushX1 = PAD.l + (((range ? range[1] : fullDomain[1]) - fullDomain[0]) / (fullDomain[1] - fullDomain[0] || 1)) * INNER_W;

  return (
    <div className="ts-chart-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        style={{ height: "auto" }}
        onPointerMove={onChartMove}
        onPointerLeave={() => setHover(null)}
        aria-label={`${label} time series with anomaly bands`}
        role="img"
      >
        {/* grid */}
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--ts-grid)" strokeWidth="1" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="ts-axis-label">
              {Math.abs(v) >= 1000 ? v.toExponential(1) : v.toLocaleString("en-US", { maximumFractionDigits: 1 })}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <g key={`x${v}`}>
            <line x1={x(v)} x2={x(v)} y1={PAD.t} y2={PAD.t + INNER_H} stroke="var(--ts-grid)" strokeWidth="1" />
            <text x={x(v)} y={H - 8} textAnchor="middle" className="ts-axis-label">
              {fmtAxis(v)}
            </text>
          </g>
        ))}

        {/* anomaly bands */}
        {visibleBands.map((b) => {
          const x0 = x(times[b.startIndex]);
          const x1 = x(times[b.endIndex]);
          const w = Math.max(2, x1 - x0);
          return (
            <g key={b.id} className="ts-band" onClick={() => onOpenBand(b.id)} style={{ cursor: "pointer" }}>
              <rect x={x0} y={PAD.t} width={w} height={INNER_H} fill={SEV_COLOR[b.severity]} opacity={SEV_OPACITY[b.severity]} />
              <line x1={x0} x2={x1} y1={PAD.t + 3} y2={PAD.t + 3} stroke={SEV_COLOR[b.severity]} strokeWidth="2" opacity="0.9" />
            </g>
          );
        })}

        {/* series: min/max envelope behind a calm mean line */}
        {bandPath && <path d={bandPath} fill="var(--ts-accent)" fillOpacity="0.06" stroke="none" />}
        <path d={areaPath} fill="var(--ts-accent-soft)" />
        <path d={linePath} fill="none" stroke="var(--ts-accent)" strokeWidth="1.6" />

        {/* flagged point dots */}
        {hover === null &&
          visibleBands.length < 40 &&
          bands.map((b) => {
            const mid = Math.round((b.startIndex + b.endIndex) / 2);
            const ms = times[mid];
            if (ms < domain[0] || ms > domain[1]) return null;
            const vv = Number.isFinite(values[mid]) ? values[mid] : lo;
            return <circle key={`d${b.id}`} cx={x(ms)} cy={y(vv)} r="2.6" fill={SEV_COLOR[b.severity]} opacity="0.95" />;
          })}

        {/* crosshair */}
        {hover !== null && Number.isFinite(hoverY) && (
          <g pointerEvents="none">
            <line x1={hoverX} x2={hoverX} y1={PAD.t} y2={PAD.t + INNER_H} stroke="var(--ts-text-dim)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={hoverX} cy={hoverY} r="3.4" fill="var(--ts-accent)" stroke="var(--ts-bg)" strokeWidth="1.5" />
            <g transform={`translate(${Math.min(Math.max(hoverX - 90, PAD.l), W - PAD.r - 128)}, ${PAD.t + 4})`}>
              <rect width="128" height="54" rx="6" fill="var(--ts-panel2)" stroke="var(--ts-hair)" strokeWidth="1" />
              <text x="10" y="18" className="ts-tooltip-main">
                {fmtTime(times[hover])}
              </text>
              <text x="10" y="36" className="ts-tooltip-sub">
                {Number.isFinite(values[hover]) ? values[hover].toLocaleString("en-US", { maximumFractionDigits: 2 }) : "-"} {unit}
              </text>
              {hoverBand && (
                <text x="10" y="50" className="ts-tooltip-sub" fill={SEV_COLOR[hoverBand.severity]}>
                  {severityLabel(hoverBand.severity)} anomaly
                </text>
              )}
            </g>
          </g>
        )}
      </svg>

      {/* brush */}
      <svg
        ref={brushRef}
        viewBox={`0 0 ${W} 34`}
        className="block w-full"
        style={{ height: 34, touchAction: "none" }}
        onPointerMove={onBrushMove}
        onPointerUp={onBrushUp}
        onPointerLeave={onBrushUp}
      >
        <rect x={PAD.l} y="6" width={INNER_W} height="22" rx="4" fill="var(--ts-panel2)" stroke="var(--ts-hair)" />
        <rect x={brushX0} y="6" width={Math.max(8, brushX1 - brushX0)} height="22" rx="4" fill="var(--ts-accent-soft2)" stroke="var(--ts-accent)" strokeWidth="1" style={{ cursor: range ? "grab" : "default" }} onPointerDown={(e) => onBrushDown(e, "pan")} />
        <rect x={brushX0 - 4} y="6" width="8" height="22" rx="3" fill="var(--ts-accent)" style={{ cursor: "ew-resize" }} onPointerDown={(e) => onBrushDown(e, "left")} />
        <rect x={brushX1 - 4} y="6" width="8" height="22" rx="3" fill="var(--ts-accent)" style={{ cursor: "ew-resize" }} onPointerDown={(e) => onBrushDown(e, "right")} />
        {!range && (
          <text x={W / 2} y="21" textAnchor="middle" className="ts-axis-label">
            drag to zoom
          </text>
        )}
      </svg>
    </div>
  );
}