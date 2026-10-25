import { fileId, type Trial, type Header } from "./types";
export function textHeader(text: string): Header {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((l) => l.trim().match(/^(\S+)\s+(.+)$/))
      .filter(Boolean)
      .map((m) => [m![1], m![2]]),
  );
}
export function parseHeader(bytes: Uint8Array): {
  header: Header;
  offset: number;
} {
  const marker = new TextEncoder().encode("data_start");
  let offset = -1;
  outer: for (let i = 0; i <= bytes.length - marker.length; i++) {
    if (i && bytes[i - 1] !== 10) continue;
    for (let j = 0; j < marker.length; j++)
      if (bytes[i + j] !== marker[j]) continue outer;
    offset = i + marker.length;
    break;
  }
  if (offset < 0) throw new Error("Missing data_start marker in LTX header.");
  return {
    header: textHeader(
      new TextDecoder("latin1").decode(
        bytes.subarray(0, offset - marker.length),
      ),
    ),
    offset,
  };
}
export async function organiseFiles(
  files: File[],
  previous: Trial[] = [],
): Promise<{ trials: Trial[]; ignored: string[] }> {
  const trials = structuredClone(previous),
    map = new Map(trials.map((t) => [t.id, t]));
  const ignored: string[] = [],
    cuts: File[] = [];
  const ensure = (base: string, folder: string) => {
    const id = `${folder}/${base}`;
    if (!map.has(id)) {
      const t: Trial = { id, name: base, folder, tetrodes: [] };
      map.set(id, t);
      trials.push(t);
    }
    return map.get(id)!;
  };
  const tet = (t: Trial, n: number) => {
    let v = t.tetrodes.find((x) => x.number === n);
    if (!v) {
      v = { id: `${t.id}.${n}`, number: n, cuts: [] };
      t.tetrodes.push(v);
    }
    return v;
  };
  for (const f of files) {
    const m = f.name.match(/^(.*)\.([^.]+)$/),
      folder = (f.webkitRelativePath || "").split("/").slice(0, -1).join("/");
    if (!m) {
      ignored.push(f.name);
      continue;
    }
    const [, base, raw] = m,
      ext = raw.toLowerCase();
    if (ext === "cut" || /\.clu\.\d+$/i.test(f.name)) {
      if (!/\.temp\.clu\./i.test(f.name)) cuts.push(f);
      continue;
    }
    if (ext === "pos" || ext === "set") ensure(base, folder)[ext] = f;
    else if (/^\d+$/.test(ext) && +ext > 0 && !/\.(fet|klg)$/i.test(base))
      tet(ensure(base, folder), +ext).file = f;
    else ignored.push(f.name);
  }
  for (const f of cuts) {
    const folder = (f.webkitRelativePath || "")
      .split("/")
      .slice(0, -1)
      .join("/");
    let base: string | undefined, n: number | undefined;
    const clu = f.name.match(/^(.*)\.clu\.(\d+)$/i);
    if (clu) {
      base = clu[1];
      n = +clu[2];
    } else {
      const m = f.name.match(/^(.*?)[_.](\d+)[a-zA-Z _.-]*\.cut$/i);
      if (m) {
        base = m[1];
        n = +m[2];
      }
      const head = await f.slice(0, 65536).text(),
        embedded = head.match(/Exact_cut_for:\s*(.*?)\s+spikes:/);
      if (embedded) {
        const candidate = embedded[1]
          .replace(/^.*[\\/]/, "")
          .replace(/\.\d+$/, "");
        if (!base || !map.has(`${folder}/${base}`)) base = candidate;
      }
    }
    if (!base || !n) {
      ignored.push(`${f.name} (cannot identify trial/tetrode)`);
      continue;
    }
    const target = tet(ensure(base, folder), n),
      id = fileId(f);
    if (!target.cuts.some((c) => c.id === id))
      target.cuts.push({ id, file: f, name: f.name });
  }
  trials.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  for (const t of trials) {
    t.tetrodes.sort((a, b) => a.number - b.number);
    for (const e of t.tetrodes)
      e.cuts.sort((a, b) => b.file.lastModified - a.file.lastModified);
  }
  return { trials, ignored };
}
/** Streaming integer parser: bounded scratch space, no per-spike string objects. */
export async function readCut(file: File, n: number): Promise<Uint16Array> {
  const clu = /\.clu\.\d+$/i.test(file.name);
  let start = 0;
  if (!clu) {
    const head = new TextDecoder("latin1").decode(
        await file.slice(0, 65536).arrayBuffer(),
      ),
      m = /Exact_cut_for:\s*(.*?)\s+spikes:\s*(\d+)/.exec(head);
    if (!m)
      throw new Error(`${file.name}: missing Exact_cut_for / spikes header.`);
    if (+m[2] !== n)
      throw new Error(
        `${file.name}: ${m[2]} labels declared, but tetrode has ${n} spikes.`,
      );
    // One decoded code unit per byte preserves offsets for both UTF-8 and legacy names.
    start = m.index + m[0].length;
  }
  const out = new Uint16Array(n);
  let count = 0,
    value = 0,
    has = false,
    skip = clu;
  const emit = () => {
    if (!has) return;
    if (skip) skip = false;
    else {
      const c = value - (clu ? 1 : 0);
      if (c < 0 || c >= 1024)
        throw new Error("Cell labels must be 0–1023 (CLu is 1-based).");
      if (count >= n) throw new Error("Cut contains too many labels.");
      out[count++] = c;
    }
    value = 0;
    has = false;
  };
  for (let p = start; p < file.size; p += 1 << 20) {
    const bytes = new Uint8Array(
      await file.slice(p, p + (1 << 20)).arrayBuffer(),
    );
    for (const b of bytes) {
      if (b >= 48 && b <= 57) {
        value = value * 10 + b - 48;
        has = true;
      } else if (b === 9 || b === 10 || b === 13 || b === 32) emit();
      else throw new Error(`Invalid character in ${file.name} labels.`);
    }
  }
  emit();
  if (count !== n)
    throw new Error(`${file.name}: expected ${n} labels, found ${count}.`);
  return out;
}
