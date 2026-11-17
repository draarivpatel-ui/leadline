import type { ByteSource } from './source';

/**
 * Serves reads from aligned blocks kept in a small least-recently-used cache, so scrolling back and forth over a
 * recording re-reads nothing. Reads larger than the cache bypass it.
 */
export function cachedSource(inner: ByteSource, blockBytes = 1 << 20, maxBlocks = 64): ByteSource {
  const blocks = new Map<number, Promise<Uint8Array>>();
  const get = (b: number) => {
    let p = blocks.get(b);
    if (p) {
      blocks.delete(b);
      blocks.set(b, p);
      return p;
    }
    p = inner.read(b * blockBytes, blockBytes);
    p.catch(() => blocks.delete(b));
    blocks.set(b, p);
    while (blocks.size > maxBlocks) blocks.delete(blocks.keys().next().value as number);
    return p;
  };
  return {
    size: inner.size,
    async read(offset, length) {
      const end = Math.min(inner.size, offset + length);
      if (offset >= end) return new Uint8Array(0);
      const first = Math.floor(offset / blockBytes);
      const last = Math.floor((end - 1) / blockBytes);
      if (last - first + 1 > maxBlocks / 2) return inner.read(offset, end - offset);
      const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, i) => get(first + i)));
      if (parts.length === 1) return parts[0].subarray(offset - first * blockBytes, end - first * blockBytes);
      const out = new Uint8Array(end - offset);
      let w = 0;
      parts.forEach((p, i) => {
        const b = first + i;
        const s = Math.max(offset, b * blockBytes) - b * blockBytes;
        const e = Math.min(end, (b + 1) * blockBytes) - b * blockBytes;
        out.set(p.subarray(s, e), w);
        w += e - s;
      });
      return out;
    },
  };
}
