/**
 * Page-side handle on the engine Worker. Every method returns a Promise; errors keep their EdfError code.
 *
 *   const eeg = createEngineClient(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
 *   const info = await eeg.open(file);
 *   const win = await eeg.readWindow({ start: 0, duration: 30, width: 1600 });
 */
import type { RecordingInfo } from './engine';
import type { EngineApi, EngineMethod, Request, Response } from './protocol';

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

export class EngineError extends Error {
  readonly code?: string;
  constructor(name: string, message: string, code?: string) {
    super(message);
    this.name = name;
    this.code = code;
  }
}

export interface EngineClient extends EngineApi {
  open(file: Blob, options?: { name?: string; allowTruncated?: boolean; requireSignals?: boolean; onProgress?: (fraction: number) => void }): Promise<RecordingInfo>;
  close(): Promise<void>;
  terminate(): void;
}

export function createEngineClient(worker: Worker): EngineClient {
  let next = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; progress?: (p: number) => void }>();
  worker.onmessage = (ev: MessageEvent<Response>) => {
    const r = ev.data;
    const p = pending.get(r.id);
    if (!p) return;
    if ('progress' in r) {
      p.progress?.(r.progress);
      return;
    }
    pending.delete(r.id);
    if (r.ok) p.resolve(r.value);
    else p.reject(new EngineError(r.error.name, r.error.message, r.error.code));
  };
  worker.onerror = (ev) => {
    for (const p of pending.values()) p.reject(new EngineError('WorkerError', ev.message || 'The engine worker failed.'));
    pending.clear();
  };
  const send = <T>(req: DistributiveOmit<Request, 'id'>, progress?: (p: number) => void) =>
    new Promise<T>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject, progress });
      worker.postMessage({ ...req, id });
    });
  const call = (method: EngineMethod) => (...args: unknown[]) => send({ type: 'call', method, args });
  const methods: EngineMethod[] = ['info', 'getSettings', 'setSettings', 'channels', 'annotations', 'addAnnotationFile', 'hypnogram', 'readWindow', 'spectrogram'];
  const api = Object.fromEntries(methods.map((m) => [m, call(m)])) as unknown as EngineApi;
  return {
    ...api,
    open: (file, o = {}) =>
      send<RecordingInfo>({ type: 'open', file, name: o.name ?? (file as File).name ?? 'recording', allowTruncated: o.allowTruncated, requireSignals: o.requireSignals }, o.onProgress),
    close: () => send<void>({ type: 'close' }),
    terminate: () => worker.terminate(),
  };
}
