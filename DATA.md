# Data

## Bundled samples (`public/samples/`)

The three recordings come from PhysioNet and are licensed under the **Open Data Commons Attribution License v1.0
(ODC-By 1.0)**, which allows redistribution and derived works with attribution. Both datasets are de-identified
by their publishers (patient fields hold only sex and age, or `X`).

| File | Source | Changed? |
| --- | --- | --- |
| `S001R03.edf` | EEG Motor Movement/Imagery Dataset 1.0.0, subject S001 run 3 (64 channels, 160 Hz, EDF+ with T0/T1/T2 task annotations) | Unmodified. SHA-256 `3427c8d01bff1380bc9ab9f27a35ece2af5dfadf3e291bbc05eb66e4dadbfe2e` |
| `SC4001EC-Hypnogram.edf` | Sleep-EDF Database Expanded 1.0.0, sleep-cassette, hypnogram of SC4001 (R&K stages scored by a technician) | Unmodified. SHA-256 `a4cf67694ade1b52a0ddd06d5817fd45d2d3e8bac5302f640f3e9cfbbf12a996` |
| `SC4001E0-PSG-sleep-excerpt.edf` | Sleep-EDF Database Expanded 1.0.0, sleep-cassette `SC4001E0-PSG.edf` | **Modified**: cut to records 980 to 1799 (29400 s to 54000 s after the original start, the sleep period plus about 20 minutes either side) by `scripts/make_sleep_excerpt.py`. Data records are copied byte for byte; only the header start date, start time and record count were updated so the excerpt keeps its true clock time. Checked equal to the original slice with pyEDFlib on all 7 signals. SHA-256 `0d244dc105b1131c33517180da02bdcc60adb6ccc7006324de21bbcc2eaa3710` |

The excerpt is demo data. Correctness tests run on the unmodified originals (below).

`public/samples/sleep-preview.svg` is a fourth, derived file: the depth profile of `SC4001EC-Hypnogram.edf`
clipped to the excerpt, drawn by `scripts/make_sample_preview.py` for the start screen (same ODC-By 1.0
attribution; the SVG's own `desc` names its source).

### Attribution

- Sleep-EDF: B Kemp, AH Zwinderman, B Tuk, HAC Kamphuisen, JJL Oberyé. Analysis of a sleep-dependent neuronal
  feedback loop: the slow-wave microcontinuity of the EEG. IEEE-BME 47(9):1185-1194 (2000).
  https://ieeexplore.ieee.org/document/867928/ . Dataset: https://doi.org/10.13026/C2X676
- EEG Motor Movement/Imagery: Schalk, G. (2009). EEG Motor Movement/Imagery Dataset (version 1.0.0). PhysioNet.
  RRID:SCR_007345. https://doi.org/10.13026/C28G6P
- PhysioNet: Pollard, T., Moody, B. E., Lehman, L., Gow, B., Fernandes, C., Xie, C., Johnson, A., Mark, R. G., &
  Heldt, T. (2026). PhysioNet as a global platform for biomedical research. Nature Health.
  https://doi.org/10.1038/s44360-026-00096-z
- Licence text: https://physionet.org/content/sleep-edfx/view-license/1.0.0/ (ODC-By 1.0).

## Test data (not committed, `sh scripts/fetch-test-data.sh`)

Downloaded into `test-data/` and checked against pinned SHA-256 values.

| File | Source | Licence |
| --- | --- | --- |
| `SC4001E0-PSG.edf`, `SC4001EC-Hypnogram.edf` | PhysioNet Sleep-EDF Expanded | ODC-By 1.0 |
| `S001R01.edf`, `S001R03.edf` | PhysioNet EEG Motor Movement/Imagery | ODC-By 1.0 |
| `test_generator_2.edf`, `test_generator_2.bdf`, `test_generator.edf` | teuniz.net EDF/BDF test files (artificial waveforms) | No licence stated: fetched for testing only |
| `Newtest17-256.bdf`, `Newtest17-2048.bdf` | BioSemi BDFtestfiles.zip | No licence stated: fetched for testing only |
| `PositiveSpikes.edf` (edfcalib.zip) | edfplus.info downloads | No licence stated: fetched for testing only |

`scripts/golden/make_synthetic.py` writes the synthetic EDF+D, BDF+D and malformed files into
`test-data/synthetic/`; they contain random numbers only.
