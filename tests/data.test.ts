import { describe, it, expect } from "vitest";
import { parseHeader, organiseFiles } from "../src/files";
import { corePromise, decodeCut as readCut, seedEngine } from "./wasm";
import { analyse } from "../src/position";
import { defaultSettings } from "../src/types";
describe("LTX import", () => {
  it("keeps folder-scoped File identities across incremental imports", async () => {
    const f = (path: string, text = "") => {
      const file = new File([text], path.split("/").at(-1)!, {
        lastModified: 1,
      });
      Object.defineProperty(file, "webkitRelativePath", { value: path });
      return file;
    };
    const a = f("a/trial.1"),
      b = f("b/trial.1");
    const first = await organiseFiles([a, b]);
    const next = await organiseFiles(
      [f("b/trial_1.cut", "Exact_cut_for: trial spikes: 1\n2")],
      first.trials,
    );
    expect(next.trials).toHaveLength(2);
    expect(next.trials[0].tetrodes[0].file).toBe(a);
    expect(next.trials[1].tetrodes[0].file).toBe(b);
    expect(next.trials[0].tetrodes[0].cuts).toHaveLength(0);
    expect(next.trials[1].tetrodes[0].cuts).toHaveLength(1);
    const ambiguous = await organiseFiles(
      [new File(["Exact_cut_for: trial spikes: 1\n1"], "trial_1.cut")],
      next.trials,
    );
    expect(ambiguous.ignored[0]).toContain("ambiguous");
    expect(ambiguous.trials).toHaveLength(2);
  });
  it("keeps the first binary byte, including newline-valued timestamps", () => {
    const h = new TextEncoder().encode("num_spikes 1\r\ndata_start");
    const bytes = new Uint8Array(h.length + 5);
    bytes.set(h);
    bytes.set([10, 0, 0, 1, 255], h.length);
    expect(parseHeader(bytes).offset).toBe(h.length);
    expect(parseHeader(bytes).header.num_spikes).toBe("1");
  });
  it("groups incrementally and associates alternative cut suffixes", async () => {
    const file = (name: string, text = "") =>
      new File([text], name, { lastModified: 1 });
    let { trials } = await organiseFiles([
      file("a.set"),
      file("a.1"),
      file("a.2"),
      file("b.1"),
      file("a.pos"),
      file("a.egf"),
      file("a.ttl"),
    ]);
    expect(trials).toHaveLength(2);
    const r = await organiseFiles(
      [
        file("a_1 edited.cut", "Exact_cut_for: a spikes: 1\n0"),
        file("a.clu.2"),
        file("a.temp.clu.2"),
      ],
      trials,
    );
    expect(r.trials[0].tetrodes[0].cuts).toHaveLength(1);
    expect(r.trials[0].tetrodes[1].cuts).toHaveLength(1);
    expect(r.trials[0].pos?.name).toBe("a.pos");
  });
  it("validates counts and converts legacy clu labels to zero based", async () => {
    expect([
      ...(await readCut(new File(["3\n1\n2\n3\n"], "trial.clu.1"), 3)),
    ]).toEqual([0, 1, 2]);
    expect([
      ...(await readCut(
        new File(["Exact_cut_for: a spikes: 3\n0 1 100"], "a_1.cut"),
        3,
      )),
    ]).toEqual([0, 1, 100]);
    await expect(
      readCut(new File(["Exact_cut_for: a spikes: 3\n0 1"], "a_1.cut"), 3),
    ).rejects.toThrow("too few");
    await expect(
      readCut(new File(["Exact_cut_for: a spikes: 2\n0 1"], "a_1.cut"), 3),
    ).rejects.toThrow("tetrode");
  });
});
describe("undo delta integrity", () => {
  it("restores sparse and dense Rust patches byte-for-byte", async () => {
    const w = await corePromise;
    for (const n of [1, 3, 10000]) {
      const before = Uint16Array.from({ length: n }, (_, i) => i % 101),
        after = before.slice(),
        e = w.engine_new(n);
      new Uint16Array(w.memory.buffer, w.engine_labels(e), n).set(before);
      w.engine_edit_begin(e);
      for (let i = 0; i < n; i += n > 3 ? 100 : 1) after[i] = 99;
      new Uint16Array(w.memory.buffer, w.engine_labels(e), n).set(after);
      w.engine_edit_finish(e);
      const bytes = new Uint8Array(
          w.memory.buffer,
          w.engine_patch(e),
          w.engine_patch_len(e),
        ).slice(),
        p = w.alloc_bytes(bytes.length);
      new Uint8Array(w.memory.buffer, p, bytes.length).set(bytes);
      expect(w.engine_patch_apply(e, p, bytes.length, 0)).toBe(0);
      expect(
        new Uint16Array(w.memory.buffer, w.engine_labels(e), n).slice(),
      ).toEqual(before);
      expect(w.engine_patch_apply(e, p, bytes.length, 1)).toBe(0);
      expect(
        new Uint16Array(w.memory.buffer, w.engine_labels(e), n).slice(),
      ).toEqual(after);
      w.free_bytes(p, bytes.length);
      w.engine_free(e);
    }
  });
});
describe("analysis", () => {
  it("normalises spikes by dwell time and excludes self from autocorrelation in Rust", async () => {
    const w = await corePromise,
      e = seedEngine(w, [100, 1100, 2100], [1, 1, 1]),
      pos = w.position_new(4, 100, 1, 1, 0, 0, 10, 10),
      raw = new Uint8Array(80),
      d = new DataView(raw.buffer);
    for (let i = 0; i < 4; i++) {
      d.setUint32(i * 20, i);
      d.setUint16(i * 20 + 4, i < 2 ? 1 : 8);
      d.setUint16(i * 20 + 6, i < 2 ? 1 : 8);
      d.setUint16(i * 20 + 12, 12);
    }
    const p = w.alloc_bytes(raw.length);
    new Uint8Array(w.memory.buffer, p, raw.length).set(raw);
    w.position_push(pos, p, raw.length);
    w.free_bytes(p, raw.length);
    w.position_finish(pos, 1, 0, 0);
    const result = analyse(
      w,
      e,
      1,
      1000,
      3,
      { handle: pos, identity: "test", header: {} },
      { ...defaultSettings, binCm: 5, smooth: 0 },
    );
    expect(result.spatial[0]).toBe(1);
    expect(result.spatial[3]).toBe(0.5);
    expect(result.ac.reduce((a, b) => a + b, 0)).toBe(0);
    expect(result.rate).toBe(1);
    w.position_free(pos);
    w.engine_free(e);
  });
});
