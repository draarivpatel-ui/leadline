/** Stable public entry of the engine. Everything a front end needs; nothing here touches the DOM. */
export { API_VERSION, Engine } from './engine';
export type {
  AnnotationItem, ChannelWindow, MontageInfo, RecordingInfo, Settings, SignalInfo, SpectrogramRequest, SpectrogramTile, WindowRequest, WindowResult,
} from './engine';
export { createEngineClient, EngineError, type EngineClient } from './client';
export { EdfError, type EdfErrorCode } from './edf/errors';
export { EdfRecording } from './edf/recording';
export { parseHeader, type EdfHeader, type SignalHeader, type Variant } from './edf/header';
export { blobSource, bytesSource, type ByteSource } from './edf/source';
export type { Annotation } from './edf/tal';
export { butter, iirnotch, sosfiltfilt, designChain, DEFAULT_FILTERS, type FilterSettings } from './dsp/iir';
export { spectrogram } from './dsp/spectrogram';
export { decimateMinMax } from './dsp/decimate';
export { buildMontages, channelKind, electrodeOf, EOG_MAX_HIGHPASS, isEegLike, isSleepRecording, parseElectrode, DOUBLE_BANANA, type ChannelKind, type Montage, type MontageId, type Derivation } from './montage';
export { buildHypnogram, stageOf, type Hypnogram, type Stage, type StageEpoch } from './hypnogram';
