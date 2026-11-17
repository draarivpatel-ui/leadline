/**
 * Random access to bytes. A browser File or Blob is read with Blob.slice, so a large recording is never loaded
 * whole: only the byte ranges a window needs are read.
 */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    async read(offset, length) {
      const end = Math.min(blob.size, offset + length);
      if (offset >= end) return new Uint8Array(0);
      return new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    },
  };
}

export function bytesSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      const end = Math.min(bytes.byteLength, offset + length);
      if (offset >= end) return new Uint8Array(0);
      return bytes.subarray(offset, end);
    },
  };
}
