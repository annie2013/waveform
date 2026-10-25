import { describe, it, expect } from "vitest";
import { parseHeader, organiseFiles, readCut } from "../src/files";
import { makePatch, applyPatch } from "../src/history";
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
    ).rejects.toThrow("found 2");
    await expect(
      readCut(new File(["Exact_cut_for: a spikes: 2\n0 1"], "a_1.cut"), 3),
    ).rejects.toThrow("tetrode");
  });
});
describe("undo delta integrity", () => {
  it("restores sparse and dense patches byte-for-byte through undo and redo", () => {
    for (const n of [1, 3, 10000]) {
      const before = Uint16Array.from({ length: n }, (_, i) => i % 101),
        after = before.slice();
      for (let i = 0; i < n; i += n > 3 ? 100 : 1) after[i] = 99;
      const patch = makePatch(before, after),
        live = after.slice();
      applyPatch(live, patch, false);
      expect(live).toEqual(before);
      applyPatch(live, patch, true);
      expect(live).toEqual(after);
    }
  });
});
describe("analysis", () => {
  it("normalises spike counts by dwell time and excludes self from autocorrelation", () => {
    const p = {
      header: {},
      time: new Float64Array([0, 1, 2, 3]),
      x: new Float32Array([1, 1, 8, 8]),
      y: new Float32Array([1, 1, 8, 8]),
      dir: new Float32Array(4),
      speed: new Float32Array(4),
      width: 10,
      height: 10,
      sampleRate: 1,
    };
    const r = analyse(
      new Uint32Array([100, 1100, 2100]),
      new Uint16Array([1, 1, 1]),
      1,
      1000,
      3,
      p,
      { ...defaultSettings, binCm: 5, smooth: 0 },
    );
    expect(r.spatial[0]).toBe(1);
    expect(r.spatial[3]).toBe(0.5);
    expect(r.ac.reduce((a, b) => a + b, 0)).toBe(0);
    expect(r.rate).toBe(1);
  });
});
