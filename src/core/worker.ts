/// <reference lib="webworker" />
/**
 * Web Worker entry: owns one Engine and answers Requests. Typed arrays in replies are transferred, not copied.
 */
import { Engine } from './engine';
import type { Request, Response } from './protocol';

let engine: Engine | null = null;
const scope = self as unknown as DedicatedWorkerGlobalScope;

function transferables(value: unknown, out: Transferable[] = [], seen = new Set<unknown>()): Transferable[] {
  if (value === null || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer && value.byteOffset === 0 && value.byteLength === value.buffer.byteLength && !out.includes(value.buffer)) out.push(value.buffer);
    return out;
  }
  for (const v of Array.isArray(value) ? value : Object.values(value)) transferables(v, out, seen);
  return out;
}

scope.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data;
  const reply = (r: Response, transfer: Transferable[] = []) => scope.postMessage(r, transfer);
  try {
    if (req.type === 'open') {
      const next = await Engine.open(req.file, req.name, { allowTruncated: req.allowTruncated, onProgress: (p) => reply({ id: req.id, progress: p }) });
      if (req.requireSignals && next.info().signals.length === 0) {
        // Keep the current recording; the page can add this file's annotations to it instead.
        throw Object.assign(new Error(`${req.name} holds only annotations (for example a hypnogram), no signals.`), { name: 'EdfError', code: 'ANNOTATIONS_ONLY' });
      }
      engine = next;
      reply({ id: req.id, ok: true, value: engine.info() });
    } else if (req.type === 'close') {
      engine = null;
      reply({ id: req.id, ok: true, value: null });
    } else {
      if (!engine) throw new Error('No recording is open.');
      const fn = (engine as any)[req.method] as (...a: unknown[]) => unknown;
      if (typeof fn !== 'function') throw new Error(`Unknown method ${req.method}.`);
      const value = await fn.apply(engine, req.args);
      reply({ id: req.id, ok: true, value }, transferables(value));
    }
  } catch (e) {
    const err = e as { name?: string; code?: string; message?: string };
    reply({ id: req.id, ok: false, error: { name: err.name ?? 'Error', code: err.code, message: err.message ?? String(e) } });
  }
};
