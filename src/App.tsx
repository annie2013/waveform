import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  Database,
  Folder,
  FolderOpen,
  History,
  Keyboard,
  Layers,
  LoaderCircle,
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Undo2,
  Upload,
  Activity as Waveform,
  X,
  Scissors,
  GitMerge,
  ArrowLeftRight,
  ImageDown,
  Copy,
  Pin,
} from "lucide-react";
import { organiseFiles } from "./files";
import { request } from "./client";
import { demoFiles } from "./demo";
import {
  Clusters,
  WavePlot,
  WaveformGate,
  AnalysisPlot,
  CellOverview,
} from "./plots";
import {
  color,
  fileId,
  defaultSettings,
  type Settings,
  type Trial,
  type ViewData,
  type AnalysisData,
  type PlotMode,
} from "./types";
const fmt = (n: number) => n.toLocaleString("en-GB");
const compact = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(2)}m`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n);
const time = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
function readSettings(): Settings {
  try {
    return {
      ...defaultSettings,
      ...JSON.parse(localStorage.getItem("waveform-settings") || "{}"),
    };
  } catch {
    return defaultSettings;
  }
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
type Pane = "settings" | "history" | "headers" | "help" | null;
export default function App() {
  const [trials, setTrials] = useState<Trial[]>([]),
    [trialId, setTrialId] = useState(""),
    [tetNum, setTetNum] = useState(1),
    [cutId, setCutId] = useState(""),
    [data, setData] = useState<ViewData | null>(null),
    [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [settings, setSettings] = useState<Settings>(readSettings),
    [cell, setCell] = useState(1),
    [sources, setSources] = useState<number[]>([1]),
    [dest, setDest] = useState(2),
    [tool, setTool] = useState("select"),
    [isolate, setIsolate] = useState(false),
    [range, setRange] = useState([0, 1]),
    [mode, setMode] = useState<PlotMode>("waveforms");
  const [pane, setPane] = useState<Pane>(null),
    [filter, setFilter] = useState(""),
    [sort, setSort] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [drag, setDrag] = useState(false),
    [demo, setDemo] = useState(false),
    [sidebar, setSidebar] = useState(true),
    [pins, setPins] = useState<{ id: string; title: string; image: string }[]>(
      [],
    );
  const fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    loadGen = useRef(0),
    analysisGen = useRef(0),
    lastCuts = useRef(new Map<string, string>()),
    lastTets = useRef(new Map<string, number>()),
    dirtySessions = useRef(new Set<string>());
  const trial = trials.find((t) => t.id === trialId),
    tet = trial?.tetrodes.find((t) => t.number === tetNum),
    cut = tet?.cuts.find((c) => c.id === cutId),
    ready = !!data && !busy;
  useEffect(() => {
    localStorage.setItem("waveform-settings", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    if (data?.dirty) dirtySessions.current.add(data.session);
    const f = (e: BeforeUnloadEvent) => {
      if (dirtySessions.current.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("beforeunload", f);
    return () => removeEventListener("beforeunload", f);
  }, [data?.dirty, data?.session]);
  const importFiles = async (files: File[]) => {
    try {
      setError("");
      const result = await organiseFiles(files, trials);
      setTrials(result.trials);
      if (result.ignored.length)
        setNotice(
          `${result.ignored.length} auxiliary or unrecognised files skipped. ${result.ignored.slice(0, 5).join(", ")}`,
        );
      if (!trialId) {
        const first = result.trials.find((t) => t.tetrodes.some((e) => e.file));
        if (first) {
          const e = first.tetrodes.find((e) => e.file)!;
          setTrialId(first.id);
          setTetNum(e.number);
          setCutId(e.cuts[0]?.id || "");
        }
      } else {
        const e = result.trials
          .find((t) => t.id === trialId)
          ?.tetrodes.find((t) => t.number === tetNum);
        if (e && !cutId && e.cuts.length) setCutId(e.cuts[0].id);
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const chooseTrial = (t: Trial) => {
    if (tet) lastCuts.current.set(tet.id, cutId);
    if (trial) lastTets.current.set(trial.id, tetNum);
    const e =
      t.tetrodes.find(
        (e) => e.number === (lastTets.current.get(t.id) || tetNum) && e.file,
      ) || t.tetrodes.find((e) => e.file);
    if (!e) return;
    setTrialId(t.id);
    setTetNum(e.number);
    setCutId(lastCuts.current.get(e.id) || e.cuts[0]?.id || "");
  };
  const chooseTet = (n: number) => {
    const e = trial?.tetrodes.find((t) => t.number === n && t.file);
    if (!e) return;
    if (tet) lastCuts.current.set(tet.id, cutId);
    setTetNum(n);
    setCutId(lastCuts.current.get(e.id) || e.cuts[0]?.id || "");
  };
  useEffect(() => {
    if (!tet?.file) return;
    const gen = ++loadGen.current;
    setBusy(true);
    setProgress(0);
    setMessage("Opening recording…");
    setError("");
    setAnalysis(null);
    setRange([0, 1]);
    request(
      "load",
      {
        file: tet.file,
        cut: cut?.file,
        set: trial?.set,
        pos: trial?.pos,
        budget: settings.budget,
      },
      (p, m) => {
        if (gen === loadGen.current) {
          setProgress(p);
          setMessage(m);
        }
      },
    )
      .then((d) => {
        if (gen !== loadGen.current) return;
        setData(d);
        const first = d.counts.findIndex((n, i) => n > 0 && i > 0),
          c = first < 0 ? 0 : first;
        setCell(c);
        setSources([c]);
        setDest(d.counts.findIndex((n, i) => n === 0 && i > 0));
        setBusy(false);
      })
      .catch((e) => {
        if (gen === loadGen.current) {
          setError(e.message);
          setBusy(false);
          setData(null);
        }
      });
  }, [tet?.id, tet?.file, cutId]);
  useEffect(() => {
    if (!data || busy) return;
    const gen = ++analysisGen.current;
    setAnalysis(null);
    const t = setTimeout(
      () =>
        request<AnalysisData>("analysis", {
          session: data.session,
          cell,
          pos: trial?.pos,
          settings,
        })
          .then((a) => {
            if (gen === analysisGen.current) setAnalysis(a);
          })
          .catch((e) => {
            if (gen === analysisGen.current) setError(e.message);
          }),
      100,
    );
    return () => {
      clearTimeout(t);
      analysisGen.current++;
    };
  }, [
    data,
    cell,
    trial?.pos,
    settings.binCm,
    settings.smooth,
    settings.acWindow,
    settings.leds,
    settings.maxSpeed,
    settings.posSmooth,
    settings.dirBin,
    settings.speedBin,
    busy,
  ]);
  const operation = async (
    type: string,
    payload: Record<string, unknown> = {},
  ) => {
    if (!ready) return;
    const generation = loadGen.current;
    setBusy(true);
    setProgress(0);
    setMessage(type === "edit" ? "Updating cut and saving undo…" : `${type}…`);
    try {
      const d = await request(
        type,
        { session: data!.session, ...payload },
        (p, m) => {
          if (generation === loadGen.current) {
            setProgress(p);
            setMessage(m);
          }
        },
      );
      if (generation === loadGen.current) setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generation === loadGen.current) setBusy(false);
    }
  };
  const edit = (action: string) => {
    if (!data) return;
    operation("edit", {
      action,
      source: cell,
      dest,
      description: `${action === "swap" ? "Swap" : action === "merge" ? "Merge" : "Move"} cell ${cell} ${action === "swap" ? "↔" : "→"} ${dest}`,
    });
  };
  const polygon = (points: number[], ax: number, ay: number) => {
    if (!sources.length) {
      setNotice("Select one or more source cells using the checkboxes.");
      return;
    }
    operation("edit", {
      action: tool === "brush" ? "paint" : "polygon",
      sources,
      dest,
      ax,
      ay,
      polygon: points,
      description: `${tool === "brush" ? "Brush" : "Lasso"} ${sources.join(", ")} → ${dest}`,
    });
  };
  const exportCut = async (format = "cut") => {
    if (!ready) return;
    try {
      const b = await request<Blob>("export", {
        session: data!.session,
        format,
        trial: trial!.name,
      });
      download(
        b,
        format === "clu"
          ? `${trial!.name}.clu.${tetNum}`
          : `${trial!.name}_${tetNum}.cut`,
      );
      setNotice("Cut exported. Original files are never overwritten.");
    } catch (e) {
      setError(String(e));
    }
  };
  const selectCell = (c: number) => {
    setCell(c);
    setSources([c]);
  };
  const snapshot = () => {
    const source = document.querySelector<HTMLCanvasElement>(
      ".detail-main canvas",
    );
    if (!source) return;
    const c = document.createElement("canvas");
    c.width = source.width;
    c.height = source.height + 50;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#10171f";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#b3dfcb";
    ctx.font = "12px monospace";
    ctx.fillText(
      `${trial?.name} · T${tetNum} · cell ${cell} · ${mode}`,
      12,
      21,
    );
    ctx.fillStyle = "#8098a8";
    ctx.font = "10px monospace";
    ctx.fillText(
      `${fmt(data?.counts[cell] || 0)} spikes · ${mode === "waveforms" ? "sampled waveforms" : "all-population analysis"}`,
      12,
      39,
    );
    ctx.drawImage(source, 0, 50);
    return c;
  };
  const pin = () => {
    const c = snapshot();
    if (c)
      setPins((p) => [
        ...p.slice(-3),
        {
          id: crypto.randomUUID(),
          title: `${trial?.name} · T${tetNum} · cell ${cell}`,
          image: c.toDataURL(),
        },
      ]);
  };
  const copyPlot = async () => {
    const c = snapshot();
    if (!c) return;
    c.toBlob(async (b) => {
      if (!b) return;
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": b }),
        ]);
        setNotice("Cell plot copied to clipboard.");
      } catch {
        download(b, `cell-${cell}-${mode}.png`);
        setNotice("Clipboard unavailable; the plot was downloaded.");
      }
    });
  };
  const forkCut = async () => {
    if (!ready) return;
    try {
      const blob = await request<Blob>("export", {
          session: data!.session,
          format: "cut",
          trial: trial!.name,
        }),
        file = new File([blob], `${trial!.name}_${tetNum} edited.cut`, {
          lastModified: Date.now(),
        }),
        result = await organiseFiles([file], trials);
      setTrials(result.trials);
      setCutId(fileId(file));
      setNotice("Created a cut copy. Each version keeps its own edit history.");
    } catch (e) {
      setError(String(e));
    }
  };
  const update = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,select,textarea")) return;
      const cmd = e.ctrlKey || e.metaKey;
      if (cmd && e.key === "o") {
        e.preventDefault();
        fileInput.current?.click();
        return;
      }
      if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault();
        operation(e.shiftKey ? "redo" : "undo");
        return;
      }
      if (cmd && e.key === "y") {
        e.preventDefault();
        operation("redo");
        return;
      }
      if (cmd && e.key === "s") {
        e.preventDefault();
        exportCut();
        return;
      }
      if (e.key === "Escape") {
        setPane(null);
        setTool("select");
        return;
      }
      if (e.key === "k" || e.key === "?")
        setPane((p) => (p === "help" ? null : "help"));
      if (e.key === "h") setPane((p) => (p === "headers" ? null : "headers"));
      if (e.key === "z") setPane((p) => (p === "history" ? null : "history"));
      if (e.key === "d") update("drift", !settings.drift);
      if (e.key === "p") update("density", !settings.density);
      if (e.key === "e") setDest(cell);
      if (e.key === "f")
        setSources(e.shiftKey ? [...new Set([...sources, cell])] : [cell]);
      if (e.key === "l") setTool("lasso");
      if (e.key === "Enter") setDest((d) => Math.min(1023, d + 1));
      if (/^[0-9]$/.test(e.key)) {
        const n = Math.floor(tetNum / 10) * 10 + +e.key;
        chooseTet(n);
      }
      if (e.key === "o") chooseTet(tetNum >= 10 ? tetNum - 10 : tetNum + 10);
      const modes: Record<string, PlotMode> = {
        w: "waveforms",
        r: "spatial",
        c: "direction",
        v: "speed",
        t: "ac",
      };
      if (modes[e.key]) setMode(modes[e.key]);
      if (trial && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const i = trials.indexOf(trial) + (e.key === "ArrowLeft" ? -1 : 1);
        if (trials[i]) chooseTrial(trials[i]);
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });
  const cells = data
    ? Array.from(data.counts, (n, i) => ({ n, i }))
        .filter((c) => c.n > 0 && String(c.i).includes(filter))
        .sort((a, b) => (sort ? b.n - a.n : a.i - b.i))
    : [];
  const startDemo = async () => {
    setDemo(true);
    setMessage("Creating synthetic demo…");
    await new Promise((r) => setTimeout(r, 20));
    await importFiles(demoFiles());
  };
  const drop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const entries = Array.from(e.dataTransfer.items)
      .map((i) => i.webkitGetAsEntry?.())
      .filter(Boolean);
    const files: File[] = [];
    const walk = async (entry: any, prefix = ""): Promise<void> => {
      if (entry.isFile) {
        const file: File = await new Promise((resolve, reject) =>
          entry.file(resolve, reject),
        );
        Object.defineProperty(file, "webkitRelativePath", {
          value: prefix + file.name,
        });
        files.push(file);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch: any[] = await new Promise((resolve, reject) =>
            reader.readEntries(resolve, reject),
          );
          if (!batch.length) break;
          for (const child of batch)
            await walk(child, `${prefix}${entry.name}/`);
        }
      }
    };
    if (entries.length) for (const entry of entries) await walk(entry);
    else files.push(...Array.from(e.dataTransfer.files));
    if (files.length) await importFiles(files);
  };
  const renderSettings = () => (
    <>
      <h3>Rendering</h3>
      <Slider
        label="Point size"
        value={settings.pointSize}
        min={0.5}
        max={4}
        step={0.1}
        unit="px"
        onChange={(v) => update("pointSize", v)}
      />
      <Slider
        label="Opacity"
        value={settings.opacity}
        min={0.05}
        max={1}
        step={0.05}
        onChange={(v) => update("opacity", v)}
      />
      <label className="field">
        Display budget
        <select
          aria-label="Display budget"
          value={settings.budget}
          onChange={async (e) => {
            const v = +e.target.value;
            update("budget", v);
            if (ready) await operation("budget", { budget: v });
          }}
        >
          {[50000, 100000, 250000, 500000, 1000000].map((n) => (
            <option key={n} value={n}>
              {fmt(n)} points / projection
            </option>
          ))}
        </select>
      </label>
      <Toggle
        label="Colour by recording time"
        checked={settings.drift}
        onChange={(v) => update("drift", v)}
      />
      <Toggle
        label="Additive density rendering"
        checked={settings.density}
        onChange={(v) => update("density", v)}
      />
      <h3>Spatial & temporal analysis</h3>
      <Slider
        label="Spatial bin width"
        value={settings.binCm}
        min={0.5}
        max={10}
        step={0.5}
        unit="cm"
        onChange={(v) => update("binCm", v)}
      />
      <Slider
        label="Boxcar radius"
        value={settings.smooth}
        min={0}
        max={5}
        step={1}
        unit="bins"
        onChange={(v) => update("smooth", v)}
      />
      <Slider
        label="Rate-map colour maximum (0 = auto)"
        value={settings.maxRate}
        min={0}
        max={50}
        step={1}
        unit="Hz"
        onChange={(v) => update("maxRate", v)}
      />
      <Slider
        label="Autocorrelation window"
        value={settings.acWindow}
        min={20}
        max={1000}
        step={20}
        unit="ms"
        onChange={(v) => update("acWindow", v)}
      />
      <Slider
        label="Direction bin width"
        value={settings.dirBin}
        min={2}
        max={30}
        step={2}
        unit="°"
        onChange={(v) => update("dirBin", v)}
      />
      <Slider
        label="Speed bin width"
        value={settings.speedBin}
        min={1}
        max={10}
        step={1}
        unit="cm/s"
        onChange={(v) => update("speedBin", v)}
      />
      <h3>Position processing</h3>
      <label className="field">
        Tracked LEDs
        <select
          aria-label="Tracked LEDs"
          value={settings.leds}
          onChange={(e) => update("leds", +e.target.value)}
        >
          <option value="1">One · movement direction</option>
          <option value="2">Two · LED direction</option>
        </select>
      </label>
      <Slider
        label="Jump filter (0 = off)"
        value={settings.maxSpeed}
        min={0}
        max={10}
        step={0.25}
        unit="m/s"
        onChange={(v) => update("maxSpeed", v)}
      />
      <Slider
        label="Position smoothing"
        value={settings.posSmooth}
        min={0}
        max={2}
        step={0.1}
        unit="s"
        onChange={(v) => update("posSmooth", v)}
      />
      <button
        className="secondary"
        onClick={() => setSettings(defaultSettings)}
      >
        Reset settings
      </button>
      <h3>Cut labels</h3>
      <button
        className="secondary"
        disabled={!ready}
        onClick={() =>
          operation("edit", {
            action: "sort",
            dest: 0,
            description: "Renumber cells by spike count (preserve noise 0)",
          })
        }
      >
        Renumber cells by spike count
      </button>
      <p className="muted">
        Largest cell becomes 1. Noise remains 0. This changes the cut and can be
        undone.
      </p>
    </>
  );
  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDrag(true);
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) setDrag(false);
      }}
      onDrop={drop}
    >
      <input
        ref={fileInput}
        type="file"
        aria-label="Import recording files"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) importFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        aria-label="Import recording folder"
        multiple
        hidden
        {...({ webkitdirectory: "" } as any)}
        onChange={(e) => {
          if (e.target.files) importFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      <header className="app-header">
        <a className="brand" href="./">
          <span className="brand-mark">
            <Waveform size={23} />
          </span>
          waveform<span className="version">2.0</span>
        </a>
        <span className="header-divider" />
        <span className="workspace-name">Spike sorting workspace</span>
        <div className="header-right">
          <span className="local-badge">
            <span /> Local files only
          </span>
          <button
            className="icon"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            onClick={() => setPane("help")}
          >
            <Keyboard size={17} />
          </button>
          <button
            className="icon"
            title="Settings"
            aria-label="Settings"
            onClick={() => setPane("settings")}
          >
            <Settings2 size={18} />
          </button>
          <a
            className="repo-link"
            href="https://github.com/d1manson/waveform"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </header>
      <div className={`workspace ${sidebar ? "" : "collapsed"}`}>
        <aside className="sidebar">
          <div className="sidebar-title">
            <span>RECORDINGS</span>
            <button
              className="icon"
              aria-label="Import files"
              onClick={() => fileInput.current?.click()}
            >
              <Plus size={17} />
            </button>
          </div>
          <button
            className="import-button"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={15} /> Import files <span>⌘ O</span>
          </button>
          <button
            className="folder-import"
            onClick={() => folderInput.current?.click()}
          >
            <FolderOpen size={13} /> Open a folder
          </button>
          <div className="recording-list">
            {trials.length ? (
              trials.map((t) => (
                <div
                  className={`trial ${t.id === trialId ? "active" : ""}`}
                  key={t.id}
                >
                  <button
                    className="trial-name"
                    title={t.folder || t.name}
                    onClick={() => chooseTrial(t)}
                  >
                    {t.id === trialId ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                    <Folder size={15} />
                    <span>{t.name}</span>
                    <small>{t.tetrodes.length}</small>
                  </button>
                  {t.id === trialId && (
                    <div className="trial-details">
                      <div className="trial-files">
                        <span className={t.set ? "available" : ""}>.set</span>
                        <span className={t.pos ? "available" : ""}>.pos</span>
                        <span>
                          {t.tetrodes.filter((t) => t.file).length} tetrodes
                        </span>
                      </div>
                      <div className="section-label">TETRODES</div>
                      <div className="tet-grid">
                        {t.tetrodes.map((e) => (
                          <button
                            key={e.id}
                            disabled={!e.file}
                            className={e.number === tetNum ? "selected" : ""}
                            onClick={() => chooseTet(e.number)}
                            title={e.file?.name || "Tetrode missing"}
                          >
                            {String(e.number).padStart(2, "0")}
                          </button>
                        ))}
                      </div>
                      <div className="section-label cuts-label">
                        CUT FILES <Layers size={11} />
                      </div>
                      <button
                        className={`cut-item ${!cutId ? "selected" : ""}`}
                        onClick={() => setCutId("")}
                      >
                        <span className="cut-dot" />
                        Unsorted <small>all spikes</small>
                      </button>
                      {tet?.cuts.map((c) => (
                        <button
                          key={c.id}
                          className={`cut-item ${cutId === c.id ? "selected" : ""}`}
                          onClick={() => setCutId(c.id)}
                          title={c.name}
                        >
                          <span className="cut-dot" />
                          <span>{c.name.replace(t.name, "~")}</span>
                        </button>
                      ))}
                      {data?.dirty && (
                        <div className="edited-label">
                          <PenLine size={11} /> Edited cut · undo preserved
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="sidebar-empty">
                <FolderOpen size={27} />
                <p>
                  Your recordings
                  <br />
                  will appear here.
                </p>
                <span>.set · .pos · .1–.N · .cut · .clu.N</span>
              </div>
            )}
          </div>
          <div className="sidebar-bottom">
            <ShieldCheck size={15} />
            <div>
              Private by design<small>Files stay on this device</small>
            </div>
          </div>
        </aside>
        <main>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert" role="status">
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!data && !busy ? (
            <div className="welcome">
              <div className="welcome-kicker">
                <span /> A CLEARER VIEW OF YOUR RECORDINGS
              </div>
              <h1>
                From spikes to
                <br />
                <em>something meaningful.</em>
              </h1>
              <p>
                Explore tetrodes, compare cells, and refine your cuts.
                <br />A fast, private workspace for your neural recordings.
              </p>
              <div
                className="drop-card"
                onClick={() => fileInput.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") fileInput.current?.click();
                }}
              >
                <div className="drop-icon">
                  <Upload size={26} />
                </div>
                <h2>Drop your recording files here</h2>
                <p>
                  Choose a selection of trials, tetrodes and cut files.
                  <br />
                  We’ll organise everything for you.
                </p>
                <button
                  className="primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInput.current?.click();
                  }}
                >
                  <FolderOpen size={15} /> Browse files
                </button>
                <span className="formats">
                  LTX .SET, .POS, .1–.N, .CUT, .CLU.N
                </span>
              </div>
              <div className="demo-prompt">
                Just looking around?{" "}
                <button onClick={startDemo}>
                  Explore a synthetic demo <ArrowRight size={13} />
                </button>
              </div>
              <div className="welcome-features">
                <span>
                  <Database size={15} /> Chunked large-file loading
                </span>
                <span>
                  <Activity size={15} /> WebGL2 rendering
                </span>
                <span>
                  <History size={15} /> Full cut undo & redo
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="view-heading">
                <div>
                  <div className="breadcrumbs">
                    <button
                      className="icon"
                      aria-label="Toggle recordings sidebar"
                      onClick={() => setSidebar(!sidebar)}
                    >
                      <ChevronsLeft size={15} />
                    </button>
                    Recordings <ChevronRight size={12} /> {trial?.name}{" "}
                    <ChevronRight size={12} />
                    <span>Tetrode {String(tetNum).padStart(2, "0")}</span>
                    {demo && <b className="demo-badge">SYNTHETIC DEMO</b>}
                  </div>
                  <h1>
                    Tetrode {String(tetNum).padStart(2, "0")}
                    <span className="subdued">/</span>
                    <span className="trial-caption">{trial?.name}</span>
                  </h1>
                </div>
                <div className="view-actions">
                  <button
                    className="secondary"
                    aria-label="Edit history"
                    onClick={() => setPane("history")}
                  >
                    <History size={15} /> History
                    {data?.undo.length ? (
                      <span className="count-badge">{data.undo.length}</span>
                    ) : null}
                  </button>
                  <button
                    className="primary"
                    disabled={!ready}
                    onClick={() => exportCut()}
                  >
                    <ArrowDownToLine size={15} /> Export cut
                  </button>
                </div>
              </div>
              <div className="stats-row">
                <Stat label="SPIKES" value={data ? fmt(data.n) : "—"} />
                <Stat
                  label="CELLS"
                  value={
                    data
                      ? String(
                          data.counts.filter((n, i) => i > 0 && n > 0).length,
                        )
                      : "—"
                  }
                />
                <Stat
                  label="DURATION"
                  value={data ? time(data.duration) : "—"}
                />
                <Stat
                  label="CUT"
                  value={
                    cut ? cut.name.replace(trial?.name || "", "~") : "Unsorted"
                  }
                  extra={
                    data?.dirty ? "Modified" : cut ? "Imported" : "No cut file"
                  }
                />
                <div className="cache-stat">
                  <span className="status-dot" />
                  {data?.cached ? "Cached & ready" : "Rust / Wasm engine"}
                  <small>
                    {data
                      ? `${(data.residentBytes / 1048576).toFixed(0)} MB resident`
                      : "Preparing recording"}
                  </small>
                </div>
              </div>
              <div className="editor-body">
                <section className="plots-column">
                  <div className="panel cluster-panel">
                    <div className="panel-heading">
                      <div>
                        <span className="panel-dot" />
                        Feature space
                        <span className="panel-subtitle">
                          Peak-to-peak amplitude
                        </span>
                      </div>
                      <div className="panel-controls">
                        <button
                          className={settings.drift ? "active" : ""}
                          onClick={() => update("drift", !settings.drift)}
                        >
                          Drift
                        </button>
                        <button
                          className={settings.density ? "active" : ""}
                          onClick={() => update("density", !settings.density)}
                        >
                          Density
                        </button>
                        <button
                          className="icon"
                          aria-label="Plot settings"
                          onClick={() => setPane("settings")}
                        >
                          <SlidersHorizontal size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="plot-toolbar">
                      <div className="segmented">
                        <button
                          className={tool === "select" ? "active" : ""}
                          title="Select"
                          onClick={() => setTool("select")}
                        >
                          <MousePointer2 size={14} />
                        </button>
                        <button
                          className={tool === "lasso" ? "active" : ""}
                          title="Lasso cut [L]"
                          aria-label="Lasso cut"
                          onClick={() => setTool("lasso")}
                        >
                          <Scissors size={14} /> Lasso
                        </button>
                        <button
                          className={tool === "brush" ? "active" : ""}
                          title="Paint source spikes"
                          onClick={() => setTool("brush")}
                        >
                          <PenLine size={14} />
                        </button>
                      </div>
                      <span className="toolbar-hint">
                        {tool === "select"
                          ? "Choose a cell to inspect"
                          : `Draw to move source spikes → cell ${dest}`}
                      </span>
                      <button
                        className="icon"
                        aria-label="Undo"
                        title="Undo [⌘Z]"
                        disabled={!ready || !data?.undo.length}
                        onClick={() => operation("undo")}
                      >
                        <Undo2 size={15} />
                      </button>
                      <button
                        className="icon"
                        aria-label="Redo"
                        title="Redo [⌘⇧Z]"
                        disabled={!ready || !data?.redo.length}
                        onClick={() => operation("redo")}
                      >
                        <Redo2 size={15} />
                      </button>
                    </div>
                    {data && (
                      <Clusters
                        data={data}
                        settings={settings}
                        selected={cell}
                        isolate={isolate}
                        range={range}
                        tool={ready ? tool : "select"}
                        onPolygon={polygon}
                      />
                    )}
                    <div className="plot-footer">
                      <span>
                        <span className="status-dot" />
                        {data
                          ? compact(Math.min(data.n, settings.budget))
                          : "—"}{" "}
                        displayed / {data ? compact(data.n) : "—"} spikes
                        <span className="footer-note">
                          {" "}
                          · cuts use all spikes
                        </span>
                      </span>
                      <span>
                        WebGL2 <span className="dot-separator">·</span> 6
                        projections
                      </span>
                    </div>
                  </div>
                  <div className="time-filter">
                    <span>TIME WINDOW</span>
                    <label>
                      Start
                      <input
                        aria-label="Time window start"
                        type="range"
                        min="0"
                        max="1"
                        step=".001"
                        value={range[0]}
                        onChange={(e) =>
                          setRange([
                            Math.min(+e.target.value, range[1]),
                            range[1],
                          ])
                        }
                      />
                    </label>
                    <label>
                      End
                      <input
                        aria-label="Time window end"
                        type="range"
                        min="0"
                        max="1"
                        step=".001"
                        value={range[1]}
                        onChange={(e) =>
                          setRange([
                            range[0],
                            Math.max(+e.target.value, range[0]),
                          ])
                        }
                      />
                    </label>
                    <b>
                      {time((data?.duration || 0) * range[0])} —{" "}
                      {time((data?.duration || 0) * range[1])}
                    </b>
                    <button onClick={() => setRange([0, 1])}>Reset</button>
                  </div>
                  {data && (
                    <CellOverview
                      data={data}
                      selected={cell}
                      onSelect={selectCell}
                    />
                  )}
                  <div className="panel details-panel">
                    <div className="panel-heading">
                      <div>
                        Cell{" "}
                        <span
                          className="cell-number"
                          style={{ color: color(cell) }}
                        >
                          {String(cell).padStart(2, "0")}
                        </span>
                        <span className="panel-subtitle">
                          {data ? fmt(data.counts[cell] || 0) : "—"} spikes
                        </span>
                      </div>
                      <div className="snapshot-controls">
                        <button
                          className="icon"
                          aria-label="Pin cell snapshot"
                          title="Pin cell for comparison"
                          disabled={!ready}
                          onClick={pin}
                        >
                          <Pin size={14} />
                        </button>
                        <button
                          className="icon"
                          aria-label="Copy cell plot"
                          title="Copy plot to clipboard"
                          disabled={!ready}
                          onClick={copyPlot}
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          className="icon"
                          aria-label="Export plot image"
                          onClick={() => {
                            const c = snapshot();
                            c?.toBlob((b) => {
                              if (b) download(b, `cell-${cell}-${mode}.png`);
                            });
                          }}
                        >
                          <ImageDown size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="detail-tabs">
                      {(
                        [
                          "waveforms",
                          "spatial",
                          "direction",
                          "speed",
                          "ac",
                        ] as PlotMode[]
                      ).map((m) => (
                        <button
                          key={m}
                          className={mode === m ? "active" : ""}
                          onClick={() => setMode(m)}
                        >
                          {
                            {
                              waveforms: "Waveforms",
                              spatial: "Spatial rate",
                              direction: "Head direction",
                              speed: "Speed",
                              ac: "Autocorrelation",
                            }[m]
                          }
                        </button>
                      ))}
                    </div>
                    <div className="detail-content">
                      <div className="detail-main">
                        {data && mode === "waveforms" ? (
                          <>
                            <WavePlot data={data} cell={cell} />
                            <WaveformGate
                              disabled={!ready || !sources.length}
                              onGate={(channel, sample, threshold, above) =>
                                operation("edit", {
                                  action: "gate",
                                  sources,
                                  dest,
                                  channel,
                                  sample,
                                  threshold,
                                  above,
                                  description: `Waveform Ch ${channel + 1} sample ${sample} ${above ? "≥" : "<"} ${threshold} → ${dest}`,
                                })
                              }
                            />
                          </>
                        ) : analysis && (trial?.pos || mode === "ac") ? (
                          <AnalysisPlot
                            data={analysis}
                            mode={mode}
                            maxRate={settings.maxRate}
                          />
                        ) : (
                          <div className="analysis-empty">
                            {analysis
                              ? "Add a matching .pos file for position analysis."
                              : "Computing analysis…"}
                          </div>
                        )}
                      </div>
                      <div className="detail-metrics">
                        <Stat
                          label="MEAN RATE"
                          value={
                            analysis ? `${analysis.rate.toFixed(2)} Hz` : "—"
                          }
                        />
                        <Stat
                          label="REFRACTORY < 2 ms"
                          value={
                            analysis
                              ? `${analysis.refractory.toFixed(2)}%`
                              : "—"
                          }
                        />
                        <Stat
                          label="SPATIAL PEAK"
                          value={
                            analysis && trial?.pos
                              ? `${analysis.peak.toFixed(2)} Hz`
                              : "—"
                          }
                        />
                        {mode === "ac" && analysis?.sampledPairs && (
                          <small>
                            Autocorrelation uses sampled reference spikes.
                          </small>
                        )}
                        {mode === "waveforms" && (
                          <small>
                            Waveforms use a stratified sample. Cut labels use
                            every spike.
                          </small>
                        )}
                      </div>
                    </div>
                  </div>
                  {pins.length > 0 && (
                    <div className="pinned-plots">
                      {pins.map((p) => (
                        <div className="panel" key={p.id}>
                          <div className="panel-heading">
                            <span>{p.title}</span>
                            <button
                              className="icon"
                              aria-label={`Remove pinned ${p.title}`}
                              onClick={() =>
                                setPins((ps) => ps.filter((x) => x.id !== p.id))
                              }
                            >
                              <X size={12} />
                            </button>
                          </div>
                          <img alt={p.title} src={p.image} />
                        </div>
                      ))}
                    </div>
                  )}
                  {analysis && trial?.pos && (
                    <div className="mini-plots">
                      <div className="panel">
                        <div className="panel-heading">
                          Path & spikes <small>Cell {cell}</small>
                        </div>
                        <AnalysisPlot data={analysis} mode="path" maxRate={0} />
                      </div>
                      <div className="panel">
                        <div className="panel-heading">
                          Spatial rate{" "}
                          <small>{analysis.peak.toFixed(1)} Hz peak</small>
                        </div>
                        <AnalysisPlot
                          data={analysis}
                          mode="spatial"
                          maxRate={settings.maxRate}
                        />
                      </div>
                      <div className="panel">
                        <div className="panel-heading">
                          Autocorrelation{" "}
                          <small>
                            {settings.acWindow} ms
                            {analysis.sampledPairs ? " · sampled" : ""}
                          </small>
                        </div>
                        <AnalysisPlot data={analysis} mode="ac" maxRate={0} />
                      </div>
                    </div>
                  )}
                </section>
                <aside className="cells-panel panel">
                  <div className="panel-heading">
                    <span>
                      Cells{" "}
                      <b className="count-badge">
                        {data ? data.counts.filter((c) => c > 0).length : 0}
                      </b>
                    </span>
                    <button
                      className="icon"
                      title="Sort by spike count"
                      aria-label="Sort cells by count"
                      onClick={() => setSort(!sort)}
                    >
                      <ArrowDownToLine size={14} />
                    </button>
                  </div>
                  <div className="cell-search">
                    <Search size={13} />
                    <input
                      aria-label="Find cell"
                      placeholder="Find a cell…"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </div>
                  <div className="cell-list-header">
                    <span>SOURCE / CELL</span>
                    <span>SPIKES</span>
                  </div>
                  <div className="cell-list">
                    {cells.map((c) => (
                      <div
                        key={c.i}
                        className={`cell-row ${cell === c.i ? "selected" : ""}`}
                      >
                        <input
                          aria-label={`Cell ${c.i} source`}
                          type="checkbox"
                          checked={sources.includes(c.i)}
                          onChange={(e) =>
                            setSources(
                              e.target.checked
                                ? [...sources, c.i]
                                : sources.filter((i) => i !== c.i),
                            )
                          }
                        />
                        <button
                          onClick={() => selectCell(c.i)}
                          aria-label={`Select cell ${c.i}`}
                        >
                          <span
                            className="cell-color"
                            style={{ background: color(c.i) }}
                          />
                          <b>
                            {c.i === 0
                              ? "0 · Noise"
                              : String(c.i).padStart(2, "0")}
                          </b>
                          <span>{compact(c.n)}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="cell-controls">
                    <Toggle
                      label="Isolate selected cell"
                      checked={isolate}
                      onChange={setIsolate}
                    />
                    <div className="cut-destination">
                      <label htmlFor="destination">Destination cell</label>
                      <input
                        id="destination"
                        aria-label="Destination cell"
                        type="number"
                        min="0"
                        max="1023"
                        value={dest}
                        onChange={(e) =>
                          setDest(Math.max(0, Math.min(1023, +e.target.value)))
                        }
                      />
                      <button
                        title="Next empty cell"
                        aria-label="Next empty cell"
                        onClick={() =>
                          setDest(
                            data?.counts.findIndex(
                              (n, i) => i > 0 && n === 0,
                            ) || 1,
                          )
                        }
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <div className="edit-buttons">
                      <button
                        disabled={!ready || cell === dest}
                        onClick={() => edit("merge")}
                      >
                        <GitMerge size={14} /> Merge
                      </button>
                      <button
                        disabled={!ready || cell === dest}
                        onClick={() => edit("swap")}
                      >
                        <ArrowLeftRight size={14} /> Swap
                      </button>
                    </div>
                    <p>
                      Select source cells, set a destination, then draw a lasso
                      to split or reassign spikes.
                    </p>
                    <button
                      className="history-link"
                      onClick={() => setPane("history")}
                    >
                      <History size={13} /> View edit history{" "}
                      <ChevronRight size={12} />
                    </button>
                  </div>
                </aside>
              </div>
            </>
          )}
          {busy && (
            <div
              className={`loading-bar ${data ? "inline" : "initial"}`}
              role="status"
            >
              <LoaderCircle size={17} className="spin" />
              <span>{message}</span>
              <progress max="1" value={progress} />
            </div>
          )}
        </main>
      </div>
      <footer className="app-footer">
        <span>
          <span className="status-dot" />{" "}
          {busy ? "Processing" : data ? "Ready" : "Ready to explore"}
          <span className="dot-separator">·</span>All processing on your device
        </span>
        <span>
          Rust + WebAssembly <span className="dot-separator">/</span> React{" "}
          <span className="dot-separator">/</span> WebGL2{" "}
          <button onClick={() => setPane("help")}>
            <Keyboard size={12} /> Shortcuts
          </button>
        </span>
      </footer>
      {drag && (
        <div className="drag-overlay">
          <Upload size={40} />
          <h2>Drop files to add your recordings</h2>
          <p>
            Trials, tetrodes, position data and cuts are matched automatically.
          </p>
        </div>
      )}
      {pane && (
        <div className="pane-backdrop" onClick={() => setPane(null)}>
          <section
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={
              {
                settings: "Settings",
                history: "Edit history",
                headers: "File headers",
                help: "Keyboard shortcuts",
              }[pane]
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-heading">
              <h2>
                {
                  {
                    settings: "Workspace settings",
                    history: "Edit history",
                    headers: "File headers",
                    help: "Keyboard shortcuts",
                  }[pane]
                }
              </h2>
              <button
                className="icon"
                aria-label="Close panel"
                onClick={() => setPane(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="drawer-content">
              {pane === "settings" && renderSettings()}
              {pane === "history" && (
                <>
                  <p className="muted">
                    Each cut keeps its own undo and redo history when you switch
                    trials or tetrodes. History is stored locally for this
                    workspace session.
                  </p>
                  <div className="history-actions">
                    <button
                      disabled={!ready || !data?.undo.length}
                      className="secondary"
                      onClick={() => operation("undo")}
                    >
                      <Undo2 size={14} /> Undo
                    </button>
                    <button
                      disabled={!ready || !data?.redo.length}
                      className="secondary"
                      onClick={() => operation("redo")}
                    >
                      <Redo2 size={14} /> Redo
                    </button>
                  </div>
                  <div className="history-list">
                    {data?.undo.length ? (
                      data.undo.map((h, i) => (
                        <div key={h.id}>
                          <span className="history-index">{i + 1}</span>
                          <div>
                            <b>{h.description}</b>
                            <small>{fmt(h.changed)} spikes changed</small>
                          </div>
                          <Check size={14} />
                        </div>
                      ))
                    ) : (
                      <div className="empty-history">
                        <History size={27} />
                        <p>No edits yet.</p>
                        <small>
                          Merge, swap, or lasso spikes to start a cut.
                        </small>
                      </div>
                    )}
                    {data?.redo
                      .slice()
                      .reverse()
                      .map((h) => (
                        <div className="undone" key={h.id}>
                          <Redo2 size={13} />
                          <div>
                            <b>{h.description}</b>
                            <small>Undone · available to redo</small>
                          </div>
                        </div>
                      ))}
                  </div>
                  <button
                    className="primary full"
                    disabled={!ready}
                    onClick={() => exportCut()}
                  >
                    Export .cut
                  </button>
                  <button
                    className="secondary full"
                    disabled={!ready}
                    onClick={forkCut}
                  >
                    Duplicate cut
                  </button>
                  <button
                    className="secondary full"
                    disabled={!ready}
                    onClick={() => exportCut("clu")}
                  >
                    Export .clu (1-based)
                  </button>
                </>
              )}
              {pane === "headers" && <Headers headers={data?.headers || {}} />}
              {pane === "help" && (
                <>
                  <p className="muted">
                    Your files stay on your device. Import a selection of LTX
                    files or a folder to begin. Add cut files at any time.
                  </p>
                  <h3>Navigation</h3>
                  <Shortcut keys="0–9" text="Jump to tetrode (ones digit)" />
                  <Shortcut keys="O" text="Toggle tetrode tens digit" />
                  <Shortcut keys="← / →" text="Previous / next trial" />
                  <Shortcut keys="H" text="Inspect file headers" />
                  <Shortcut keys="K / ?" text="Keyboard shortcuts" />
                  <h3>Cut editing</h3>
                  <Shortcut
                    keys="L"
                    text="Lasso source spikes into destination"
                  />
                  <Shortcut
                    keys="E / F"
                    text="Selected cell as destination / source"
                  />
                  <Shortcut keys="Enter" text="Next destination cell" />
                  <Shortcut keys="⌘ / Ctrl Z" text="Undo" />
                  <Shortcut keys="⌘ / Ctrl ⇧ Z" text="Redo" />
                  <Shortcut keys="⌘ / Ctrl S" text="Export .cut" />
                  <h3>Views</h3>
                  <Shortcut
                    keys="W / R / C / V / T"
                    text="Waves / spatial / direction / speed / autocorrelation"
                  />
                  <Shortcut
                    keys="D / P"
                    text="Time colours / additive density"
                  />
                  <Shortcut
                    keys="Esc"
                    text="Close panel, return to selection"
                  />
                  <h3>Reading the plots</h3>
                  <p className="muted">
                    Feature space uses a bounded, evenly spaced display sample.
                    Lasso cuts use all spikes from the checked source cells,
                    across the entire recording; the time sliders affect display
                    only. Waveform traces use a stratified sample. Rate maps use
                    occupancy-normalised rates. Autocorrelation omits the
                    self-spike and uses sampled reference spikes for large
                    groups.
                  </p>
                  <a
                    href="https://github.com/d1manson/waveform"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Original project & source ↗
                  </a>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  extra,
}: {
  label: string;
  value: string;
  extra?: string;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
      {extra && <small>{extra}</small>}
    </div>
  );
}
function Slider({
  label,
  value,
  min,
  max,
  step,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="slider-field">
      <span>
        {label}
        <b>
          {Number(value.toFixed(2))} {unit}
        </b>
      </span>
      <input
        aria-label={label}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function Shortcut({ keys, text }: { keys: string; text: string }) {
  return (
    <div className="shortcut">
      <span>{text}</span>
      <kbd>{keys}</kbd>
    </div>
  );
}
function Headers({
  headers,
}: {
  headers: Record<string, Record<string, string>>;
}) {
  const [filter, setFilter] = useState("");
  return (
    <>
      <div className="cell-search">
        <Search size={14} />
        <input
          aria-label="Filter headers"
          placeholder="Filter headers…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {Object.entries(headers).map(([file, h]) => (
        <div key={file}>
          <h3>{file}</h3>
          <dl className="headers-list">
            {Object.entries(h)
              .filter(([k, v]) =>
                `${k} ${v}`.toLowerCase().includes(filter.toLowerCase()),
              )
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      ))}
    </>
  );
}
