export interface Patch {
  kind: "sparse" | "dense";
  before: Uint16Array;
  after: Uint16Array;
  indices?: Uint32Array;
}
export function makePatch(before: Uint16Array, after: Uint16Array): Patch {
  let count = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) count++;
  if (count * 8 >= before.byteLength * 2)
    return { kind: "dense", before, after: after.slice() };
  const indices = new Uint32Array(count),
    a = new Uint16Array(count),
    b = new Uint16Array(count);
  let j = 0;
  for (let i = 0; i < before.length; i++)
    if (before[i] !== after[i]) {
      indices[j] = i;
      a[j] = before[i];
      b[j++] = after[i];
    }
  return { kind: "sparse", indices, before: a, after: b };
}
export function applyPatch(labels: Uint16Array, p: Patch, redo: boolean) {
  const values = redo ? p.after : p.before;
  if (p.kind === "dense") labels.set(values);
  else
    for (let j = 0; j < values.length; j++) labels[p.indices![j]] = values[j];
}
export async function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("waveform-v2", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("data");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function put(
  db: IDBDatabase,
  key: string,
  value: unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("data", "readwrite");
    tx.objectStore("data").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Storage transaction aborted."));
  });
}
export async function get<T>(
  db: IDBDatabase,
  key: string,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const r = db.transaction("data").objectStore("data").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
