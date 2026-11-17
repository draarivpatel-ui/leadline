---
name: Leadline
description: EEG and sleep recordings read as a nautical chart of soundings, in the browser, with nothing uploaded.
colors:
  water: "#fcfdfb"
  land: "#eadfc2"
  land-2: "#f3edda"
  land-rule: "#cfc3a3"
  ink: "#18222e"
  ink-2: "#44515e"
  ink-3: "#66727d"
  grid: "#e3e9ec"
  grid-strong: "#c9d5db"
  depth-1: "#e2eef3"
  depth-2: "#c3dbe6"
  depth-3: "#98bfd3"
  depth-4: "#6a9cba"
  depth-5: "#3b6f95"
  depth-6: "#1f4a6c"
  abyss: "#0d2238"
  mark: "#a3137a"
  mark-soft: "#f6e3ef"
  warn: "#8a4b00"
  warn-soft: "#fbeedb"
  focus: "#1f4a6c"
typography:
  display:
    fontFamily: "Sounding, 'Barlow Semi Condensed', 'Arial Narrow', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "0.005em"
  wordmark:
    fontFamily: "Sounding, 'Barlow Semi Condensed', 'Arial Narrow', sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.01em"
  title:
    fontFamily: "Sounding, 'Barlow Semi Condensed', 'Arial Narrow', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.2
  title-sm:
    fontFamily: "Sounding, 'Barlow Semi Condensed', 'Arial Narrow', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.2
  clock:
    fontFamily: "Sounding, 'Barlow Semi Condensed', 'Arial Narrow', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1
  tab:
    fontFamily: "Sounding, 'Barlow Semi Condensed', 'Arial Narrow', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1
  channel:
    fontFamily: "Sounding, 'Barlow Semi Condensed', 'Arial Narrow', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1
  label:
    fontFamily: "Sounding, 'Barlow Semi Condensed', 'Arial Narrow', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.02em"
  axis:
    fontFamily: "Sounding, 'Barlow Semi Condensed', 'Arial Narrow', sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1
  notice:
    fontFamily: "Sounding, 'Barlow Semi Condensed', 'Arial Narrow', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.03em"
  annotation:
    fontFamily: "Sounding, 'Barlow Semi Condensed', 'Arial Narrow', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.25
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  body-sm:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  control:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1
  readout:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "tnum"
rounded:
  xs: "3px"
  sm: "4px"
  field: "5px"
  md: "6px"
  lg: "8px"
  xl: "10px"
spacing:
  "2": "2px"
  "4": "4px"
  "6": "6px"
  "8": "8px"
  "10": "10px"
  "12": "12px"
  "14": "14px"
  "16": "16px"
  bar-h: "56px"
  labels-w: "136px"
  labels-w-phone: "92px"
  panel-w: "280px"
  panel-w-narrow: "248px"
  row-min: "18px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.water}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.depth-6}"
  button-primary-active:
    backgroundColor: "#0f1720"
  button-secondary:
    backgroundColor: "{colors.water}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "#ffffff"
  button-secondary-active:
    backgroundColor: "{colors.depth-1}"
  button-icon:
    rounded: "{rounded.md}"
    width: "34px"
    height: "34px"
  button-large:
    typography: "{typography.body}"
    padding: "0 18px"
    height: "44px"
  select:
    backgroundColor: "{colors.water}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.field}"
    padding: "0 26px 0 8px"
    height: "30px"
  stepper-output:
    backgroundColor: "{colors.water}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    width: "48px"
    height: "30px"
  tab:
    textColor: "{colors.ink-2}"
    typography: "{typography.tab}"
    padding: "11px 8px 9px"
  tab-selected:
    textColor: "{colors.ink}"
  menu:
    backgroundColor: "{colors.water}"
    rounded: "{rounded.lg}"
    padding: "6px"
    width: "300px"
  menu-item-hover:
    backgroundColor: "{colors.depth-1}"
  start-card:
    backgroundColor: "{colors.water}"
    rounded: "{rounded.xl}"
    padding: "36px 36px 30px"
    width: "620px"
  channel-label:
    backgroundColor: "{colors.land-2}"
    textColor: "{colors.ink}"
    typography: "{typography.channel}"
    padding: "0 8px 0 12px"
    width: "{spacing.labels-w}"
  annotation-item:
    textColor: "{colors.mark}"
    typography: "{typography.annotation}"
    rounded: "{rounded.sm}"
    padding: "6px 4px"
  annotation-item-hover:
    backgroundColor: "{colors.mark-soft}"
  notice:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    typography: "{typography.readout}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  status-chip:
    backgroundColor: "{colors.land}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "3px 8px"
---

# Design System: Leadline

## Overview

**Creative North Star: "The Chart of Soundings"**

A recording is read the way a navigator reads an Admiralty chart and its tide table. The traces sit on open water, chart white and quiet; everything that is furniture (the top bar, the channel label margin, the chart strip, the panel tabs) sits on a buff land tint at the edge. Sleep depth is literal depth: the hypnogram is drawn as a bathymetric profile, water from the surface (wake) down to the stage depth, tinted in depth zones, land below a stepped seabed line. That profile is also the navigator, and the spectrogram lies under it on the same time axis in the same depth blues.

The system is dense, flat and exact. Every mark on screen is computed from the file; nothing is decorative data. Color carries meaning by material (water, land, depth, ink, magenta for what the file says), not by brand. Type is chart lettering: a custom condensed face, Sounding, names things on the chart; system UI carries prose, controls and values; every figure is tabular. Motion is almost absent: 150 ms color changes on hover, nothing that moves on its own, nothing that flashes.

The world refuses two pictures of an EEG tool: the black oscilloscope screen with green traces, and the grey dashboard with one blue accent.

**Key Characteristics:**
- Open water ground for data, land tint for furniture, a hairline land rule between them.
- Six depth blues that only ever mean depth: sleep stage, spectral power, selection.
- Chart ink navy for traces, text and the primary action.
- Chart magenta only for marks the recording file carries.
- Sounding upright for chart lettering, its sloped cut for annotation text, system UI for everything read as prose.
- Tabular figures everywhere data shows; one row height for every channel.
- Flat surfaces; shadows only on things that float above the chart.

## Colors

A chart palette: white water, buff land, six soundings of blue, navy ink and one reserved magenta.

### Primary
- **Chart Ink** (ink): the traces (1px), body text, the wordmark, the seabed line of the depth profile, the viewport bracket, and the fill of the one primary button (Open, Choose files). Its hover is Deep Sounding (depth-6) and its press a darker ink (#0f1720).

### Secondary
- **First Sounding to Deep Sounding** (depth-1 to depth-6): the depth zones of the hypnogram, pale at the surface and deepest at stage 4 or N3; the spectrogram ramp from water through all six to Abyss; and selection states (text selection uses depth-2, menu and list hover and the pressed panel toggle use depth-1). Depth-5 is the wordmark's sounding mark and the drop overlay border; depth-6 doubles as the focus ring (focus).
- **Abyss** (abyss): the last stop of the spectrogram ramp only, the most power at a frequency relative to its median.

### Tertiary
- **Chart Magenta** (mark): annotation onsets as hairlines across the traces at 80% opacity, their sloped labels on a 92% water plate, ticks on the depth profile, and the annotation text in the panel list.
- **Magenta Tint** (mark-soft): annotation spans as a 20px band along the top of the trace field, spans in the annotation lane when a file has no stages, and the hover of an annotation list row.

### Neutral
- **Open Water** (water): the trace field, the panel body, the spectrogram floor, cards, menus, fields and secondary buttons.
- **Land** (land): the top bar, the depth profile ground below the seabed, the status chip.
- **Pale Land** (land-2): the channel label margin, the chart strip, the panel tab row, the start screen backdrop, and unscored epochs in the depth profile.
- **Land Rule** (land-rule): every border between land and water, field and button strokes, scrollbar thumbs.
- **Ink 2** (ink-2): secondary text on land and water (field labels, axes, idle scale readouts, inactive tabs), the channel scale bar and the dashed cursor line.
- **Ink 3** (ink-3): tertiary text on water only (annotation durations, empty states) and the hover stroke of fields and buttons.
- **Grid and Strong Grid** (grid, grid-strong): the time grid on the traces; strong lines every fifth step, at every 30 s epoch, and between bipolar chains; card and sample list rules on the start screen.
- **Notice Amber and Amber Tint** (warn, warn-soft): parser warnings, file notes, start errors and the "Not for diagnosis" note. This is the only status color.

Measured contrast: ink on water 15.8:1, ink-2 on land 6.1:1, ink-3 on water 4.8:1, magenta on water 7.0:1 and on its tint 5.9:1, amber on land 5.1:1 and on its tint 6.0:1. Ink-3 is not used on land.

### Named Rules
**The Chart Magenta Rule.** Magenta is reserved for marks the recording file carries: annotation onsets, spans and their text. It never marks interface chrome, warnings, selection, hover of anything that is not an annotation, or the brand.

**The Depth Means Depth Rule.** In data graphics the depth blues encode depth and only depth, and they darken as depth increases (deeper sleep, more power). In furniture they appear only in the roles named above: depth-1 and depth-2 for hover, press and selection, depth-5 for the sounding mark and the drop border, depth-6 for focus, primary hover and the drop text. No other decorative blue.

**The Land and Water Rule.** Data is drawn on water; furniture (bar, label margin, chart strip, tab row, start backdrop) sits on land at the edge, separated by a 1px land rule. Fields, cards and menus are small pieces of water set on that land. A trace never sits on land.

**The Amber Notice Rule.** Notices from the parser, errors and the not-for-diagnosis note are amber on its tint. Amber never marks data.

## Typography

**Display Font:** Sounding (with Barlow Semi Condensed, then Arial Narrow)
**Body Font:** system-ui (with -apple-system, Segoe UI, Roboto)
**Label Font:** Sounding, in three cuts: Regular (500), SemiBold (600) and Sloped (500, set with font-style italic)

**Character:** Sounding is built for this app from Barlow Semi Condensed (OFL 1.1) by `scripts/fonts/build_fonts.py`: tabular lining figures are its default digits, the zero is slashed so O1 never reads as 01, every advance carries display tracking, the Sloped cut is the upright skewed 11 degrees (a sloped roman, the way charts letter water names, not a cursive italic), and U+E000 is a drawn chart sounding mark (a ring with a centre dot). Its narrow, upright engineering voice is chart lettering; the system face beside it reads as the plain prose of a tide table.

### Hierarchy
- **Display** (Sounding 600, 1.75rem, 1.15): the one heading on the start screen and the "Drop to open" overlay (the overlay in depth-6).
- **Wordmark** (Sounding 600, 1.375rem, 1, 0.01em): "Leadline" in the top bar, led by the sounding mark glyph in depth-5. 1.2rem on phones.
- **Title** (Sounding 600, 1.125rem, 1.2): sample names on the start screen. **Title small** (Sounding 600, 0.9375rem) for sample names in the Samples menu.
- **Clock** (Sounding 600, 0.9375rem, 1): the page position readout between the arrows in the chart strip.
- **Tab** (Sounding 600, 0.8125rem, 1): panel tabs; the count beside a tab is readout type in ink-2.
- **Channel** (Sounding 500, 0.8125rem, 1): channel names in the label margin; 600 when the cursor is over the traces.
- **Label** (Sounding 500, 0.75rem, 1, 0.02em): control labels above selects, timeline times, the status chip. **Axis** (Sounding 500, 11px) for depth and frequency axis names.
- **Notice** (Sounding 600, 0.75rem, 0.03em): "Not for diagnosis", in amber.
- **Annotation** (Sounding Sloped 500, 0.9375rem, 1.25): annotation text in the panel, in magenta; 12px on the trace canvas.
- **Body** (system 400, 0.9375rem, 1.45, tabular): prose and the File facts. **Body small** (0.8125rem) for sample descriptions, select values, checkbox labels.
- **Control** (system 500, 0.8125rem, 1): button labels.
- **Readout** (system 400, 0.75rem, 1, tabular): unit scales and cursor values in the label margin, the local proof line, annotation times and durations, notices. Values turn 600 ink when live.

### Named Rules
**The Chart Lettering Rule.** Sounding names things on the chart: the wordmark, headings, channel names, tabs, control labels, axes, timeline times, the clock. Prose, control values, unit scales and cursor values are system UI.

**The Sloped Water Name Rule.** The Sloped cut is only for text the file carries, which is annotation text. It is never used for emphasis.

**The Tabular Rule.** Figures are tabular everywhere data shows (`font-variant-numeric: tabular-nums` on the body; Sounding's own digits are tabular with a slashed zero). Negative values use the true minus sign (U+2212).

**The Title Stands Alone Rule.** No eyebrow or kicker label above any title and no tagline or helper line under it, on any screen.

**The No Dash Rule.** No em dash or en dash appears in any interface text, file fact or generated message. Ranges are written with "to".

## Layout

The viewer is one fixed screen with no page scroll: a top bar, a work area and a chart strip stacked in a three-row grid.

- **Top bar** (land, at least 56px, 8px 16px padding, 14px gaps): wordmark, Open, Samples; then the display controls (montage, high-pass, low-pass, notch, gain stepper, window, grid) after a land rule; at the right edge the local proof (with a live count of network requests since the file opened) and the not-for-diagnosis note. Controls are hidden until a file is open.
- **Work area**: three columns, the label margin (136px, pale land), the trace field (water, owns the rest, scrolls vertically when rows hit their minimum) and the details panel (280px, collapsible to 0).
- **Chart strip** (pale land, land rule above): a head row with page arrows, the clock, the spectrogram channel select and the panel toggle; then rows aligned to the label margin column: depth profile (74px, or a 30px annotation lane when the file has no stages), spectrogram (72px), timeline (18px), 4px apart.
- **Start screen**: a centred 620px water card on pale land with the display heading, one large primary button and the sample list.

**The One Row Size Rule.** Every channel row has the same height: the trace field height divided by the channel count, never under 18px. Rows rank by weight only, never by size. Rows at 40px or more are tall: name, unit scale and cursor value stacked beside a scale bar. Shorter rows carry the name, one value slot and the bar; with no cursor, that slot names the bar's scale on the first row of each run sharing a scale. The scale bar is 3px wide and half a row tall, so it measures exactly the scale shown. Rows that start a new bipolar chain get a land rule above the label and a strong grid line across the traces. Labels scroll in step with the traces. A row drawn without some of the chosen filters carries a small tag in 600 warn ink beside its name, `raw` (none applied: a channel that is not EEG) or `part` (some skipped), with the name in the sloped cut and the skipped filters in its title.

**The Edge Furniture Rule.** The recording is the interface: traces get the space, controls stay at the edge on land.

Responsive: at 1180px and below the top bar wraps and the display controls fold behind a settings button into a full-width row; the panel narrows to 248px. At 760px and below the label margin is 92px, the proof line takes its own full row, the panel becomes a bottom sheet (60vh), chart rows shrink to 60, 48 and 18px (26px lane without stages), tall rows drop their cursor value, and the default window is 10 s.

Spacing steps in use: 2, 4, 6, 8, 10, 12, 14 and 16px; the start card is the one roomy surface (36px padding, 22 to 26px between blocks).

## Elevation & Depth

The chart is flat. Depth is conveyed by color (the depth tints) and by the land and water material change, never by shadow. Shadows appear only on surfaces that float above the chart, and they are soft, cool and ink tinted.

### Shadow Vocabulary
- **Menu** (`box-shadow: 0 10px 28px rgba(24, 34, 46, 0.16), 0 2px 6px rgba(24, 34, 46, 0.08)`): the Samples menu.
- **Card** (`box-shadow: 0 18px 50px rgba(24, 34, 46, 0.08)`): the start card.
- **Sheet** (`box-shadow: 0 -12px 30px rgba(24, 34, 46, 0.18)`): the details panel as a phone bottom sheet.

### Named Rules
**The Flat Chart Rule.** Nothing on the chart itself (bar, label margin, traces, docked panel, chart strip) carries a shadow. Only a menu, the start card and the panel as a phone sheet lift.

## Shapes

Small, consistent radii on furniture and none on the chart field. Buttons and notices take 6px, selects, stepper ends and menu items 5px, annotation rows and the status chip 4px, the canvases of the chart strip and the start preview 3px, the menu 8px and the start card 10px, the largest corner in the system. The trace field, label margin and bars are square. Borders are 1px land rule (or grid strong on the start card). Icons are 20px grid line drawings with a 1.5px round stroke, drawn inline as SVG symbols at 18px.

The viewport bracket is the signature shape: a rectangle at least 8px wide over both chart strip canvases, water at 45% inside, a 1.5px ink outline and solid 3px ink caps at top and bottom, like a chart's inset frame.

## Components

### Buttons
Quiet chart furniture, firm in ink when it is the one action that matters.
- **Shape:** gently rounded (6px), 34px tall, 12px side padding, 18px icon plus label with a 6px gap.
- **Primary:** ink fill, water text; hover to depth-6, press to #0f1720. Only Open and Choose files use it.
- **Secondary:** water fill, land rule stroke, ink text; hover to white with an ink-3 stroke, press to depth-1. Disabled at 45% opacity.
- **Icon:** a 34px square (30px in the stepper and chart strip, 32px on phones). The panel toggle shows depth-1 while pressed.
- **Large:** 44px tall, 18px padding, body size; the start screen's Choose files.
- **Hover / Focus:** 150ms background and border change on `cubic-bezier(0.16, 1, 0.3, 1)`; focus is a 2px depth-6 outline at 2px offset on every control.

### Inputs / Fields
- **Style:** a 30px water select with a land rule stroke, 5px radius and an inline ink chevron, its Sounding label stacked above in ink-2. The gain stepper joins two icon buttons and a 48px output into one 30px unit.
- **Focus:** the shared depth-6 focus ring; hover strokes in ink-3.
- **Disabled:** 50% opacity.
- **Checkbox:** native, accented in ink.

### Navigation
- **Tabs:** Sounding 600 in ink-2 on pale land; the selected tab turns ink with a 2px ink underline. A count sits beside the label in readout type.
- **Paging:** arrow buttons either side of the Sounding clock; the depth profile is itself a slider (click, drag, arrow keys).
- **Menu:** a 300px water list with 8px radius and the menu shadow; each row shows a Sounding name with a small ink-2 line of source and size, and hovers to depth-1.

### Cards / Containers
- **Start card:** water, 10px radius, grid strong stroke, card shadow, 36px padding. Sample rows are divided by grid strong rules and hover to depth-1; the sleep sample shows its real depth profile as a preview.
- **Notice:** amber text on amber tint, 6px radius, 8px 10px padding, readout size.
- **Status chip:** land fill, ink-2 Sounding label, 4px radius, top right of the trace field; it says "Reading" and carries short messages for five seconds.

### Channel Label Margin (signature)
The left margin is a fixed roster per channel row: name, unit scale and live cursor value, with the scale bar at the right edge. The name and value go to 600 ink while the cursor is over the traces. Behaviour is set by The One Row Size Rule.

### Trace Field (signature)
Water ground. Traces are 1px ink with round joins, negative up for voltage channels and positive up otherwise, clipped at 1.6 half rows (one half row for slow non EEG channels). The time grid is the visible armature and a real toggle: 1 s steps (coarsened until lines are at least 12px apart, every fifth strong) or 30 s epochs (all strong, with 5, 10 or 15 s minor lines), or off. Annotation spans are a 20px magenta tint band at the top; onsets are magenta hairlines with a sloped 12px label on a water plate. The cursor is a dashed (3 on, 3 off) ink-2 line.

### Depth Profile (signature)
Land ground; each epoch is a water column from the surface down to its stage depth, one depth tint per band (W, R, then stages 1 to 4 or N1 to N3 in the file's own scheme). Depth contours are 0.5px ink at 16% where water is deeper than the line. The seabed is a stepped 1.5px ink line, 3px through REM. Unscored epochs are pale land and claim no depth. Annotation ticks are 7px magenta lines at the floor. Without stages the row becomes an annotation lane on water with tinted spans and full-height magenta ticks. The viewport bracket rides on top.

### Spectrogram
Log frequency axis, so delta and theta get as much room as beta. Power is shown relative to the median at each frequency, clipped to the 2nd and 99.5th percentiles, on a ramp from water through depth-1 to depth-6 to abyss: more power reads as deeper water. The same bracket marks the page.

## Do's and Don'ts

### Do:
- **Do** draw every data mark on open water (#fcfdfb) and keep furniture on land (#eadfc2 or #f3edda) behind a 1px land rule.
- **Do** use the depth blues in order, pale to deep, for anything that encodes depth or intensity, ending at abyss for the spectrogram.
- **Do** keep magenta for the file's own marks: onsets as hairlines, spans as the 20px tint band, text in the Sloped cut.
- **Do** set chart lettering in Sounding and every measured number in tabular figures with the true minus sign.
- **Do** give every channel row the same height (at least 18px) and rank rows by weight only.
- **Do** keep the local proof and the not-for-diagnosis note visible in the top bar on every screen size.
- **Do** keep motion to 150ms color transitions and switch them off under reduced motion.

### Don't:
- **Don't** use magenta for warnings, errors, selection, buttons, the brand or any mark the file did not carry.
- **Don't** put an eyebrow or kicker above any title or a tagline or helper line under it.
- **Don't** use an em dash or en dash in any text.
- **Don't** draw a black oscilloscope screen with green traces or a grey dashboard with one blue accent.
- **Don't** add shadows to the bar, label margin, trace field, docked panel or chart strip.
- **Don't** use the Sloped cut for emphasis or for text the interface wrote.
- **Don't** flash, blink, pulse or animate anything on its own.
- **Don't** put ink-3 text on land.
