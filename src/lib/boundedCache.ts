/**
 * A small least-recently-used map: once it holds more than `maxSize` entries
 * the one used longest ago is dropped. Used for decoded audio, where each
 * entry is large (a 30s stereo FX decodes to ~11 MB) and "keep everything
 * ever played" would grow without bound over a long session.
 */
export class BoundedCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly maxSize: number) {}

  /** The entry, counted as just used; undefined when absent. */
  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** The entry without counting it as used. */
  peek(key: string): V | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
