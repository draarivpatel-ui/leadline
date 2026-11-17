import { createHash } from 'node:crypto';
import { existsSync, openAsBlob, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blobSource } from '../src/core/edf/source';

export const DATA = join(import.meta.dirname, '..', 'test-data');
export const hasData = existsSync(join(DATA, 'golden.json'));
export const hasFilterGolden = existsSync(join(DATA, 'golden-dsp.json'));

export function golden(): Record<string, any> {
  return JSON.parse(readFileSync(join(DATA, 'golden.json'), 'utf8'));
}

export async function fileSource(name: string) {
  return blobSource(await openAsBlob(join(DATA, name)));
}

export function sha256(view: ArrayBufferView): string {
  return createHash('sha256').update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)).digest('hex');
}
