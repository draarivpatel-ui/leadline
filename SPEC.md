# Leadline engine specification

What the engine reads, how it computes what the viewer draws, and which source each rule comes from. Every
source below was opened and read on 2026-11-16.

## 1. Sources

| Source | What it settles |
| --- | --- |
| EDF spec, https://www.edfplus.info/specs/edf.html (Kemp et al. 1992, Electroenceph. Clin. Neurophysiol. 82:391-393) | Header layout, 16-bit little-endian two's complement samples, digital to physical scaling by the four extremes |
| EDF+ spec, https://www.edfplus.info/specs/edfplus.html (Kemp and Olivan 2003, Clin. Neurophysiol. 114:1755-1761) | `EDF+C` / `EDF+D`, the 12 additional specs, the `EDF Annotations` signal, TAL syntax, record time-keeping, 1985 clipping year |
| EDF+ standard texts, https://www.edfplus.info/specs/edftexts.html | Electrode names (10-20, and 10-10 aliases T7/T8/P7/P8 = T3/T4/T5/T6), sleep stage texts, `@@` channel links |
| EDF FAQ and downloads, https://www.edfplus.info/specs/edffaq.html, /downloads/index.html | Calibration and example files (edfcalib.zip) |
| BioSemi BDF, https://www.biosemi.com/faq/file_format.htm | BDF version bytes 0xFF + `BIOSEMI`, `24BIT` reserved field, 24-bit little endian samples, Status channel last |
| BDF+ description, https://www.teuniz.net/edfbrowser/bdfplus%20format%20description.html | `BDF+C` / `BDF+D`, `BDF Annotations` label, annotation digital range -8388608..8388607 (the edfplus.info BDF+ page returns 404) |
| pyEDFlib 0.1.42 (BSD-3-Clause), wraps EDFlib (C) | Reference reader for tests: physical = bitValue * (offset + digital), offset = pmax / bitValue - dmax |
| MNE-Python 1.8.0 (BSD-3-Clause), `mne/io/edf/edf.py` | Second reference. Reads TALs with a regex, converts to volts, resamples lower-rate channels to the highest rate |
| SciPy 1.13.1 documentation and behaviour (`butter`, `iirnotch`, `sosfiltfilt`, `filtfilt`, `sosfilt_zi`, `spectrogram`) | The exact filter and spectrogram definitions the engine reproduces |
| edfcore 0.6.325 (MIT), https://github.com/tayal-sarthak/edfcore | Independent TypeScript reader used only as a test oracle (dev dependency) |
| EDFbrowser (GPL-3) by Teunis van Beelen | Behaviour reference only (its test files). No code read or copied, because GPL code cannot go into an MIT repo |

### How other readers do it (prior art)

- **EDFlib / pyEDFlib**: reads EDF, EDF+, BDF, BDF+ continuous files. Refuses discontinuous files outright
  ("The file is discontinuous and cannot be read", checked on our synthetic EDF+D). Annotation onsets in 100 ns
  ticks. A missing annotation duration is returned as -1.
- **MNE-Python**: opens EDF+D but treats it as continuous (gaps are dropped, samples are concatenated), and on our
  synthetic EDF+D it returned 2 of the 6 annotations. Converts uV to V, resamples lower-rate channels by
  interpolation to the highest rate. So MNE is compared only on channels at the highest rate, with a tolerance.
- **edfcore** (MIT, TypeScript): random access through byte sources, full record index for EDF+D gaps, refuses a
  seconds-to-record mapping until the index is built. Agrees with us on every file tested (section 7).
- **Pixpipe/edfdecoder** (MIT, 2022), **somnonetz/copla-editor** (MIT, 2023), **mleprince/web-edf-viewer**
  (MIT, 2023): browser EDF readers that load the whole file into an ArrayBuffer; no BDF+D or windowed reads.
  **BilalZonjy/EDFViewer** has no licence and was not read. None of these is copied.

Leadline has its own parser because the viewer needs record-level control of Blob slices for pixel-width window
reads, and because a parser that is checked sample for sample against pyEDFlib is part of the deliverable.

## 2. File structure

Header record: 256 fixed bytes, then 256 bytes per signal, all US-ASCII padded with spaces (NUL padding is also
accepted). Fields in order and widths:

| Bytes | Field |
| --- | --- |
| 8 | version: `0` (EDF) or 0xFF `BIOSEMI` (BDF) |
| 80 | local patient identification (EDF+: code, sex, birthdate, name, extra) |
| 80 | local recording identification (EDF+: `Startdate dd-MMM-yyyy`, admin code, technician, equipment, extra) |
| 8 + 8 | start date `dd.mm.yy`, start time `hh.mm.ss` |
| 8 | header bytes, must equal 256 * (ns + 1) |
| 44 | reserved: `EDF+C`, `EDF+D`, `BDF+C`, `BDF+D`, `24BIT`, or anything for plain EDF |
| 8 | number of data records (-1 only while recording) |
| 8 | duration of a data record in seconds |
| 4 | ns, number of signals |
| ns x (16, 80, 8, 8, 8, 8, 8, 80, 8, 32) | label, transducer, physical dimension, physical min, physical max, digital min, digital max, prefiltering, samples per record, reserved |

Data records follow, each holding `samples per record` samples of signal 1, then signal 2, and so on. EDF
samples are 2 bytes, BDF samples 3 bytes, both little endian two's complement (BDF: sign-extend bit 23).

### Start date and year

EDF+ item 2: two-digit years use 1985 as the clipping year (85..99 are 1985..1999, 00..84 are 2000..2084). When
an EDF+ recording field starts with `Startdate dd-MMM-yyyy`, its four-digit year wins (item 4). Times are local
wall-clock time of the recording site with no time zone, so the engine keeps them zone-less.

## 3. Digital to physical

`bitValue = (pmax - pmin) / (dmax - dmin)`, `offset = pmax / bitValue - dmax`,
`physical = bitValue * (offset + digital)`.

This is the same arithmetic order EDFlib uses. Measured on the test files: this order reproduces pyEDFlib's
float64 output bit for bit, while the algebraically equal `(d - dmin) * bitValue + pmin` differs by up to
2e-12 on BioSemi files. The display path stores float32; the `readPhysical` path returns float64.

## 4. EDF+ annotations and time

- An `EDF Annotations` (EDF+) or `BDF Annotations` (BDF+) signal carries bytes, not samples, and only its label
  and samples per record are meaningful. Annotation signals are only recognised in `+` files.
- TAL: `Onset [0x15 Duration] 0x14 text 0x14 [text 0x14 ...] 0x00`. Onset starts with `+` or `-`. Texts are
  UTF-8. Unused bytes are 0x00.
- The first annotation of the first TAL of the first annotation signal in every record is empty; its onset is
  that record's start time (section 2.2.4). Further texts in that TAL are real annotations.
- EDF+C: record times are taken from the time-keeping TALs. A `+C` file whose TALs are not contiguous opens with
  a warning and the recorded times are used. EDF+D: every record must have a time-keeping TAL, else
  `NO_TIMEKEEPING`. Records that go back in time are `BAD_TAL`.
- Malformed TALs never throw: the TAL is skipped and a warning is added (a broken annotation should not hide the
  signals). A TAL that runs to the end of its record without 0x00 is reported the same way.
- A separate annotation file (EDF+ derived file, section 2.3, for example a Sleep-EDF hypnogram) is aligned by the
  difference of the two header start times.

### Time grid and gaps

Each signal is read on a uniform grid of its own sample rate, anchored on the sample times of the first record
touched by a window. Records are placed at `round((recordOnset - gridStart) * fs)`; in EDF+D files with onsets
that are not on the grid this moves a record by less than half a sample. Two records are contiguous when the next
onset is within half a sample of the fastest signal (at least 1e-7 s) of the previous record's end: the
8-character duration field cannot hold every duration exactly (1/30 s is written `0.033333` or `0.033334`). Samples in a gap are NaN.

## 5. Validation and errors

`EdfError.code` is stable:

| Code | When |
| --- | --- |
| `TOO_SHORT` | under 256 bytes, or the file ends inside its header |
| `BAD_VERSION` | version is neither `0` nor 0xFF `BIOSEMI` |
| `BAD_FIELD` | a number field is not a number (decimal comma, letters), date or time not parseable or out of range, record count below -1 |
| `HEADER_SIZE_MISMATCH` | header bytes field differs from 256 * (ns + 1) |
| `NO_SIGNALS` | ns below 1, or a data record with no samples |
| `BAD_SIGNAL` | digital max not above digital min, physical min equal to physical max, an ordinary signal with no samples per record |
| `BAD_RECORD_DURATION` | duration 0 or negative while the file has ordinary signals (0 is allowed for annotation-only files, EDF+ 2.1.2) |
| `TRUNCATED` | fewer complete records than the header promises (open with `allowTruncated` to read the complete ones) |
| `NO_TIMEKEEPING` | an EDF+/BDF+ file with no annotation signal, or EDF+D records without time-keeping |
| `BAD_TAL` | records that go back in time |

Warnings (opens, but says so): record count -1 (count taken from the file size), bytes after the last record,
digital range wider than the sample width, EDF+ recording field without `Startdate`, malformed TALs.

## 6. Signal processing

All filters are zero phase (forward and backward), because a viewer must not shift spikes in time.

| Filter | Definition (SciPy equivalent) |
| --- | --- |
| High-pass | `sosfiltfilt(butter(order, fc, 'highpass', fs=fs, output='sos'), x)` |
| Low-pass | `sosfiltfilt(butter(order, fc, 'lowpass', fs=fs, output='sos'), x)` |
| Notch 50/60 Hz | `filtfilt(*iirnotch(f0, Q, fs=fs), x)`, Q = 30 by default |
| Chain | high-pass, then low-pass, then notch, each as above. Default order 2 (4 after the zero-phase doubling) |

Which channels are filtered. The display filters are for EEG, so each derivation has a kind
(`src/core/montage.ts`, `channelKind`), and the chain is chosen by rate and kind:
- `other`, drawn exactly as recorded: a unit that is not a voltage (degC, %, bpm, Boolean, empty; the test is `/V$/i`, so uV, uv, UV and µV
  are all voltages),
  a rate below 32 Hz, or a label that starts with a non-EEG EDF+ standard-text type or common PSG name as a whole
  word (ECG, EKG, EMG, Resp, Temp, Event, SaO2, SpO2, Pleth, Status and others), after a leading `EEG ` is
  stripped (TUH `EEG EKG1-REF` is `other`). `skippedFilters` then holds
  `all filters (not an EEG channel)`. The page uses the same voltage and rate rule for its scaling.
- `eog` (labels starting EOG, LOC or ROC, or the AASM `E1` or `E2` on an M1, M2, A1 or A2 reference, such as
  `E1-M2`; bare `E1` stays EEG): the same chain, but a high-pass above 0.3 Hz is lowered to 0.3 Hz, the
  AASM EOG setting, so slow eye movements survive; `skippedFilters` says so (`high-pass 1 Hz (EOG keeps 0.3 Hz)`).
- `eeg`: everything else at an EEG rate, including bare electrode names (`Fc5.`, BioSemi `A1`, EGI `E1`). Bipolar
  and average derivations are EEG by construction.
The page tags a row `raw` when it got none of the chosen filters and `part` when it missed some, lists them in the
row's title, and after a filter or montage change says in one line which filters were not applied.
Defaults on the page: a sleep recording opens at 0.3 to 35 Hz, other EEG at
1 to 70 Hz (a zero-phase order 2 high-pass at 1 Hz draws a 0.5 Hz wave at 6% of its amplitude, which hides N3
slow waves). A recording is sleep (`isSleepRecording`) when it has scored stages, or an EOG row together with a
signal only a sleep study records (chin, submental or leg EMG, airflow, oximetry, breathing effort, snoring). An
eye channel alone is not enough: routine clinical EEG often carries EOG, LOC or ROC, and bare `EMG` and `Resp` rows
too (TUH `EMG-REF`, `EEG RESP1-REF`), so none of those counts. Kinds and this rule come from labels only. The EEG sample rate is not used.
Once the user picks a filter, later files keep it.

Each request takes the montage and filter chains once, before its first read, so a settings change while a window
or a whole-night spectrogram is being read never mixes two settings.

Design: Butterworth analog prototype poles `-exp(j*pi*m/(2N))`, prewarped cutoff `4*tan(pi*Wn/2)`, bilinear
transform with fs = 2, poles paired into biquads, unit passband gain. Zero-phase: odd extension of
`3 * (2 * sections + 1 - trailing zero sections)` samples on each side (SciPy's default `padlen`), initial
state `sosfilt_zi * first sample` for each pass. A filter whose cutoff is at or above a channel's Nyquist frequency
is skipped for that channel and reported in `skippedFilters`.

Windowed filtering. Filtering only the visible 30 s would differ from filtering the whole recording near the window
edges. The engine reads a margin on each side equal to the number of samples after which the slowest pole of the
chain has decayed to 1e-6 (`settleSamples`, from the pole radii), capped at 120 s, then discards it. Tested: the
windowed result equals SciPy on the whole signal to 1e-4 of the signal peak. Filters run on each gap-free run
separately, so nothing is smeared across an EDF+D gap.

Montages:
- As recorded: every ordinary signal.
- Bipolar double banana: Fp1-F7, F7-T3, T3-T5, T5-O1, Fp2-F8, F8-T4, T4-T6, T6-O2, Fp1-F3, F3-C3, C3-P3, P3-O1,
  Fp2-F4, F4-C4, C4-P4, P4-O2, Fz-Cz, Cz-Pz. A pair is built only if both electrodes exist with the same rate and
  unit. Labels are read leniently (`EEG Fp1-REF`, `Fp1-LE`, `C3-A2`, `Fc5.`); bipolar labels such as `Fpz-Cz`
  are not single electrodes and are left out.
- Average reference: each scalp electrode minus the mean of the largest group of scalp electrodes sharing a rate,
  unit and reference (ear and mastoid electrodes excluded); needs at least 3.
- References: the reference a label names (`C3-A2` is A2, `Fp1-REF` and a bare `Fz` are the common reference) is
  kept. A bipolar pair is built only when both electrodes share it. When a file mixes references, the montage note
  says so and names what was left out (shown on the File tab, in the montage option's title and when chosen).

Drawing: min/max decimation. Each pixel column keeps the lowest and highest sample of its time span, so a
one-sample spike stays visible at any zoom. When a window has at most 2 samples per column, raw samples are
returned instead.

Spectrogram: `scipy.signal.spectrogram(x, fs, window='hann', nperseg, noverlap, nfft, detrend='constant',
scaling='density', mode='psd')`: periodic Hann window, segment mean removed, one-sided PSD in unit^2/Hz, returned
as 10*log10. `nfft` is the next power of two at or above `nperseg` (radix-2 FFT). Long ranges are computed in
chunks of about 10 minutes, keeping only the bins up to `fmax`, and can be averaged (in linear power) down to a
column count. Segments that touch a gap are NaN.

Hypnogram: from annotations whose text is `Sleep stage W/1/2/3/4/R/?/N/N1/N2/N3` or `Movement time`. R&K stage 4
is kept as its own stage (N4) rather than merged into N3, so nothing is reinterpreted. A stage without a duration
lasts until the next stage annotation.

## 7. Verification

The README (Tested against) has the exact commands and counts. Summary:
- 11 real or third-party files (Sleep-EDF PSG and hypnogram, EEG Motor Movement/Imagery, teuniz EDF+ and BDF+
  generators, the old EDF generator, two BioSemi BDF files, the edfplus.info PositiveSpikes file) plus one
  synthetic EDF+C: SHA-256 of every signal's full digital (int32) and physical (float64) array equals pyEDFlib's.
  Annotation onsets within 1e-7 s, durations and texts identical.
- MNE-Python: physical values times the unit scale agree to 1e-9 relative on all highest-rate channels (BioSemi
  Status excluded).
- EDF+D and BDF+D: pyEDFlib refuses them, so the truth is the independent Python writer
  (`scripts/golden/make_synthetic.py`) plus edfcore's record index: record onsets, segments, annotations (including
  a negative onset and UTF-8 text) and digital values all agree.
- 12 malformed files: each fails with its expected code or opens with a warning; none hangs.
- Filters and spectrogram: equal to SciPy to 1e-9 relative on real EEG (5 Butterworth designs including odd
  orders, two notches, the full chain, three spectrogram settings).

## 8. Limits

- No writing of EDF files. No EDF+ `@@` channel links in the UI (texts are kept as is).
- Annotations are only recognised in `+` files; a plain EDF signal labelled `EDF Annotations` is drawn as a signal.
- Channel kinds come from labels, units and rates; a non-EEG channel with an EEG-like label, voltage unit and EEG
  rate is filtered as EEG.
- The BioSemi Status channel is drawn as a number, not decoded into trigger bits.
- Not a medical device; nothing here is validated for diagnosis.
