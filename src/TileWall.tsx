import { useEffect, useRef, useState } from "react";
import { drawWaveOverview } from "./gpu";
import { AnalysisPlot } from "./plots";
import { request } from "./client";
import {
  color,
  type ViewData,
  type AnalysisData,
  type Settings,
  type PlotMode,
} from "./types";
export type VisiblePlots = Record<PlotMode, boolean>;
const ROW = 124;
export function TileWall({
  data,
  settings,
  pos,
  posKey,
  selected,
  sources,
  shown,
  filter,
  sort,
  onSelect,
  onSources,
}: {
  data: ViewData;
  settings: Settings;
  pos?: File;
  posKey: string;
  selected: number;
  sources: number[];
  shown: VisiblePlots;
  filter: string;
  sort: boolean;
  onSelect: (n: number) => void;
  onSources: (n: number[]) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null),
    waveCanvas = useRef<HTMLCanvasElement>(null),
    cache = useRef(new Map<number, AnalysisData>()),
    [maps, setMaps] = useState(new Map<number, AnalysisData>()),
    [scroll, setScroll] = useState(0),
    [height, setHeight] = useState(800),
    [width, setWidth] = useState(600);
  const all = Array.from(data.counts, (n, i) => ({ n, i }))
    .filter((c) => c.n > 0 && String(c.i).includes(filter))
    .sort((a, b) => (sort ? b.n - a.n : a.i - b.i))
    .map((c) => c.i);
  const start = Math.max(0, Math.floor(scroll / ROW) - 1),
    visible = all.slice(start, start + Math.ceil(height / ROW) + 3),
    signature = visible.join(","),
    scope = `${data.session}|${data.undo.at(-1)?.id || "original"}|${settings.binCm}|${settings.smooth}|${settings.acWindow}|${settings.leds}|${settings.maxSpeed}|${settings.posSmooth}|${settings.dirBin}|${settings.speedBin}`;
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      setHeight(scroller.current!.clientHeight);
      setWidth(scroller.current!.clientWidth);
    });
    ro.observe(scroller.current!);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    cache.current.clear();
    setMaps(new Map());
  }, [scope]);
  useEffect(() => {
    let current = true;
    const batch = crypto.randomUUID(),
      missing = visible.filter((c) => !cache.current.has(c));
    Promise.all(
      missing.map((cell) =>
        request<AnalysisData>("analysis", {
          session: data.session,
          cell,
          pos,
          posKey,
          settings,
          summary: true,
          batch,
        }),
      ),
    )
      .then((results) => {
        if (!current) return;
        for (const result of results) cache.current.set(result.cell, result);
        setMaps(new Map(cache.current));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [scope, signature]);
  useEffect(() => {
    if (!shown.waveforms || !waveCanvas.current) return;
    return drawWaveOverview(waveCanvas.current, data, visible, 1);
  }, [data, signature, width, shown.waveforms]);
  const waveWidth = shown.waveforms
    ? shown.spatial || shown.direction || shown.speed || shown.ac
      ? "60%"
      : "calc(100% - 32px)"
    : "0%";
  return (
    <div
      className="tile-wall"
      ref={scroller}
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      aria-label="Cell tile wall"
    >
      <div className="tile-spacer" style={{ height: all.length * ROW }}>
        <div
          className="tile-window"
          style={{ top: start * ROW, height: visible.length * ROW }}
        >
          {shown.waveforms && (
            <canvas
              ref={waveCanvas}
              className="tile-wave-canvas"
              style={{ width: waveWidth }}
              aria-label="Cell waveform tile wall"
            />
          )}
          {visible.map((cell, i) => {
            const a = maps.get(cell);
            return (
              <section
                key={cell}
                className={`cell-tile ${selected === cell ? "selected" : ""}`}
                data-cell={cell}
                style={{ top: i * ROW, height: ROW }}
                onClick={() => onSelect(cell)}
              >
                <div className="tile-waves" style={{ width: waveWidth }}>
                  {shown.waveforms && (
                    <>
                      <span className="wave-channel-names">
                        1 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 2
                        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 3
                        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 4
                      </span>
                      <span className="tile-wave-caption">
                        {data.waveLabels.filter((c) => c === cell).length}{" "}
                        sampled waves
                      </span>
                    </>
                  )}
                </div>
                <div className="tile-numeric-plots">
                  {shown.spatial && (
                    <div
                      className="tile-spatial"
                      title={`Spatial peak: ${a?.peak.toFixed(2) || "—"} Hz`}
                    >
                      {a && pos ? (
                        <AnalysisPlot
                          data={a}
                          mode="spatial"
                          maxRate={settings.maxRate}
                          compact
                        />
                      ) : (
                        <span className="plot-unavailable">
                          {pos ? "…" : "No .pos"}
                        </span>
                      )}
                    </div>
                  )}
                  {(shown.direction || shown.speed || shown.ac) && (
                    <div className="tile-tuning">
                      <div className="tile-tuning-top">
                        {shown.direction && (
                          <div className="tile-direction">
                            {a && pos && (
                              <AnalysisPlot
                                data={a}
                                mode="direction"
                                maxRate={0}
                                compact
                              />
                            )}
                          </div>
                        )}
                        {shown.speed && (
                          <div className="tile-speed">
                            {a && pos && (
                              <AnalysisPlot
                                data={a}
                                mode="speed"
                                maxRate={0}
                                compact
                              />
                            )}
                          </div>
                        )}
                      </div>
                      {shown.ac && (
                        <div className="tile-ac">
                          {a && (
                            <AnalysisPlot
                              data={a}
                              mode="ac"
                              maxRate={0}
                              compact
                            />
                          )}
                          {a?.sampledPairs && (
                            <span title="Sampled reference spikes">s</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="tile-badge">
                  <button
                    aria-label={`Select cell ${cell}`}
                    title={`Cell ${cell}${cell === 0 ? " (noise)" : ""}`}
                    style={{
                      background: cell ? color(cell) : "#e9e9e9",
                      color: cell ? "white" : "black",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(cell);
                    }}
                  >
                    {cell}
                  </button>
                  <input
                    aria-label={`Cell ${cell} source`}
                    type="checkbox"
                    checked={sources.includes(cell)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onSources(
                        e.target.checked
                          ? [...sources, cell]
                          : sources.filter((c) => c !== cell),
                      )
                    }
                  />
                </div>
                <div className="tile-caption">
                  <span>{data.counts[cell].toLocaleString()} spikes</span>
                  <span>{a ? `${a.rate.toFixed(2)} Hz` : "…"}</span>
                  {a && pos && <span>spa {a.peak.toFixed(1)} Hz</span>}
                  {a && (
                    <span title="Consecutive intervals under 2 ms">
                      ISI {a.refractory.toFixed(2)}%
                    </span>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {!all.length && <div className="no-cells">No matching cells.</div>}
    </div>
  );
}
export function captureTile(
  cell: number,
  title: string,
): HTMLCanvasElement | undefined {
  const row = document.querySelector<HTMLElement>(
      `.cell-tile[data-cell="${cell}"]`,
    ),
    waves = document.querySelector<HTMLCanvasElement>(".tile-wave-canvas");
  if (!row) return;
  const rect = row.getBoundingClientRect(),
    dpr = Math.min(2, devicePixelRatio || 1),
    canvas = document.createElement("canvas");
  canvas.width = rect.width * dpr;
  canvas.height = (rect.height + 28) * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, rect.width, rect.height + 28);
  ctx.fillStyle = "black";
  ctx.font = "11px Arial";
  ctx.fillText(title, 6, 17);
  if (waves) {
    const w = waves.getBoundingClientRect();
    const sy = waves.height / w.height;
    ctx.drawImage(
      waves,
      0,
      (rect.top - w.top) * sy,
      waves.width,
      rect.height * sy,
      0,
      28,
      w.width,
      rect.height,
    );
  }
  for (const c of row.querySelectorAll<HTMLCanvasElement>("canvas")) {
    const b = c.getBoundingClientRect();
    ctx.drawImage(
      c,
      b.left - rect.left,
      b.top - rect.top + 28,
      b.width,
      b.height,
    );
  }
  ctx.font = "10px Arial";
  ctx.fillText(
    row.querySelector(".tile-caption")?.textContent || "",
    5,
    rect.height + 24,
  );
  return canvas;
}
