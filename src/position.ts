import { parseHeader } from "./files";
import type { Header, Settings, AnalysisData } from "./types";
export interface Position {
  header: Header;
  time: Float64Array;
  x: Float32Array;
  y: Float32Array;
  dir: Float32Array;
  speed: Float32Array;
  width: number;
  height: number;
  sampleRate: number;
}
function interpolate(a: Float32Array) {
  let last = -1;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i])) continue;
    if (last < 0) a.fill(a[i], 0, i);
    else
      for (let j = last + 1; j < i; j++)
        a[j] = a[last] + ((a[i] - a[last]) * (j - last)) / (i - last);
    last = i;
  }
  if (last >= 0) a.fill(a[last], last + 1);
}
function smooth(a: Float32Array, k: number) {
  if (!k) return;
  const sum = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) sum[i + 1] = sum[i] + a[i];
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - k),
      hi = Math.min(a.length, i + k + 1);
    a[i] = (sum[hi] - sum[lo]) / (hi - lo);
  }
}
export async function parsePosition(
  file: File,
  s: Settings,
): Promise<Position> {
  const bytes = new Uint8Array(await file.arrayBuffer()),
    { header: h, offset } = parseHeader(bytes);
  if (h.pos_format !== "t,x1,y1,x2,y2,numpix1,numpix2")
    throw new Error("Unsupported LTX position format.");
  const n = parseInt(h.num_pos_samples),
    ppm = parseFloat(h.pixels_per_metre),
    rate = parseFloat(h.sample_rate),
    tb = parseFloat(h.timebase || "50");
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    offset + n * 20 > bytes.length ||
    !(ppm > 0) ||
    !(rate > 0) ||
    !(tb > 0)
  )
    throw new Error("Invalid or truncated position file.");
  const d = new DataView(bytes.buffer),
    time = new Float64Array(n),
    x1 = new Float32Array(n),
    y1 = new Float32Array(n),
    x2 = new Float32Array(n),
    y2 = new Float32Array(n);
  let prev1 = [NaN, NaN],
    prev2 = [NaN, NaN];
  for (let i = 0; i < n; i++) {
    const p = offset + i * 20;
    time[i] = d.getUint32(p) / tb;
    let a = [d.getUint16(p + 4), d.getUint16(p + 6)],
      b = [d.getUint16(p + 8), d.getUint16(p + 10)];
    if (a.some((v) => v === 1023) || !d.getUint16(p + 12)) a = [NaN, NaN];
    if (b.some((v) => v === 1023) || !d.getUint16(p + 14)) b = [NaN, NaN];
    const dist = (v: number[], w: number[]) =>
      Math.hypot(v[0] - w[0], v[1] - w[1]);
    if (
      s.leds === 2 &&
      dist(a, prev1) + dist(b, prev2) >
        dist(b, prev1) + dist(a, prev2) + ppm * 0.02
    )
      [a, b] = [b, a];
    prev1 = a;
    prev2 = b;
    x1[i] = (a[0] * 100) / ppm;
    y1[i] = (a[1] * 100) / ppm;
    x2[i] = (b[0] * 100) / ppm;
    y2[i] = (b[1] * 100) / ppm;
  }
  for (const [x, y] of [
    [x1, y1],
    [x2, y2],
  ]) {
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(x[i])) continue;
      const dt = last < 0 ? 0 : time[i] - time[last];
      if (
        last >= 0 &&
        dt > 0 &&
        s.maxSpeed > 0 &&
        Math.hypot(x[i] - x[last], y[i] - y[last]) / dt > s.maxSpeed * 100
      ) {
        x[i] = y[i] = NaN;
      } else last = i;
    }
    interpolate(x);
    interpolate(y);
    smooth(x, Math.round((s.posSmooth * rate) / 2));
    smooth(y, Math.round((s.posSmooth * rate) / 2));
  }
  const x = new Float32Array(n),
    y = new Float32Array(n),
    dir = new Float32Array(n),
    speed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dual = s.leds === 2 && Number.isFinite(x2[i]);
    x[i] = dual ? (x1[i] + x2[i]) / 2 : x1[i];
    y[i] = dual ? (y1[i] + y2[i]) / 2 : y1[i];
    dir[i] = dual
      ? Math.atan2(y2[i] - y1[i], x2[i] - x1[i])
      : i
        ? Math.atan2(y[i] - y[i - 1], x[i] - x[i - 1])
        : 0;
    const dt = i ? time[i] - time[i - 1] : 0;
    speed[i] = dt > 0 ? Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]) / dt : 0;
  }
  const width =
      ((parseFloat(h.window_max_x) - parseFloat(h.window_min_x)) * 100) / ppm,
    height =
      ((parseFloat(h.window_max_y) - parseFloat(h.window_min_y)) * 100) / ppm;
  const minX = (parseFloat(h.window_min_x || "0") * 100) / ppm,
    minY = (parseFloat(h.window_min_y || "0") * 100) / ppm;
  for (let i = 0; i < n; i++) {
    x[i] -= minX;
    y[i] -= minY;
  }
  return { header: h, time, x, y, dir, speed, width, height, sampleRate: rate };
}
function box2(a: Float32Array, w: number, h: number, k: number) {
  const o = new Float32Array(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -k; dy <= k; dy++)
        for (let dx = -k; dx <= k; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx >= 0 && xx < w && yy >= 0 && yy < h) sum += a[yy * w + xx];
        }
      o[y * w + x] = sum;
    }
  return o;
}
export function analyse(
  times: Uint32Array,
  labels: Uint16Array,
  cell: number,
  tb: number,
  duration: number,
  pos: Position | undefined,
  s: Settings,
): AnalysisData {
  let count = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] === cell) count++;
  const ids = new Uint32Array(count);
  let cursor = 0;
  for (let i = 0; i < labels.length; i++)
    if (labels[i] === cell) ids[cursor++] = i;
  const n = ids.length,
    ac = new Float32Array(100);
  let violations = 0;
  for (let i = 1; i < n; i++)
    if ((times[ids[i]] - times[ids[i - 1]]) / tb < 0.002) violations++;
  // Bounded deterministic centre sampling avoids quadratic bursts. Neighbours are never truncated.
  const stride = Math.max(1, Math.ceil(n / 20000));
  let sampledPairs = stride > 1,
    pairs = 0;
  for (let j = 0; j < n; j += stride) {
    const t = times[ids[j]];
    for (let k = j + 1; k < n; k++) {
      const dt = ((times[ids[k]] - t) / tb) * 1000;
      if (dt >= s.acWindow) break;
      if (pairs++ > 2_000_000) {
        sampledPairs = true;
        break;
      }
      ac[Math.min(99, Math.floor((dt / s.acWindow) * 100))]++;
    }
    if (pairs > 2_000_000) break;
  }
  const w = pos
      ? Math.min(200, Math.max(1, Math.ceil(pos.width / s.binCm)))
      : 0,
    h = pos ? Math.min(200, Math.max(1, Math.ceil(pos.height / s.binCm))) : 0;
  const occ = new Float32Array(w * h),
    hits = new Float32Array(w * h),
    nd = Math.ceil(360 / s.dirBin),
    ns = Math.ceil(80 / s.speedBin);
  const od = new Float32Array(nd),
    hd = new Float32Array(nd),
    os = new Float32Array(ns),
    hs = new Float32Array(ns),
    path: number[] = [],
    spikes: number[] = [];
  if (pos && w && h) {
    const bin = (i: number) => {
      const x = Math.floor((pos.x[i] / pos.width) * w),
        y = Math.floor((pos.y[i] / pos.height) * h);
      return Number.isFinite(x) && x >= 0 && x < w && y >= 0 && y < h
        ? y * w + x
        : -1;
    };
    const db = (i: number) =>
      Math.min(
        nd - 1,
        Math.floor(((pos.dir[i] + Math.PI) / (2 * Math.PI)) * nd),
      );
    const sb = (i: number) =>
      Math.min(ns - 1, Math.max(0, Math.floor(pos.speed[i] / s.speedBin)));
    for (let i = 0; i < pos.x.length; i++) {
      const b = bin(i);
      if (b < 0) continue;
      const dt =
        i + 1 < pos.time.length
          ? pos.time[i + 1] - pos.time[i]
          : 1 / pos.sampleRate;
      if (dt <= 0 || dt > 1) continue;
      occ[b] += dt;
      od[db(i)] += dt;
      os[sb(i)] += dt;
      if (i % Math.max(1, Math.ceil(pos.x.length / 12000)) === 0)
        path.push(pos.x[i] / pos.width, pos.y[i] / pos.height);
    }
    let p = 0;
    const step = Math.max(1, Math.ceil(n / 15000));
    for (let j = 0; j < n; j++) {
      const t = times[ids[j]] / tb;
      while (p + 1 < pos.time.length && pos.time[p + 1] <= t) p++;
      if (
        !pos.time.length ||
        t < pos.time[0] ||
        t > pos.time[pos.time.length - 1] + 1 / pos.sampleRate
      )
        continue;
      const b = bin(p);
      if (b < 0) continue;
      hits[b]++;
      hd[db(p)]++;
      hs[sb(p)]++;
      if (j % step === 0)
        spikes.push(pos.x[p] / pos.width, pos.y[p] / pos.height);
    }
  }
  const smOcc = box2(occ, w, h, s.smooth),
    smHits = box2(hits, w, h, s.smooth),
    spatial = new Float32Array(w * h);
  let peak = 0;
  for (let i = 0; i < spatial.length; i++) {
    spatial[i] = smOcc[i] > 0.001 ? smHits[i] / smOcc[i] : NaN;
    if (Number.isFinite(spatial[i])) peak = Math.max(peak, spatial[i]);
  }
  const direction = new Float32Array(nd),
    speed = new Float32Array(ns);
  for (let i = 0; i < nd; i++) {
    let a = 0,
      b = 0;
    for (let j = -s.smooth; j <= s.smooth; j++) {
      const k = (i + j + nd) % nd;
      a += hd[k];
      b += od[k];
    }
    direction[i] = b ? a / b : 0;
  }
  for (let i = 0; i < ns; i++) speed[i] = os[i] ? hs[i] / os[i] : 0;
  return {
    cell,
    spatial,
    width: w,
    height: h,
    peak,
    path: new Float32Array(path),
    spikes: new Float32Array(spikes),
    direction,
    speed,
    ac,
    refractory: n > 1 ? (violations / (n - 1)) * 100 : 0,
    rate: duration ? n / duration : 0,
    sampledPairs,
  };
}
