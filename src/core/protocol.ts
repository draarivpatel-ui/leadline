/** Messages between the page and the engine Worker. */
import type { Engine } from './engine';

export type EngineMethod = 'info' | 'getSettings' | 'setSettings' | 'channels' | 'annotations' | 'addAnnotationFile' | 'hypnogram' | 'readWindow' | 'spectrogram';

export type Request =
  | { id: number; type: 'open'; file: Blob; name: string; allowTruncated?: boolean; requireSignals?: boolean }
  | { id: number; type: 'call'; method: EngineMethod; args: unknown[] }
  | { id: number; type: 'close' };

export type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { name: string; code?: string; message: string } }
  | { id: number; progress: number };

export type EngineApi = { [K in EngineMethod]: (...args: Parameters<Engine[K]>) => Promise<Awaited<ReturnType<Engine[K]>>> };
