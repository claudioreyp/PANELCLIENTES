export type QuerySnapshot<T> = { data: T | null; loading: boolean; error: string | null };
type Entry<T> = {
  snapshot: QuerySnapshot<T>; version: number; updatedAt: number;
  listeners: Set<() => void>; refreshers: Set<() => void>;
  pending?: Promise<void>; gc?: ReturnType<typeof setTimeout>;
};
export const QUERY_IDLE_MS = 5 * 60_000;

export class QueryCache {
  private entries = new Map<string, Entry<unknown>>();
  private disposed = false;

  entry<T>(key: string): Entry<T> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { snapshot: { data: null, loading: true, error: null }, version: 0, updatedAt: 0, listeners: new Set(), refreshers: new Set() };
      this.entries.set(key, entry);
    }
    return entry as Entry<T>;
  }

  subscribe(key: string, listener: () => void, refresh: () => void) {
    const entry = this.entry(key);
    clearTimeout(entry.gc);
    entry.listeners.add(listener);
    entry.refreshers.add(refresh);
    return () => {
      entry.listeners.delete(listener);
      entry.refreshers.delete(refresh);
      if (!entry.listeners.size) entry.gc = setTimeout(() => {
        entry.version++;
        this.entries.delete(key);
      }, QUERY_IDLE_MS);
    };
  }

  private publish<T>(entry: Entry<T>, snapshot: QuerySnapshot<T>) {
    entry.snapshot = snapshot;
    entry.listeners.forEach((listener) => listener());
  }

  async fetch<T>(key: string, loader: () => Promise<T>, maxAge = 0): Promise<void> {
    if (this.disposed) return;
    const entry = this.entry<T>(key);
    if (entry.pending) return entry.pending;
    if (maxAge && entry.updatedAt && Date.now() - entry.updatedAt < maxAge) return;
    const version = ++entry.version;
    this.publish(entry, { ...entry.snapshot, loading: entry.snapshot.data === null });
    const pending = new Promise<T>((resolve) => resolve(loader())).then((data) => {
      if (this.disposed || version !== entry.version) return;
      entry.updatedAt = Date.now();
      this.publish(entry, { data, loading: false, error: null });
    }, (caught: unknown) => {
      if (this.disposed || version !== entry.version) return;
      const status = (caught as { status?: number })?.status;
      this.publish(entry, {
        data: status === 401 || status === 403 ? null : entry.snapshot.data,
        loading: false, error: caught instanceof Error ? caught.message : "No se pudo actualizar la información",
      });
    }).finally(() => { if (entry.pending === pending) entry.pending = undefined; });
    entry.pending = pending;
    return pending;
  }

  set<T>(key: string, update: T | null | ((previous: T | null) => T | null)) {
    if (this.disposed) return;
    const entry = this.entry<T>(key);
    entry.version++;
    entry.pending = undefined;
    entry.updatedAt = Date.now();
    const data = typeof update === "function" ? (update as (value: T | null) => T | null)(entry.snapshot.data) : update;
    this.publish(entry, { data, loading: false, error: null });
  }

  invalidate() {
    for (const entry of this.entries.values()) {
      entry.updatedAt = 0;
      entry.version++;
      entry.pending = undefined;
      entry.refreshers.forEach((refresh) => refresh());
    }
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) { clearTimeout(entry.gc); entry.version++; }
    this.entries.clear();
  }
}
