# Third-party material

Leadline's own code is MIT. Nothing below is copied into `src/` unless the row says so.

| Piece | Licence | How it is used |
| --- | --- | --- |
| EDF, EDF+ and standard texts specs (edfplus.info), BioSemi BDF page, teuniz.net BDF+ description | Public specifications | Implemented from the text (SPEC.md). No code |
| PhysioNet Sleep-EDF Expanded and EEG Motor Movement/Imagery recordings | ODC-By 1.0 | Three files bundled in `public/samples/` with attribution (DATA.md) |
| SciPy (BSD-3-Clause) | BSD-3-Clause | Reference outputs in tests only; the filter and spectrogram maths follow its documented definitions. No code copied |
| pyEDFlib and EDFlib (BSD-3-Clause), MNE-Python (BSD-3-Clause) | BSD-3-Clause | Reference readers in the test pipeline only (Python, not shipped) |
| edfcore 0.6.325 (MIT) | MIT | Dev dependency, a second opinion in `tests/parser.test.ts`. Not shipped, no code copied |
| Barlow Semi Condensed, by The Barlow Project Authors (github.com/jpt/barlow), via github.com/google/fonts | SIL OFL 1.1 (no Reserved Font Name declared) | Base of the Sounding typeface in `fonts/` and `public/fonts/`, a Modified Version renamed throughout and kept under OFL 1.1 (`fonts/OFL.txt`). Changes listed in `scripts/fonts/build_fonts.py` |
| fontTools, brotli | MIT | Font build only (`scripts/fonts/requirements.txt`) |
| TypeScript, Vite, Vitest, playwright-core (dev tools) | Apache-2.0 / MIT | Build and test only; playwright-core drives the installed Google Chrome, no bundled browser |
| EDFbrowser | GPL-3.0 | Not used. Only its author's public test files are fetched for tests (DATA.md) |
