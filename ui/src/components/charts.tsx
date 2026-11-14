// Charts. Recharts for the verdict / compare / sparkline curves, uPlot only for mouse traces.
import * as React from "react";
import { CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { Lab } from "../lib/types";
import { fmtCm } from "../lib/units";

const C = { line: "#23272D", grid: "#1A1D22", muted: "#9AA3AF", text: "#F2F4F7", good: "#3DDC97", warn: "#FFB020", danger: "#FF5C6C" };
const accent = () => (typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()) || "#7C5CFF";
const MONO = "'JetBrains Mono Variable', Consolas, monospace";
const tick = { fill: C.muted, fontSize: 11, fontFamily: MONO };

export interface CurveSeries { key: string; label: string; color: "accent" | "good" | "warn"; axis: "bal" | "shake" | "score"; dash?: string }
export interface CurveChartProps {
  rows: Record<string, number | null>[];          // each row has cm360 plus one value per series key
  series: CurveSeries[];
  band?: { lo: number; hi: number } | null;       // best zone, shaded
  bandLabel?: string;
  picks?: { cm: number; label: string }[];
  height?: number;
  ariaLabel: string;
}

const fmtBal = (v: number) => (v === 0 ? "even" : `${v > 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}%`);

function EndLabel(props: any) {
  const { x, y, index, last, text, color, dy } = props;
  if (index !== last || x == null || y == null) return null;
  return <text x={x + 10} y={y + (dy ?? 4)} fill={color} fontSize={12} fontWeight={500} fontFamily="'Inter Variable', sans-serif">{text}</text>;
}

function Tip({ active, payload, series }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-sm border border-line bg-s2 px-3 py-2 text-xs shadow-lg shadow-black/40">
      <div className="num mb-1 text-text">{fmtCm(row.cm360)} cm/360</div>
      {(series as CurveSeries[]).map((s) => row[s.key] == null ? null : (
        <div key={s.key} className="flex justify-between gap-4 text-muted">
          <span>{s.label}</span>
          <span className="num text-text">{s.axis === "bal" ? fmtBal(row[s.key]) : s.axis === "score" ? Math.round(row[s.key]).toLocaleString("en-US") : row[s.key].toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

export function CurveChart({ rows, series, band, bandLabel = "best zone", picks = [], height = 300, ariaLabel }: CurveChartProps) {
  const col = (c: CurveSeries["color"]) => (c === "accent" ? accent() : C[c]);
  const cms = rows.map((r) => r.cm360 as number);
  const lo = Math.min(...cms, band?.lo ?? Infinity) * 0.92, hi = Math.max(...cms, band?.hi ?? -Infinity) * 1.08;
  const ticks = [15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150].filter((t) => t > lo && t < hi);
  const balMax = Math.max(0.3, ...rows.flatMap((r) => series.filter((s) => s.axis === "bal").map((s) => Math.abs((r[s.key] as number) ?? 0)))) * 1.25;
  const hasAxis = (a: string) => series.some((s) => s.axis === a);
  // Direct labels sit at each line's last point. Work out where those land and nudge them apart so they never overlap.
  const plotH = height - 28 - 20 - 30;
  const ends = series.map((s) => {
    let last = -1;
    rows.forEach((r, idx) => { if (r[s.key] != null) last = idx; });
    const vals = rows.map((r) => r[s.key]).filter((v): v is number => v != null);
    const [dMin, dMax] = s.axis === "bal" ? [-balMax, balMax]
      : s.axis === "shake" ? [Math.min(...vals) - 0.3, Math.max(...vals) + 0.6] : [Math.min(...vals) - 4000, Math.max(...vals) + 1500];
    const v = last >= 0 ? (rows[last][s.key] as number) : 0;
    return { key: s.key, last, y: ((dMax - v) / (dMax - dMin || 1)) * plotH, dy: 0 };
  });
  [...ends].sort((a, b) => a.y - b.y).reduce((prevY, e) => {
    const y = Math.max(e.y, prevY + 15);
    e.dy = y - e.y;
    return y;
  }, -Infinity);
  const sortedPicks = [...picks].sort((a, b) => a.cm - b.cm);
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 28, right: 96, bottom: 20, left: 4 }}>
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis dataKey="cm360" type="number" scale="log" domain={[lo, hi]} ticks={ticks} tick={tick} tickLine={false} axisLine={{ stroke: C.line }}
            label={{ value: "cm/360  (slower →)", position: "insideBottomRight", offset: -12, fill: C.muted, fontSize: 11, fontFamily: MONO }} />
          <YAxis yAxisId="bal" domain={[-balMax, balMax]} ticks={[-Number((balMax * 0.7).toFixed(1)), 0, Number((balMax * 0.7).toFixed(1))]} tick={tick} tickFormatter={fmtBal}
            tickLine={false} axisLine={false} width={52} />
          {hasAxis("shake") && <YAxis yAxisId="shake" orientation="right" hide domain={["dataMin - 0.3", "dataMax + 0.6"]} />}
          {hasAxis("score") && <YAxis yAxisId="score" orientation="right" hide domain={["dataMin - 4000", "dataMax + 1500"]} />}
          {band && <ReferenceArea yAxisId="bal" x1={band.lo} x2={band.hi} fill={accent()} fillOpacity={0.13} stroke="none"
            label={{ value: bandLabel, position: "insideTopLeft", fill: C.text, fontSize: 12, fontWeight: 500, offset: 10 }} />}
          <ReferenceLine yAxisId="bal" y={0} stroke="#3a414b" strokeDasharray="2 4" />
          {picks.map((p, i) => (
            <ReferenceLine key={i} yAxisId="bal" x={p.cm} stroke={i === 0 ? C.text : C.muted} strokeWidth={1} strokeDasharray={i === 0 ? undefined : "4 3"}
              label={{ value: p.label, position: "top", fill: i === 0 ? C.text : C.muted, fontSize: 11, fontFamily: MONO, dx: picks.length > 1 ? (p === sortedPicks[0] ? -18 : 18) : 0 }} />
          ))}
          <Tooltip content={<Tip series={series} />} cursor={{ stroke: "#3a414b", strokeWidth: 1 }} isAnimationActive={false} />
          {series.map((s, i) => {
            const { last, dy } = ends[i];
            return (
              <Line key={s.key} yAxisId={s.axis} dataKey={s.key} name={s.label} type="monotone" stroke={col(s.color)} strokeWidth={s.axis === "bal" ? 2 : 1.5}
                strokeDasharray={s.dash} connectNulls isAnimationActive={false}
                dot={{ r: 3, fill: "#0B0C0E", stroke: col(s.color), strokeWidth: 1.5, strokeDasharray: "0" }} activeDot={{ r: 4, fill: col(s.color), stroke: "none" }}
                label={<EndLabel last={last} text={s.label} color={col(s.color) === accent() ? "var(--accent-soft)" : col(s.color)} dy={4 + dy} />} />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Quiet balance sparkline for the Session Coach. */
export function Sparkline({ points, width = 232, height = 64 }: { points: { cm360: number; balance: number }[]; width?: number; height?: number }) {
  if (points.length < 2) {
    return <div style={{ width, height }} className="flex items-center border-b border-dashed border-line text-sm text-muted">Fills in after a couple of runs.</div>;
  }
  return (
    <div role="img" aria-label={`Balance curve so far, ${points.length} sens levels`} style={{ width, height }}>
      <LineChart width={width} height={height} data={points} margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
        <XAxis dataKey="cm360" type="number" scale="log" domain={["dataMin", "dataMax"]} hide />
        <YAxis hide domain={[(min: number) => Math.min(min, -0.1), (max: number) => Math.max(max, 0.1)]} />
        <ReferenceLine y={0} stroke="#3a414b" strokeDasharray="2 4" />
        <Line dataKey="balance" type="monotone" stroke={accent()} strokeWidth={1.5} dot={{ r: 2, fill: accent(), stroke: "none" }} isAnimationActive={false} />
      </LineChart>
    </div>
  );
}

// ---------------- uPlot ----------------

function useUplot(make: () => uPlot.Options, data: uPlot.AlignedData, height: number, deps: unknown[]) {
  const host = React.useRef<HTMLDivElement>(null);
  const plot = React.useRef<uPlot | null>(null);
  React.useEffect(() => {
    const el = host.current!;
    const u = new uPlot({ ...make(), width: el.clientWidth || 600, height }, data, el);
    plot.current = u;
    const ro = new ResizeObserver(() => { if (el.clientWidth) u.setSize({ width: el.clientWidth, height }); });
    ro.observe(el);
    return () => { ro.disconnect(); u.destroy(); plot.current = null; };
  }, [height]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { plot.current?.setData(data); }, [data, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return host;
}

const axis = (extra: Partial<uPlot.Axis> = {}): uPlot.Axis => ({
  stroke: C.muted, font: `11px ${MONO}`, ticks: { show: false }, grid: { show: false }, gap: 6, ...extra,
});
const LABEL_COLOR = { over: C.danger, under: C.warn, on: C.good };

/** Speed over time. With `flicks`, draws each detected flick: band start→click, dashed line at P, dot at the click. */
export function SpeedTrace({ t, speed, height = 200, flicks, dropped, range, ariaLabel }: {
  t: number[]; speed: number[]; height?: number; flicks?: Lab["flicks"]; dropped?: Lab["dropped"]; range?: [number, number]; ariaLabel: string;
}) {
  const marks = React.useRef({ flicks, dropped, range });
  marks.current = { flicks, dropped, range };
  const data = React.useMemo<uPlot.AlignedData>(() => [t, speed], [t, speed]);
  const host = useUplot(() => ({
    width: 600, height, legend: { show: false }, cursor: { show: false }, padding: [12, 8, 0, 0],
    scales: {
      x: { time: false, range: (_u, min, max) => marks.current.range ?? [min, max] },
      y: { range: (_u, _min, max) => [0, Math.max(20, max * 1.1)] },
    },
    axes: [
      axis({ values: (_u, v) => v.map((x) => `${Number(x.toFixed(1))}s`), size: 28 }),
      axis({ grid: { show: true, stroke: C.grid, width: 1 }, size: 44, values: (_u, v) => v.map((x) => String(x)) }),
    ],
    series: [{}, { stroke: accent(), width: 1.5, fill: accent() + "22", points: { show: false } }],
    hooks: {
      draw: [(u) => {
        const { flicks: fl, dropped: dr } = marks.current;
        if (!fl && !dr) return;
        const { ctx } = u, { left, top, width, height: h } = u.bbox, pr = devicePixelRatio || 1;
        ctx.save();
        ctx.beginPath(); ctx.rect(left, top, width, h); ctx.clip();
        for (const f of fl ?? []) {
          const x0 = u.valToPos(f.start, "x", true), x1 = u.valToPos(f.click, "x", true), xp = u.valToPos(f.p, "x", true);
          if (x1 < left || x0 > left + width) continue;
          const col = LABEL_COLOR[f.label];
          ctx.fillStyle = col + "1f"; ctx.fillRect(x0, top, x1 - x0, h);
          ctx.fillStyle = col; ctx.fillRect(x0, top + h - 3 * pr, x1 - x0, 3 * pr);
          ctx.strokeStyle = col; ctx.lineWidth = pr; ctx.setLineDash([3 * pr, 3 * pr]);
          ctx.beginPath(); ctx.moveTo(xp, top + 10 * pr); ctx.lineTo(xp, top + h); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(x1, top + 6 * pr, 3 * pr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = C.muted; ctx.lineWidth = 1.5 * pr;
        for (const d of dr ?? []) {
          const x = u.valToPos(d.click, "x", true), y = top + 6 * pr, s = 3 * pr;
          if (x < left || x > left + width) continue;
          ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
        }
        ctx.restore();
      }],
    },
  }), data, height, [flicks, dropped, range?.[0], range?.[1]]);
  return <div ref={host} role="img" aria-label={ariaLabel} className="w-full" style={{ height }} />;
}

/** Live mouse trail (x/y in cm). Drawn by hand on uPlot's canvas because the path is not monotonic in x. */
export function TrailPlot({ trail, height = 240, ariaLabel }: { trail: [number, number][]; height?: number; ariaLabel: string }) {
  const ref = React.useRef(trail);
  ref.current = trail;
  const data = React.useMemo<uPlot.AlignedData>(() => [trail.map((p) => p[0]), trail.map((p) => p[1])], [trail]);
  const host = useUplot(() => {
    const bounds = (i: 0 | 1, u: uPlot): [number, number] => {
      const pts = ref.current;
      if (!pts.length) return [-4, 4];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const aspect = u.bbox.width && u.bbox.height ? u.bbox.width / u.bbox.height : 2.4;
      const halfY = Math.max(4, (Math.max(...ys) - Math.min(...ys)) / 2 + 1, ((Math.max(...xs) - Math.min(...xs)) / 2 + 1) / aspect);
      return i === 0 ? [cx - halfY * aspect, cx + halfY * aspect] : [cy + halfY, cy - halfY];
    };
    return {
      width: 600, height, legend: { show: false }, cursor: { show: false }, padding: [8, 8, 8, 8],
      scales: { x: { time: false, range: (u) => bounds(0, u) }, y: { range: (u) => bounds(1, u) } },
      axes: [{ show: false }, { show: false }],
      series: [{}, { paths: () => null, points: { show: false } }],
      hooks: {
        draw: [(u) => {
          const pts = ref.current, { ctx } = u, pr = devicePixelRatio || 1, col = accent();
          if (pts.length < 2) return;
          ctx.save();
          ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 2 * pr; ctx.strokeStyle = col;
          for (let i = 1; i < pts.length; i++) {
            ctx.globalAlpha = 0.08 + 0.92 * (i / pts.length) ** 2;
            ctx.beginPath();
            ctx.moveTo(u.valToPos(pts[i - 1][0], "x", true), u.valToPos(pts[i - 1][1], "y", true));
            ctx.lineTo(u.valToPos(pts[i][0], "x", true), u.valToPos(pts[i][1], "y", true));
            ctx.stroke();
          }
          const head = pts[pts.length - 1];
          ctx.globalAlpha = 1; ctx.fillStyle = C.text;
          ctx.beginPath(); ctx.arc(u.valToPos(head[0], "x", true), u.valToPos(head[1], "y", true), 4 * pr, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }],
      },
    };
  }, data, height, []);
  return <div ref={host} role="img" aria-label={ariaLabel} className="w-full" style={{ height }} />;
}
