// ThermaSight — tiny SVG chart primitives: sparkline + health gauge.

import { useId, useMemo } from "react";
import { clamp } from "../../lib/pipeline/types";
import { fmtSig } from "../../lib/format";

interface SparklineProps {
  times: number[];
  values: number[];
  flagged?: boolean[];
  width?: number;
  height?: number;
  color?: string;
  flagColor?: string;
}

/** Smooth downsampling: ONE point per ~pixel column (bucket mean), plus a
 *  min/max envelope. Plotting min AND max as separate line points is what
 *  made every sparkline a wall of vertical spikes with diagonal bridges —
 *  the mean line reads as a calm signal, the envelope keeps the true range. */
function sample(times: number[], values: number[], width: number): { t: number[]; v: number[]; lo: number[]; hi: number[] } {
  const n = times.length;
  const t: number[] = [];
  const v: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  if (!n) return { t, v, lo, hi };
  if (n <= width * 2) {
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(values[i])) {
        t.push(times[i]);
        v.push(values[i]);
        lo.push(values[i]);
        hi.push(values[i]);
      }
    }
    return { t, v, lo, hi };
  }
  const stride = Math.ceil(n / width);
  let prevMean: number | null = null;
  for (let k = 0; k < n; k += stride) {
    let loV = Infinity;
    let hiV = -Infinity;
    let sum = 0;
    let cnt = 0;
    for (let i = k; i < Math.min(n, k + stride); i++) {
      const x = values[i];
      if (!Number.isFinite(x)) continue;
      if (x < loV) loV = x;
      if (x > hiV) hiV = x;
      sum += x;
      cnt++;
    }
    if (cnt > 0) {
      let mean = sum / cnt;
      if (prevMean !== null) mean = (prevMean + mean * 2) / 3; // 1-2-1 soften
      prevMean = mean;
      t.push(times[k]);
      v.push(mean);
      lo.push(loV);
      hi.push(hiV);
    }
  }
  return { t, v, lo, hi };
}

export function Sparkline({ times, values, flagged, width = 260, height = 48, color = "var(--ts-accent)", flagColor = "var(--ts-danger)" }: SparklineProps) {
  const gid = useId();
  const { t, v, lo, hi } = useMemo(() => sample(times, values, width), [times, values, width]);
  if (!t.length) {
    return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="block" />;
  }
  const loAll = Math.min(...lo);
  const hiAll = Math.max(...hi);
  const span = hiAll - loAll || 1;
  const x = (ms: number) => ((ms - t[0]) / (t[t.length - 1] - t[0] || 1)) * (width - 2) + 1;
  const y = (val: number) => 2 + (1 - (val - loAll) / span) * (height - 4);
  const linePath = t.map((tm, i) => `${i ? "L" : "M"}${x(tm).toFixed(1)},${y(v[i]).toFixed(1)}`).join("");
  const bandPath =
    t.map((tm, i) => `${i ? "L" : "M"}${x(tm).toFixed(1)},${y(lo[i]).toFixed(1)}`).join("") +
    " " +
    [...t]
      .reverse()
      .map((tm, i) => {
        const j = t.length - 1 - i;
        return `L${x(tm).toFixed(1)},${y(hi[j]).toFixed(1)}`;
      })
      .join("") +
    " Z";
  const flags = flagged
    ? flagged
        .map((f, i) => (f ? `${x(times[i]).toFixed(1)},${(height - 4).toFixed(1)}` : null))
        .filter(Boolean)
        .join(" ")
    : "";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden className="block">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.20" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={bandPath} fill={color} fillOpacity="0.08" stroke="none" />
      <path d={`${linePath} L${x(t[t.length - 1])},${height} L${x(t[0])},${height} Z`} fill={`url(#${gid})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
      {flags && <polygon points={flags} fill={flagColor} opacity="0.9" />}
    </svg>
  );
}

interface GaugeProps {
  value: number | null; // 0..100; null = unit not modelled (insufficient data)
  size?: number;
  label?: string;
}

export function Gauge({ value, size = 92, label = "health" }: GaugeProps) {
  if (value == null) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${label}: n/a`} role="img">
        <text x={size / 2} y={size / 2} textAnchor="middle" className="ts-gauge-num" fill="var(--ts-text-dim)">
          —&nbsp;n/a
        </text>
      </svg>
    );
  }
  const v = clamp(Math.round(value), 0, 100);
  const stroke = 8;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const start = Math.PI * 0.75; // 135deg, opens upward
  const sweep = Math.PI * 1.5;
  const arc = (frac: number) => {
    const a = start + sweep * clamp(frac, 0, 1);
    const x0 = cx + r * Math.cos(start);
    const y0 = cy + r * Math.sin(start);
    const x1 = cx + r * Math.cos(a);
    const y1 = cy + r * Math.sin(a);
    const large = a - start > Math.PI ? 1 : 0;
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };
  const color = v >= 75 ? "var(--ts-ok)" : v >= 55 ? "var(--ts-warn)" : "var(--ts-danger)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${label}: ${v}/100`} role="img">
      <path d={arc(1)} fill="none" stroke="var(--ts-hair)" strokeWidth={stroke} strokeLinecap="round" />
      <path d={arc(v / 100)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" style={{ transition: "stroke-dasharray 0.6s" }} />
      <text x={cx} y={cy - 2} textAnchor="middle" className="ts-gauge-num" fill="var(--ts-text)">
        {v}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" className="ts-gauge-cap" fill="var(--ts-text-dim)">
        {label}
      </text>
    </svg>
  );
}

export function fmtPercent(v: number): string {
  return `${fmtSig(v, 0)}%`;
}