/// <reference lib="webworker" />
import { parseHeader, textHeader, readCut } from "./files";
import {
  type Settings,
  type Header,
  type HistoryEntry,
  type ViewData,
} from "./types";
import { parsePosition, analyse, type Position } from "./position";
import {
  openStore,
  put,
  get,
  makePatch,
  applyPatch,
  type Patch,
} from "./history";
type Wasm = { memory: WebAssembly.Memory; [key: string]: any };
interface Asset {
  key: string;
  wasm: Wasm;
  e: number;
  n: number;
  header: Header;
  offset: number;
  file: File;
  waveIndices: Uint32Array;
  waves: Int8Array;
  ms: number;
  last: number;
  gates?: Map<string, Int8Array>;
}
interface Session {
  key: string;
  asset: string;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  dirty: boolean;
  revision: number;
  labels?: Uint16Array;
}
const assets = new Map<string, Asset>(),
  sessions = new Map<string, Session>(),
  positions = new Map<string, Position>(),
  analyses = new Map<string, unknown>();
let modulePromise: Promise<WebAssembly.Module>;
let latestLoad = 0;
const dbPromise = openStore();
let active: Session | undefined, activeAsset: Asset | undefined;
const labels = (a: Asset) =>
  new Uint16Array(a.wasm.memory.buffer, a.wasm.engine_labels(a.e), a.n);
const times = (a: Asset) =>
  new Uint32Array(a.wasm.memory.buffer, a.wasm.engine_times(a.e), a.n);
const amps = (a: Asset) =>
  new Uint8Array(a.wasm.memory.buffer, a.wasm.engine_amps(a.e), a.n * 4);
const counts = (a: Asset) =>
  new Uint32Array(a.wasm.memory.buffer, a.wasm.engine_counts(a.e), 1024);
const resident = () =>
  Array.from(assets.values()).reduce(
    (v, a) =>
      v +
      a.wasm.memory.buffer.byteLength +
      a.waves.byteLength +
      [...(a.gates?.values() || [])].reduce((n, c) => n + c.byteLength, 0),
    0,
  );
function progress(id: number, value: number, message: string) {
  self.postMessage({ id, progress: value, message });
}
async function saveActive() {
  if (active && activeAsset) {
    await put(
      await dbPromise,
      `labels:${active.key}`,
      labels(activeAsset).slice(),
    );
    active.labels = undefined;
  }
}
async function evict(required: number) {
  for (const [key, a] of [...assets].sort((a, b) => a[1].last - b[1].last)) {
    if (resident() + required <= 384 * 1024 * 1024) break;
    if (active?.asset === key) continue;
    assets.delete(key);
    a.wasm.engine_free(a.e);
  }
}
async function loadAsset(
  file: File,
  cut: File | undefined,
  id: number,
  key: string,
): Promise<Asset> {
  let a = assets.get(key);
  if (a) {
    a.last = performance.now();
    return a;
  }
  const start = performance.now(),
    head = new Uint8Array(await file.slice(0, 65536).arrayBuffer()),
    { header, offset } = parseHeader(head);
  let n = parseInt(header.num_spikes);
  if (
    header.spike_format !== "t,ch1,t,ch2,t,ch3,t,ch4" ||
    parseInt(header.samples_per_spike || "50") !== 50 ||
    parseInt(header.num_chans || "4") !== 4 ||
    parseInt(header.bytes_per_sample || "1") !== 1 ||
    parseInt(header.bytes_per_timestamp || "4") !== 4
  )
    throw new Error(
      "Supported tetrodes have 4 channels, 50 signed 8-bit samples, and 32-bit timestamps.",
    );
  if (
    new TextDecoder()
      .decode(head.subarray(offset, offset + 10))
      .startsWith("\r\ndata_end")
  )
    n = 0;
  if (
    !Number.isSafeInteger(n) ||
    n < 0 ||
    n > 20_000_000 ||
    file.size < offset + n * 216 ||
    !(parseFloat(header.timebase) > 0)
  )
    throw new Error("Invalid/truncated tetrode or unsupported spike count.");
  const initial = cut ? await readCut(cut, n) : new Uint16Array(n);
  await evict(n * 12 + 30_000_000);
  const instance = await WebAssembly.instantiate(await modulePromise, {}),
    wasm = instance.exports as Wasm,
    e = wasm.engine_new(n);
  a = {
    key,
    wasm,
    e,
    n,
    header,
    offset,
    file,
    waves: new Int8Array(),
    waveIndices: new Uint32Array(),
    ms: 0,
    last: performance.now(),
  };
  labels(a).set(initial);
  const reservoirs = new Map<
    number,
    { ids: number[]; waves: number[][]; seen: number }
  >();
  const chunkSpikes = 32768,
    chunkBytes = chunkSpikes * 216,
    p = wasm.alloc_bytes(chunkBytes);
  try {
    for (let first = 0; first < n; first += chunkSpikes) {
      if (id !== latestLoad)
        throw new Error("Superseded by another recording.");
      const count = Math.min(chunkSpikes, n - first),
        bytes = new Uint8Array(
          await file
            .slice(offset + first * 216, offset + (first + count) * 216)
            .arrayBuffer(),
        );
      new Uint8Array(wasm.memory.buffer, p, bytes.length).set(bytes);
      wasm.engine_push(e, p, bytes.length);
      for (let j = 0; j < count; j++) {
        const cell = initial[first + j];
        let r = reservoirs.get(cell);
        if (!r) {
          r = { ids: [], waves: [], seen: 0 };
          reservoirs.set(cell, r);
        }
        r.seen++;
        const hash = Math.imul(first + j + 1, 2654435761) >>> 0,
          slot = r.seen <= 128 ? r.seen - 1 : hash % r.seen;
        if (slot >= 128) continue;
        const wave: number[] = [];
        for (let c = 0; c < 4; c++)
          for (let t = 0; t < 50; t++)
            wave.push((bytes[j * 216 + c * 54 + 4 + t] << 24) >> 24);
        r.ids[slot] = first + j;
        r.waves[slot] = wave;
      }
      progress(
        id,
        (first + count) / Math.max(1, n),
        `Preparing ${(first + count).toLocaleString()} / ${n.toLocaleString()} spikes`,
      );
    }
  } catch (err) {
    wasm.engine_free(e);
    throw err;
  } finally {
    wasm.free_bytes(p, chunkBytes);
  }
  const wi: number[] = [],
    waves: number[] = [];
  for (const r of reservoirs.values())
    for (let i = 0; i < r.ids.length; i++) {
      wi.push(r.ids[i]);
      waves.push(...r.waves[i]);
    }
  a.waveIndices = new Uint32Array(wi);
  a.waves = new Int8Array(waves);
  wasm.engine_recount(e);
  a.ms = performance.now() - start;
  assets.set(key, a);
  return a;
}
function view(
  a: Asset,
  s: Session,
  budget: number,
  cached: boolean,
  headers: Record<string, Header>,
): ViewData {
  // Long editing sessions must not accumulate every waveform ever sampled.
  if (a.waveIndices.length > 32768) {
    const perCell = new Uint32Array(1024),
      full = labels(a),
      keep: number[] = [];
    for (let i = 0; i < a.waveIndices.length; i++)
      if (perCell[full[a.waveIndices[i]]]++ < 128) keep.push(i);
    if (keep.length < a.waveIndices.length) {
      const wi = new Uint32Array(keep.length),
        waves = new Int8Array(keep.length * 200);
      keep.forEach((old, i) => {
        wi[i] = a.waveIndices[old];
        waves.set(a.waves.subarray(old * 200, old * 200 + 200), i * 200);
      });
      a.waveIndices = wi;
      a.waves = waves;
    }
  }
  const m = Math.min(a.n, budget),
    features = new Uint8Array(m * 4),
    t = new Float32Array(m),
    l = new Uint16Array(m),
    indices = new Uint32Array(m),
    full = labels(a),
    at = times(a),
    ap = amps(a);
  for (let j = 0; j < m; j++) {
    const i = Math.floor((j * a.n) / m);
    indices[j] = i;
    features.set(ap.subarray(i * 4, i * 4 + 4), j * 4);
    t[j] = at[i] / Math.max(1, at[a.n - 1]);
    l[j] = full[i];
  }
  const wl = new Uint16Array(a.waveIndices.length);
  for (let i = 0; i < wl.length; i++) wl[i] = full[a.waveIndices[i]];
  return {
    key: a.key,
    session: s.key,
    name: a.file.name,
    n: a.n,
    duration:
      parseFloat(a.header.duration) ||
      (at[a.n - 1] || 0) / parseFloat(a.header.timebase),
    timebase: parseFloat(a.header.timebase),
    counts: counts(a).slice(),
    features,
    times: t,
    labels: l,
    indices,
    waves: a.waves.slice(),
    waveLabels: wl,
    waveIndices: a.waveIndices.slice(),
    headers,
    undo: s.undo,
    redo: s.redo,
    dirty: s.dirty,
    cached,
    residentBytes: resident(),
    loadMs: a.ms,
  };
}
let currentHeaders: Record<string, Header> = {},
  budget = 250000;
async function replenishWaves(a: Asset, cell: number) {
  const full = labels(a),
    n = counts(a)[cell];
  if (!n) return;
  let have = 0;
  for (const i of a.waveIndices) if (full[i] === cell) have++;
  if (have >= Math.min(64, n)) return;
  // A newly isolated small cell may be absent from the original reservoir. Fetch only
  // selected 216-byte records; never decode the large waveform file a second time.
  const ids: number[] = [];
  let seen = 0;
  for (let i = 0; i < full.length; i++)
    if (full[i] === cell) {
      seen++;
      const slot =
        seen <= 128 ? seen - 1 : (Math.imul(i + 1, 2654435761) >>> 0) % seen;
      if (slot < 128) ids[slot] = i;
    }
  const existing = new Set(a.waveIndices),
    wanted = ids.filter((i) => !existing.has(i)),
    extra = new Int8Array(wanted.length * 200);
  for (let first = 0; first < wanted.length; first += 16)
    await Promise.all(
      wanted.slice(first, first + 16).map(async (i, j) => {
        const bytes = new Int8Array(
          await a.file
            .slice(a.offset + i * 216, a.offset + (i + 1) * 216)
            .arrayBuffer(),
        );
        for (let c = 0; c < 4; c++)
          extra.set(
            bytes.subarray(c * 54 + 4, c * 54 + 54),
            (first + j) * 200 + c * 50,
          );
      }),
    );
  const wi = new Uint32Array(a.waveIndices.length + wanted.length),
    waves = new Int8Array(a.waves.length + extra.length);
  wi.set(a.waveIndices);
  wi.set(wanted, a.waveIndices.length);
  waves.set(a.waves);
  waves.set(extra, a.waves.length);
  a.waveIndices = wi;
  a.waves = waves;
}
async function waveformColumn(
  a: Asset,
  channel: number,
  sample: number,
  id: number,
) {
  if (
    !Number.isInteger(channel) ||
    channel < 0 ||
    channel > 3 ||
    !Number.isInteger(sample) ||
    sample < 0 ||
    sample > 49
  )
    throw new Error("Invalid waveform gate.");
  const key = `${channel}:${sample}`;
  a.gates ??= new Map();
  const cached = a.gates.get(key);
  if (cached) return cached;
  const column = new Int8Array(a.n),
    chunk = 32768;
  for (let first = 0; first < a.n; first += chunk) {
    const count = Math.min(chunk, a.n - first),
      bytes = new Int8Array(
        await a.file
          .slice(a.offset + first * 216, a.offset + (first + count) * 216)
          .arrayBuffer(),
      );
    for (let i = 0; i < count; i++)
      column[first + i] = bytes[i * 216 + channel * 54 + 4 + sample];
    progress(
      id,
      (first + count) / a.n,
      `Preparing waveform gate ${(first + count).toLocaleString()} / ${a.n.toLocaleString()}`,
    );
  }
  a.gates.set(key, column);
  if (a.gates.size > 2) a.gates.delete(a.gates.keys().next().value!);
  return column;
}
async function handle(m: any): Promise<any> {
  if (m.type === "load") {
    await saveActive();
    const file = m.file as File,
      key = m.assetKey as string,
      sessionKey = `${key}|${m.cut ? m.cutKey : "unsorted"}`,
      cached = assets.has(key);
    budget = m.budget;
    const a = await loadAsset(file, m.cut, m.id, key);
    let s = sessions.get(sessionKey);
    if (!s) {
      s = {
        key: sessionKey,
        asset: key,
        undo: [],
        redo: [],
        dirty: false,
        revision: 0,
      };
      sessions.set(sessionKey, s);
      if (cached) {
        if (m.cut) labels(a).set(await readCut(m.cut, a.n));
        else labels(a).fill(0);
      }
    } else {
      const stored = await get<Uint16Array>(
        await dbPromise,
        `labels:${sessionKey}`,
      );
      if (stored) labels(a).set(stored);
      else if (m.cut) labels(a).set(await readCut(m.cut, a.n));
      else labels(a).fill(0);
    }
    a.wasm.engine_recount(a.e);
    active = s;
    activeAsset = a;
    currentHeaders = { tetrode: a.header };
    if (m.set) currentHeaders.set = textHeader(await (m.set as File).text());
    if (m.pos) {
      const { header } = parseHeader(
        new Uint8Array(await (m.pos as File).slice(0, 65536).arrayBuffer()),
      );
      currentHeaders.position = header;
    }
    return view(a, s, budget, cached, currentHeaders);
  }
  if (!active || !activeAsset) throw new Error("Load a tetrode first.");
  const a = activeAsset,
    s = active;
  if (m.session && m.session !== s.key)
    throw new Error("The active cut changed; retry the operation.");
  if (m.type === "budget") {
    budget = m.budget;
    return view(a, s, budget, true, currentHeaders);
  }
  if (m.type === "edit") {
    if (!Number.isInteger(m.dest) || m.dest < 0 || m.dest >= 1024)
      throw new Error("Destination cell must be 0–1023.");
    const before = labels(a).slice();
    let changed = 0;
    if (m.action === "sort") changed = a.wasm.engine_sort(a.e);
    else if (m.action === "gate" || m.action === "paint") {
      const sources = new Uint16Array(m.sources),
        p = a.wasm.alloc_bytes(sources.byteLength);
      new Uint16Array(a.wasm.memory.buffer, p, sources.length).set(sources);
      try {
        if (m.action === "gate") {
          const column = await waveformColumn(a, m.channel, m.sample, m.id),
            q = a.wasm.alloc_bytes(column.byteLength);
          new Int8Array(a.wasm.memory.buffer, q, column.length).set(column);
          changed = a.wasm.engine_gate(
            a.e,
            p,
            sources.length,
            m.dest,
            q,
            m.threshold,
            m.above ? 1 : 0,
          );
          a.wasm.free_bytes(q, column.byteLength);
        } else {
          const mask = new Uint8Array(65536),
            points = m.polygon as number[];
          const radius = 10;
          for (let i = 0; i < points.length; i += 2) {
            const x = Math.round(points[i] * 255),
              y = Math.round(points[i + 1] * 255);
            for (let dy = -radius; dy <= radius; dy++)
              for (let dx = -radius; dx <= radius; dx++)
                if (
                  dx * dx + dy * dy <= radius * radius &&
                  x + dx >= 0 &&
                  x + dx < 256 &&
                  y + dy >= 0 &&
                  y + dy < 256
                )
                  mask[(y + dy) * 256 + x + dx] = 1;
          }
          const q = a.wasm.alloc_bytes(mask.byteLength);
          new Uint8Array(a.wasm.memory.buffer, q, mask.length).set(mask);
          changed = a.wasm.engine_mask(
            a.e,
            p,
            sources.length,
            m.dest,
            m.ax,
            m.ay,
            q,
          );
          a.wasm.free_bytes(q, mask.byteLength);
        }
      } finally {
        a.wasm.free_bytes(p, sources.byteLength);
      }
    } else if (m.action === "polygon") {
      const sources = new Uint16Array(m.sources),
        poly = new Float32Array(m.polygon);
      const p = a.wasm.alloc_bytes(sources.byteLength),
        q = a.wasm.alloc_bytes(poly.byteLength);
      new Uint16Array(a.wasm.memory.buffer, p, sources.length).set(sources);
      new Float32Array(a.wasm.memory.buffer, q, poly.length).set(poly);
      changed = a.wasm.engine_polygon(
        a.e,
        p,
        sources.length,
        m.dest,
        m.ax,
        m.ay,
        q,
        poly.length,
      );
      a.wasm.free_bytes(p, sources.byteLength);
      a.wasm.free_bytes(q, poly.byteLength);
    } else
      changed = a.wasm.engine_relabel(
        a.e,
        m.source,
        m.dest,
        m.action === "swap" ? 1 : 0,
      );
    if (changed) {
      const patch = makePatch(before, labels(a)),
        entry = {
          id: crypto.randomUUID(),
          description: m.description,
          changed,
        };
      try {
        await put(await dbPromise, `patch:${entry.id}`, patch);
      } catch (err) {
        labels(a).set(before);
        a.wasm.engine_recount(a.e);
        throw new Error(
          `Edit rolled back: undo storage is unavailable (${String(err)}).`,
        );
      }
      s.undo.push(entry);
      s.redo = [];
      s.dirty = true;
      s.revision++;
      analyses.clear();
      try {
        await replenishWaves(a, m.dest);
      } catch {
        progress(m.id, 1, "Cut saved; waveform sample refresh unavailable.");
      }
    }
    return view(a, s, budget, true, currentHeaders);
  }
  if (m.type === "undo" || m.type === "redo") {
    const from = m.type === "undo" ? s.undo : s.redo,
      to = m.type === "undo" ? s.redo : s.undo,
      entry = from.at(-1);
    if (entry) {
      const patch = await get<Patch>(await dbPromise, `patch:${entry.id}`);
      if (!patch) throw new Error("Undo data is unavailable.");
      applyPatch(labels(a), patch, m.type === "redo");
      from.pop();
      to.push(entry);
      s.dirty = true;
      s.revision++;
      a.wasm.engine_recount(a.e);
      analyses.clear();
    }
    return view(a, s, budget, true, currentHeaders);
  }
  if (m.type === "analysis") {
    const opts = m.settings as Settings,
      pk = m.pos
        ? `${m.posKey}|${opts.leds}|${opts.maxSpeed}|${opts.posSmooth}`
        : "";
    let pos = positions.get(pk);
    if (m.pos && !pos) {
      pos = await parsePosition(m.pos, opts);
      positions.set(pk, pos);
      if (positions.size > 4) positions.delete(positions.keys().next().value!);
    }
    const key = `${s.key}|${s.revision}|${m.cell}|${pk}|${opts.binCm}|${opts.smooth}|${opts.acWindow}|${opts.dirBin}|${opts.speedBin}`;
    if (analyses.has(key)) return analyses.get(key);
    const result = analyse(
      times(a),
      labels(a),
      m.cell,
      parseFloat(a.header.timebase),
      parseFloat(a.header.duration) ||
        (times(a)[a.n - 1] || 0) / parseFloat(a.header.timebase),
      pos,
      opts,
    );
    analyses.set(key, result);
    if (analyses.size > 100) analyses.delete(analyses.keys().next().value!);
    return result;
  }
  if (m.type === "export") {
    const full = labels(a),
      max = counts(a).findLastIndex((c) => c > 0),
      parts: BlobPart[] = [];
    parts.push(
      m.format === "clu"
        ? `${max + 1}\n`
        : `n_clusters: ${max + 1}\nn_channels: 4\nn_params: 0\ntimes_used_in_Vt: 0 0 0 0\n${Array.from({ length: max + 1 }, (_, i) => `cluster: ${i} center: 0 0 0 0 0 0 0 0\nmin: 0 0 0 0 0 0 0 0\nmax: 0 0 0 0 0 0 0 99\n`).join("")}\nExact_cut_for: ${m.trial} spikes: ${a.n}\n`,
    );
    for (let p = 0; p < full.length; p += 65536) {
      let text = "";
      for (let i = p; i < Math.min(full.length, p + 65536); i++)
        text += `${full[i] + (m.format === "clu" ? 1 : 0)}${m.format === "clu" ? "\n" : " "}`;
      parts.push(text + "\n");
    }
    return new Blob(parts, { type: "text/plain" });
  }
  throw new Error(`Unknown operation: ${m.type}`);
}
// Serialize mutations and file changes; generation checks in React ignore stale display results.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent) => {
  const m = event.data;
  if (m.type === "init") {
    modulePromise = fetch(m.url).then(async (r) => {
      if (!r.ok)
        throw new Error("Rust/Wasm module missing; run npm run build:wasm.");
      return WebAssembly.compile(await r.arrayBuffer());
    });
    return;
  }
  if (m.type === "load") latestLoad = m.id;
  queue = queue.then(async () => {
    try {
      if (m.type === "load" && m.id !== latestLoad)
        throw new Error("Superseded by another recording.");
      const data = await handle(m);
      const transfer: Transferable[] = [];
      if (data && m.type !== "analysis")
        for (const v of Object.values(data))
          if (ArrayBuffer.isView(v)) transfer.push(v.buffer as ArrayBuffer);
      self.postMessage({ id: m.id, data }, transfer);
    } catch (err) {
      self.postMessage({
        id: m.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
};
