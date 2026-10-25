import { useEffect, useRef, useState } from "react";
import { ClusterGPU, drawWaves, drawWaveOverview, projections } from "./gpu";
import {
  color,
  type ViewData,
  type Settings,
  type AnalysisData,
  type PlotMode,
} from "./types";
export function Clusters({
  data,
  settings,
  selected,
  isolate,
  range,
  tool,
  onPolygon,
}: {
  data: ViewData;
  settings: Settings;
  selected: number;
  isolate: boolean;
  range: number[];
  tool: string;
  onPolygon: (p: number[], ax: number, ay: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    gpu = useRef<ClusterGPU | null>(null),
    [error, setError] = useState(""),
    [axes, setAxes] = useState(projections),
    [stroke, setStroke] = useState<number[][]>([]),
    drawing = useRef<{ plot: number; points: number[][] } | null>(null),
    [version, setVersion] = useState(0);
  useEffect(() => {
    const c = canvas.current!;
    const restore = () => setVersion((v) => v + 1),
      lost = (e: Event) => {
        e.preventDefault();
        gpu.current = null;
      };
    c.addEventListener("webglcontextlost", lost);
    c.addEventListener("webglcontextrestored", restore);
    try {
      gpu.current = new ClusterGPU(c);
    } catch (e) {
      setError(String(e));
    }
    const ro = new ResizeObserver(() => setVersion((v) => v + 1));
    ro.observe(c);
    return () => {
      ro.disconnect();
      gpu.current?.dispose();
      c.removeEventListener("webglcontextlost", lost);
      c.removeEventListener("webglcontextrestored", restore);
    };
  }, []);
  useEffect(() => {
    try {
      if (!gpu.current && canvas.current)
        gpu.current = new ClusterGPU(canvas.current);
      gpu.current?.draw(data, settings, selected, isolate, range, axes);
    } catch (e) {
      setError(String(e));
    }
  }, [data, settings, selected, isolate, range, axes, version]);
  const point = (e: React.PointerEvent) => {
    const b = e.currentTarget.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  };
  return (
    <div
      className="clusters"
      onPointerDown={(e) => {
        if (tool !== "lasso" && tool !== "brush") return;
        const p = point(e),
          b = e.currentTarget.getBoundingClientRect(),
          plot = Math.min(
            5,
            Math.floor(p[1] / (b.height / 2)) * 3 +
              Math.floor(p[0] / (b.width / 3)),
          );
        drawing.current = { plot, points: [p] };
        setStroke([p]);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const p = point(e);
        drawing.current.points.push(p);
        setStroke([...drawing.current.points]);
      }}
      onPointerUp={(e) => {
        const d = drawing.current;
        drawing.current = null;
        setStroke([]);
        if (!d) return;
        const b = e.currentTarget.getBoundingClientRect(),
          w = b.width / 3,
          h = b.height / 2,
          col = d.plot % 3,
          row = Math.floor(d.plot / 3),
          points = d.points;
        if (tool !== "brush" && points.length < 3) return;
        const poly = points.flatMap(([x, y]) => [
          Math.max(
            0,
            Math.min(1, ((x - col * w - 22) / (w - 34) - 0.035) / 0.93),
          ),
          Math.max(
            0,
            Math.min(1, 1 - ((y - row * h - 26) / (h - 50) - 0.035) / 0.93),
          ),
        ]);
        onPolygon(poly, axes[d.plot][0], axes[d.plot][1]);
      }}
    >
      <canvas ref={canvas} aria-label="Six WebGL2 spike feature projections" />
      <div className="projection-labels">
        {axes.map(([x, y], i) => (
          <div key={i}>
            <span>
              <b>{x === 4 ? "Time" : `Ch ${x + 1}`}</b>
              <i>×</i>
              <b>{y === 4 ? "Time" : `Ch ${y + 1}`}</b>
            </span>
            <button
              title="Toggle time projection"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() =>
                setAxes((a) =>
                  a.map((p, j) =>
                    j === i ? [p[0], p[1] === 4 ? projections[i][1] : 4] : p,
                  ),
                )
              }
            >
              ↔
            </button>
            <small className="x-label">
              {x === 4 ? "Time →" : `Channel ${x + 1} · peak-to-peak`}
            </small>
            <small className="y-label">
              {y === 4 ? "Time →" : `Channel ${y + 1}`}
            </small>
          </div>
        ))}
      </div>
      {stroke.length > 0 && (
        <svg className="lasso-overlay">
          <polyline
            points={stroke.map((p) => p.join(",")).join(" ")}
            fill={tool === "brush" ? "none" : "rgba(103,217,188,.12)"}
            stroke="#8ce6cc"
            strokeWidth={tool === "brush" ? 18 : 1.5}
            strokeOpacity={tool === "brush" ? 0.3 : 1}
          />
        </svg>
      )}
      {error && <div className="plot-error">{error}</div>}
    </div>
  );
}
export function WavePlot({ data, cell }: { data: ViewData; cell: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => drawWaves(ref.current!, data, cell), [data, cell]);
  return (
    <div className="wave-plot">
      <div className="channel-labels">
        {[1, 2, 3, 4].map((c) => (
          <span key={c}>CH {c}</span>
        ))}
      </div>
      <canvas ref={ref} aria-label={`Sampled waveforms for cell ${cell}`} />
      <small>
        50 samples / channel ·{" "}
        {data.waveLabels.filter((c) => c === cell).length} sampled spikes
      </small>
    </div>
  );
}
export function WaveformGate({
  disabled,
  onGate,
}: {
  disabled: boolean;
  onGate: (
    channel: number,
    sample: number,
    threshold: number,
    above: boolean,
  ) => void;
}) {
  const [channel, setChannel] = useState(0),
    [sample, setSample] = useState(14),
    [threshold, setThreshold] = useState(40),
    [above, setAbove] = useState(true);
  return (
    <details className="wave-gate">
      <summary>Split by waveform sample</summary>
      <p>
        Apply a sample threshold to every spike in the checked source cells. The
        first use reads one waveform column; repeated cuts reuse it.
      </p>
      <div>
        <label>
          Channel
          <select
            aria-label="Gate channel"
            value={channel}
            onChange={(e) => setChannel(+e.target.value)}
          >
            {[0, 1, 2, 3].map((c) => (
              <option key={c} value={c}>
                {c + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sample
          <input
            aria-label="Gate sample"
            type="number"
            value={sample}
            min="0"
            max="49"
            onChange={(e) =>
              setSample(Math.max(0, Math.min(49, +e.target.value)))
            }
          />
        </label>
        <label>
          Threshold
          <input
            aria-label="Gate threshold"
            type="number"
            value={threshold}
            min="-128"
            max="127"
            onChange={(e) =>
              setThreshold(Math.max(-128, Math.min(127, +e.target.value)))
            }
          />
        </label>
        <label>
          Move
          <select
            aria-label="Gate direction"
            value={above ? "above" : "below"}
            onChange={(e) => setAbove(e.target.value === "above")}
          >
            <option value="above">At or above</option>
            <option value="below">Below</option>
          </select>
        </label>
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => onGate(channel, sample, threshold, above)}
        >
          Apply split
        </button>
      </div>
    </details>
  );
}
export function CellOverview({
  data,
  selected,
  onSelect,
}: {
  data: ViewData;
  selected: number;
  onSelect: (n: number) => void;
}) {
  const [page, setPage] = useState(0),
    [open, setOpen] = useState(false),
    [cols, setCols] = useState(3),
    [version, setVersion] = useState(0),
    ref = useRef<HTMLCanvasElement>(null);
  const ids = Array.from(data.counts, (n, i) => ({ n, i }))
      .filter((c) => c.n > 0)
      .map((c) => c.i),
    pages = Math.ceil(ids.length / 12),
    cells = ids.slice(
      Math.min(page, pages - 1) * 12,
      (Math.min(page, pages - 1) + 1) * 12,
    );
  useEffect(() => {
    if (!open || !ref.current) return;
    const ro = new ResizeObserver(() => {
      setCols(ref.current!.clientWidth < 500 ? 2 : 3);
      setVersion((v) => v + 1);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [open]);
  useEffect(() => {
    if (open && ref.current)
      return drawWaveOverview(ref.current, data, cells, cols);
  }, [data, open, page, cols, version]);
  return (
    <div className="panel overview-panel">
      <div className="panel-heading">
        <button className="overview-toggle" onClick={() => setOpen(!open)}>
          <span>{open ? "▾" : "▸"}</span> Cell overview{" "}
          <small>{ids.length} groups · sampled waveforms</small>
        </button>
        {open && (
          <div className="overview-pages">
            <button
              disabled={page <= 0}
              aria-label="Previous cell page"
              onClick={() => setPage((p) => p - 1)}
            >
              ←
            </button>
            <small>
              {page + 1} / {pages}
            </small>
            <button
              disabled={page >= pages - 1}
              aria-label="Next cell page"
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </button>
          </div>
        )}
      </div>
      {open && (
        <div
          className="wave-overview"
          style={{ height: Math.ceil(cells.length / cols) * 120 }}
        >
          <canvas
            ref={ref}
            aria-label="Waveform overview rendered in one WebGL2 context"
          />
          <div
            className="wave-overview-labels"
            style={{ gridTemplateColumns: `repeat(${cols},1fr)` }}
          >
            {cells.map((c) => (
              <button
                key={c}
                className={c === selected ? "selected" : ""}
                onClick={() => onSelect(c)}
                aria-label={`Inspect overview cell ${c}`}
              >
                <b style={{ color: color(c) }}>
                  Cell {String(c).padStart(2, "0")}
                </b>
                <small>{data.counts[c].toLocaleString()} spikes</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
export function AnalysisPlot({
  data,
  mode,
  maxRate,
}: {
  data: AnalysisData;
  mode: PlotMode | "path";
  maxRate: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current!,
      draw = () => {
        const dpr = Math.min(2, devicePixelRatio || 1);
        c.width = c.clientWidth * dpr;
        c.height = c.clientHeight * dpr;
        const ctx = c.getContext("2d")!;
        ctx.scale(dpr, dpr);
        const w = c.clientWidth,
          h = c.clientHeight;
        ctx.fillStyle = "#0a0e12";
        ctx.fillRect(0, 0, w, h);
        if (mode === "spatial") {
          const scale = maxRate || data.peak || 1,
            ww = w / data.width,
            hh = h / data.height;
          for (let i = 0; i < data.spatial.length; i++) {
            const v = data.spatial[i];
            ctx.fillStyle = Number.isFinite(v)
              ? `hsl(${230 - Math.min(1, v / scale) * 220} 75% ${12 + Math.min(1, v / scale) * 47}%)`
              : "#111923";
            ctx.fillRect(
              (i % data.width) * ww,
              Math.floor(i / data.width) * hh,
              ww + 0.5,
              hh + 0.5,
            );
          }
        } else if (mode === "path") {
          ctx.strokeStyle = "#34464e";
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          for (let i = 0; i < data.path.length; i += 2) {
            const x = data.path[i] * w,
              y = data.path[i + 1] * h;
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          }
          ctx.stroke();
          ctx.fillStyle = "#7cdec3";
          for (let i = 0; i < data.spikes.length; i += 2)
            ctx.fillRect(data.spikes[i] * w, data.spikes[i + 1] * h, 1.6, 1.6);
        } else if (mode === "direction") {
          const a = data.direction,
            max = Math.max(...a, 1),
            r = Math.min(w, h) * 0.4,
            cx = w / 2,
            cy = h / 2;
          ctx.strokeStyle = "#263641";
          for (const k of [0.5, 1]) {
            ctx.beginPath();
            ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.strokeStyle = "#77dac0";
          ctx.fillStyle = "#77dac024";
          ctx.beginPath();
          for (let i = 0; i <= a.length; i++) {
            const j = i % a.length,
              theta = (j / a.length) * Math.PI * 2 - Math.PI,
              rr = (a[j] / max) * r,
              x = cx + Math.cos(theta) * rr,
              y = cy + Math.sin(theta) * rr;
            if (!i) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          const a = mode === "ac" ? data.ac : data.speed,
            max = Math.max(...a, 1),
            bw = (w - 36) / a.length;
          ctx.strokeStyle = "#24333e";
          ctx.beginPath();
          ctx.moveTo(28, 10);
          ctx.lineTo(28, h - 23);
          ctx.lineTo(w - 6, h - 23);
          ctx.stroke();
          ctx.fillStyle = "#7cdec3";
          for (let i = 0; i < a.length; i++) {
            const v = (a[i] / max) * (h - 40);
            ctx.fillRect(29 + i * bw, h - 24 - v, Math.max(1, bw - 1), v);
          }
          ctx.fillStyle = "#70828f";
          ctx.font = "10px monospace";
          ctx.fillText("0", 25, h - 7);
          ctx.fillText(
            mode === "ac" ? "lag →" : "speed (cm/s) →",
            w / 2 - 25,
            h - 7,
          );
        }
      };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [data, mode, maxRate]);
  return (
    <canvas
      ref={canvas}
      className="analysis-canvas"
      aria-label={mode === "ac" ? "Temporal autocorrelogram" : `${mode} plot`}
    />
  );
}
