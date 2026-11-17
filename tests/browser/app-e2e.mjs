// End-to-end check of the BUILT app (dist/) in the installed Google Chrome, headless.
// Opens both bundled samples, drives montage, filters, paging and the depth-profile navigator, measures pan
// timing, asserts zero off-origin requests and no page errors, and writes screenshots.
// Usage: node tests/browser/app-e2e.mjs [outDir]   (run `npx vite build` first; wrap with browser-lock.sh here)
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '.scratch/review';
mkdirSync(out, { recursive: true });
const PORT = 5184;
const ORIGIN = `http://localhost:${PORT}`;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
};

async function newPage(viewport, scale = 1) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.offOrigin = [];
  page.errors = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) page.offOrigin.push(r.url());
  });
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') page.errors.push(m.text());
  });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const ready = (page) => page.waitForFunction(() => window.__leadline?.ready, null, { timeout: 60000 });
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

try {
  // ---------- desktop ----------
  const page = await newPage({ width: 1440, height: 900 });
  await page.screenshot({ path: join(out, 'desktop-start.png') });
  const icon = await page.evaluate(async () => (await (await fetch('favicon.svg')).text()).length);
  check('favicon is served', icon > 100, `${icon} bytes`);
  const fontOk = await page.evaluate(() => document.fonts.check('600 22px Sounding'));
  check('Sounding display face loaded', fontOk);

  await page.click('#samples-btn');
  await page.screenshot({ path: join(out, 'desktop-samples-menu.png') });
  await page.click('.menu-list [data-sample="sleep"]');
  await ready(page);
  await page.waitForFunction(() => window.__leadline.state.spec !== null, null, { timeout: 60000 });
  await settle(page);
  const st = await page.evaluate(() => {
    const s = window.__leadline.state;
    return { duration: s.info.duration, channels: s.channels.length, epochs: s.hyp?.epochs.length ?? 0, spec: [s.spec.ntime, s.spec.nfreq] };
  });
  check('sleep sample opens with 7 channels and 154 stage epochs', st.channels === 7 && st.epochs === 154, JSON.stringify(st));
  await page.screenshot({ path: join(out, 'desktop-sleep-start.png') });
  const sleepRows = await page.evaluate(() => {
    const s = window.__leadline.state;
    const rows = [...document.querySelectorAll('#labels .row-label')];
    const temp = s.win.channels[5].data;
    let mean = 0;
    for (const v of temp) mean += v / temp.length;
    return {
      hp: document.getElementById('hp').value,
      lp: document.getElementById('lp').value,
      tags: rows.map((r) => r.querySelector('.tag').textContent),
      kinds: s.win.channels.map((c) => c.kind),
      temp: mean,
    };
  });
  check(
    'sleep night opens at 0.3 to 35 Hz; its 4 non-EEG rows are tagged raw and keep their values',
    sleepRows.hp === '0.3' && sleepRows.lp === '35' && sleepRows.tags.join() === ',,,raw,raw,raw,raw' && sleepRows.temp > 30 && sleepRows.temp < 45,
    JSON.stringify(sleepRows),
  );

  // Jump into the first deep sleep stretch through the depth profile (click), then look.
  const deep = await page.evaluate(() => {
    const s = window.__leadline.state;
    const e = s.hyp.epochs.find((x) => x.stage === 'N4' && x.onset > 0);
    return e ? e.onset + 60 : 0;
  });
  const box = await page.locator('#depth').boundingBox();
  await page.mouse.click(box.x + (deep / st.duration) * box.width, box.y + box.height / 2);
  await ready(page);
  await settle(page);
  const startAfterClick = await page.evaluate(() => window.__leadline.state.start);
  check('clicking the depth profile moves the view there', Math.abs(startAfterClick + 15 - deep) < st.duration / box.width * 3 + 1, `start ${startAfterClick.toFixed(1)}, wanted about ${(deep - 15).toFixed(1)}`);
  await page.mouse.move(box.x + 700, box.y - 300);
  await settle(page);
  await page.screenshot({ path: join(out, 'desktop.png') });
  await page.screenshot({ path: join(out, 'desktop-sleep-deep.png') });

  // Pan timing: 40 programmatic pans of 0.5 s each, time from request to the drawn frame.
  const pan = await page.evaluate(async () => {
    const api = window.__leadline;
    const times = [];
    api.goTo(0);
    await api.whenIdle();
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      api.goTo(api.state.start + 30);
      await api.whenIdle();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { median: times[20], p90: times[36], worst: times[39] };
  });
  check('page to drawn frame under 50 ms median (7 ch, 30 s, filtered)', pan.median < 50, `median ${pan.median.toFixed(1)} ms, p90 ${pan.p90.toFixed(1)}, worst ${pan.worst.toFixed(1)}`);

  // Keyboard paging.
  const before = await page.evaluate(() => window.__leadline.state.start);
  await page.locator('#traces-wrap').click({ position: { x: 300, y: 100 } });
  await page.keyboard.press('ArrowRight');
  await ready(page);
  const after = await page.evaluate(() => window.__leadline.state.start);
  check('ArrowRight pages one window forward', Math.abs(after - before - 30) < 1e-6 || after > before, `${before} -> ${after}`);

  // Fine scrolling is not snapped to epochs: Shift+ArrowRight and the wheel move by less than a page.
  const s0 = await page.evaluate(() => window.__leadline.state.start);
  await page.keyboard.press('Shift+ArrowRight');
  await ready(page);
  const s1 = await page.evaluate(() => window.__leadline.state.start);
  check('Shift+ArrowRight moves a fifth of a window', Math.abs(s1 - s0 - 6) < 1e-6, `${s0} -> ${s1}`);
  await page.mouse.move(700, 300);
  await page.mouse.wheel(0, 200);
  await ready(page);
  await page.waitForTimeout(100);
  await ready(page);
  const s2 = await page.evaluate(() => window.__leadline.state.start);
  check('the wheel scrolls the traces', s2 > s1, `${s1} -> ${s2}`);

  // Annotations panel and file facts.
  await page.click('#tab-file');
  await settle(page);
  const stageFact = await page.evaluate(() => {
    const dts = [...document.querySelectorAll('#facts dt')];
    const dt = dts.find((d) => d.textContent === 'Sleep stages');
    return dt ? dt.nextElementSibling.textContent : '';
  });
  const sf = /^(\d+) scored epochs(?: \((\d+) more outside the recording\))?, R&K stages$/.exec(stageFact);
  check('sleep facts count the epochs inside the excerpt', !!sf && Number(sf[1]) + Number(sf[2] ?? 0) === 154 && Number(sf[2] ?? 0) > 0, stageFact);
  await page.screenshot({ path: join(out, 'desktop-sleep-file-tab.png') });
  await page.click('#tab-ann');

  // ---------- motor imagery, bipolar, filters ----------
  await page.click('#samples-btn');
  await page.click('.menu-list [data-sample="motor"]');
  await page.waitForFunction(() => window.__leadline.state.info?.signals.length === 64 && window.__leadline.ready, null, { timeout: 60000 });
  await settle(page);
  const motorFilters = await page.evaluate(() => [document.getElementById('hp').value, document.getElementById('lp').value, document.querySelectorAll('#labels .row-label.unfiltered, #labels .row-label.part-filtered').length]);
  check('routine EEG opens at 1 to 70 Hz with no rows tagged', motorFilters.join() === '1,70,0', motorFilters.join());
  await page.selectOption('#montage', 'bipolar');
  await ready(page);
  await page.selectOption('#notch', '60');
  await ready(page);
  await page.waitForFunction(() => window.__leadline.state.spec !== null, null, { timeout: 60000 });
  await settle(page);
  const m = await page.evaluate(() => ({ n: window.__leadline.state.channels.length, first: window.__leadline.state.channels[0].label }));
  check('motor sample in double banana: 18 derivations, Fp1-F7 first', m.n === 18 && m.first === 'Fp1-F7', JSON.stringify(m));
  await page.mouse.move(800, 400);
  await settle(page);
  await page.screenshot({ path: join(out, 'desktop-motor-bipolar.png') });
  await page.selectOption('#montage', 'referential');
  await ready(page);
  await page.waitForFunction(() => window.__leadline.state.spec !== null, null, { timeout: 60000 });
  await settle(page);
  await page.screenshot({ path: join(out, 'desktop-motor-64.png') });
  await page.mouse.move(700, 880);
  await settle(page);
  await page.screenshot({ path: join(out, 'desktop-motor-64-rest.png') });
  const pan64 = await page.evaluate(async () => {
    const api = window.__leadline;
    const times = [];
    api.goTo(0);
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      api.goTo(api.state.start + 1);
      await api.whenIdle();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { median: times[15], worst: times[29] };
  });
  check('pan to drawn frame, 64 channels with notch, under 50 ms median', pan64.median < 50, `median ${pan64.median.toFixed(1)} ms, worst ${pan64.worst.toFixed(1)}`);

  // A window asked for before a montage change must not take the rescale meant for the new montage. The reply
  // to the pan is held back 400 ms (a slow disk read), so it lands after the switch has started.
  const race = await page.evaluate(async () => {
    const api = window.__leadline;
    const sel = document.getElementById('montage');
    const orig = api.eeg.readWindow;
    const runs = [];
    try {
      for (const [to, n] of [['bipolar', 18], ['referential', 64], ['bipolar', 18], ['referential', 64]]) {
        let held = false;
        api.eeg.readWindow = async (...a) => {
          const r = await orig(...a);
          if (!held) {
            held = true;
            await new Promise((ok) => setTimeout(ok, 400));
          }
          return r;
        };
        api.goTo(api.state.start > 60 ? 10 : api.state.start + 7);
        await new Promise((ok) => setTimeout(ok, 0));
        sel.value = to;
        sel.dispatchEvent(new Event('change'));
        const t0 = performance.now();
        while (!(api.ready && api.state.channels.length === n && api.state.win.channels.length === n) && performance.now() - t0 < 10000) await new Promise((ok) => setTimeout(ok, 20));
        await new Promise((ok) => setTimeout(ok, 500));
        await api.whenIdle();
        runs.push([n, api.state.channels.length, api.state.win.channels.length, api.state.scales.length, api.state.rescale]);
      }
    } finally {
      api.eeg.readWindow = orig;
    }
    return runs;
  });
  check('a slow window reply during a montage switch is dropped; rows rescale to the new list', race.every(([n, a, b, c, r]) => a === n && b === n && c === n && r === false), JSON.stringify(race));

  // A broken file shows a clear message and stays on the start screen.
  await page.setInputFiles('#file-input', { name: 'broken.edf', mimeType: 'application/octet-stream', buffer: Buffer.alloc(120) });
  await page.waitForFunction(() => /could not be opened/.test(document.getElementById('busy').textContent), null, { timeout: 20000 });
  const errText = await page.textContent('#busy');
  const stillOpen = await page.evaluate(() => window.__leadline.state.channels.length);
  check('a broken file explains itself and keeps the open recording', /256-byte/.test(errText) && /Choose another/.test(errText) && stillOpen === 64, errText.trim());
  await page.screenshot({ path: join(out, 'desktop-error.png') });

  // A truncated file opened over a recording: the offer stays as a toast until pressed.
  const motorBytes = readFileSync('public/samples/S001R03.edf');
  const cut = Buffer.from(motorBytes.subarray(0, Math.floor(motorBytes.length * 0.6)));
  await page.setInputFiles('#file-input', { name: 'cut-short.edf', mimeType: 'application/octet-stream', buffer: cut });
  await page.waitForFunction(() => /ends early/.test(document.getElementById('busy').textContent), null, { timeout: 20000 });
  await page.waitForTimeout(5500); // longer than a plain toast lives
  const toastStays = await page.evaluate(() => !document.getElementById('busy').hidden && document.querySelectorAll('#busy button').length === 2);
  await page.screenshot({ path: join(out, 'desktop-truncated-toast.png') });
  await page.click('#busy button >> nth=0');
  await page.waitForFunction(() => window.__leadline.state.info?.recordCount === 74 && window.__leadline.ready, null, { timeout: 60000 });
  check('a truncated file over an open recording: the offer stays, and opens 74 records', toastStays, `toast stayed ${toastStays}`);

  // A hypnogram opened alone, on a fresh page, is refused with a way forward.
  const lone = await newPage({ width: 1024, height: 700 });
  await lone.setInputFiles('#file-input', 'public/samples/SC4001EC-Hypnogram.edf');
  await lone.waitForFunction(() => /only annotations/.test(document.getElementById('start-error').textContent), null, { timeout: 20000 });
  check('an annotation-only file alone asks for its recording', true);
  await lone.setInputFiles('#file-input', { name: 'broken.edf', mimeType: 'application/octet-stream', buffer: Buffer.alloc(120) });
  await lone.waitForFunction(() => /256-byte/.test(document.getElementById('start-error').textContent), null, { timeout: 20000 });
  await lone.screenshot({ path: join(out, 'desktop-start-error.png') });
  check('a broken file on the start screen explains itself', true);
  // The same file opened while its recording is shown is added to it.
  await lone.click('.start-samples [data-sample="motor"]');
  await ready(lone);
  const n0 = await lone.evaluate(() => window.__leadline.state.annotations.length);
  await lone.setInputFiles('#file-input', 'public/samples/SC4001EC-Hypnogram.edf');
  await lone.waitForFunction((n) => window.__leadline.state.annotations.length > n, n0, { timeout: 20000 });
  check('an annotation file opened over a recording is added to it', true);
  // A recording opened alone, then its hypnogram added: the depth profile appears in a full-height row.
  // Opened over the 64-row motor run, with a pan right after the worker has the new file but before the page has
  // set it up: that window (7 rows of the new file) must not be drawn under the old 64 rows.
  await lone.evaluate(() => {
    const api = window.__leadline;
    const orig = api.eeg.open;
    window.__gap = null;
    api.eeg.open = async (...a) => {
      const info = await orig(...a);
      api.eeg.open = orig;
      api.goTo(api.state.start + 1);
      await new Promise((ok) => setTimeout(ok, 400));
      window.__gap = { rows: api.state.channels.length, drawn: api.state.win?.channels.length };
      return info;
    };
  });
  await lone.setInputFiles('#file-input', 'public/samples/SC4001E0-PSG-sleep-excerpt.edf');
  await lone.waitForFunction(() => window.__leadline.state.info?.duration === 24600 && window.__leadline.ready, null, { timeout: 60000 });
  const gap = await lone.evaluate(() => ({ ...window.__gap, after: [window.__leadline.state.channels.length, window.__leadline.state.win.channels.length] }));
  check('a window asked for while a new file opens is not drawn on the old one', gap.rows === 64 && gap.drawn === 64 && gap.after.join() === '7,7', JSON.stringify(gap));
  const laneBefore = await lone.evaluate(() => document.getElementById('chart').classList.contains('no-stages'));
  await lone.setInputFiles('#file-input', 'public/samples/SC4001EC-Hypnogram.edf');
  await lone.waitForFunction(() => window.__leadline.state.hyp !== null, null, { timeout: 20000 });
  await settle(lone);
  const added = await lone.evaluate(() => ({ lane: document.getElementById('chart').classList.contains('no-stages'), h: document.getElementById('depth').clientHeight }));
  check('adding a hypnogram later turns the lane into the depth profile', laneBefore && !added.lane && added.h > 60, JSON.stringify(added));
  await lone.screenshot({ path: join(out, 'desktop-hypnogram-added.png') });
  // Adding annotations changes no filter, so panning afterwards must not repeat the skipped-filter notice.
  await lone.evaluate(async () => {
    const api = window.__leadline;
    api.goTo(api.state.start + 30);
    await api.whenIdle();
    await new Promise((ok) => setTimeout(ok, 100));
  });
  const afterAdd = await lone.evaluate(() => { const b = document.getElementById('busy'); return b.hidden ? '' : b.textContent; });
  check('a pan after adding annotations repeats no skipped-filter notice', !/not EEG|not applied/.test(afterAdd), afterAdd.trim());
  // A filter the night's rates cannot carry is announced once.
  // At this width the controls fold behind the settings button.
  if (!(await lone.isVisible('#notch'))) await lone.click('#settings-toggle');
  await lone.selectOption('#notch', '60');
  await lone.waitForFunction(() => /Notch 60 Hz/.test(document.getElementById('busy').textContent), null, { timeout: 20000 });
  const skipToast = await lone.textContent('#busy');
  const partTags = await lone.evaluate(() => [...document.querySelectorAll('#labels .row-label .tag')].map((t) => t.textContent).join());
  check('a skipped filter is announced and its rows are tagged', /Notch 60 Hz is not applied to 3 rows/.test(skipToast) && /4 rows are not EEG/.test(skipToast) && partTags === 'part,part,part,raw,raw,raw,raw', `${skipToast.trim()} | ${partTags}`);
  await lone.screenshot({ path: join(out, 'desktop-skipped-filter.png') });

  // A recording cut short (crash, full disk) is offered as its complete records.
  const trunc = await newPage({ width: 1024, height: 700 });
  await trunc.setInputFiles('#file-input', { name: 'cut-short.edf', mimeType: 'application/octet-stream', buffer: Buffer.from(cut) });
  await trunc.waitForFunction(() => /ends early/.test(document.getElementById('start-error').textContent), null, { timeout: 20000 });
  const offer = await trunc.textContent('#start-error button');
  await trunc.screenshot({ path: join(out, 'desktop-truncated-offer.png') });
  await trunc.click('#start-error button');
  await ready(trunc);
  const truncInfo = await trunc.evaluate(() => ({ records: window.__leadline.state.info.recordCount, warn: window.__leadline.state.info.warnings.join(' '), notes: document.getElementById('notes').textContent }));
  check('a truncated file opens its complete records on request', /Open the \d+ complete records/.test(offer) && truncInfo.records > 50 && truncInfo.records < 125 && /truncated/.test(truncInfo.notes), `${offer} | ${JSON.stringify(truncInfo)}`);
  check('truncated page: no page errors', trunc.errors.length === 0, trunc.errors.join(' | '));
  await trunc.close();

  // Mixed references: the motor run with four labels rewritten to name A1 or A2 (labels start at byte 256).
  const mixedBytes = Buffer.from(motorBytes);
  for (const [i, label] of [[8, 'C3-A2'], [12, 'C4-A1'], [31, 'F3-A2'], [35, 'F4-A1']]) mixedBytes.write(label.padEnd(16, ' '), 256 + 16 * i, 'latin1');
  const mixed = await newPage({ width: 1440, height: 900 });
  await mixed.setInputFiles('#file-input', { name: 'mixed-refs.edf', mimeType: 'application/octet-stream', buffer: mixedBytes });
  await mixed.waitForFunction(() => window.__leadline.state.info?.signals.length === 64 && window.__leadline.ready, null, { timeout: 60000 });
  await mixed.selectOption('#montage', 'average');
  await mixed.waitForFunction(() => /Mixed references/.test(document.getElementById('busy').textContent), null, { timeout: 20000 });
  const mixedToast = await mixed.textContent('#busy');
  await mixed.screenshot({ path: join(out, 'desktop-mixed-references.png') });
  const mixedNotes = await mixed.textContent('#notes');
  const mixedRows = await mixed.evaluate(() => window.__leadline.state.channels.length);
  check(
    'mixed references are named when the average is chosen, and on the File tab',
    /Mixed references \(A1, A2, REF\): the average is built from the 60 electrodes on the common reference; 4 other electrodes are left out/.test(mixedToast) && /Bipolar \(double banana\): .*Mixed references/.test(mixedNotes) && mixedRows === 60,
    `${mixedToast.trim()} | rows ${mixedRows}`,
  );
  check('mixed page: no page errors', mixed.errors.length === 0, mixed.errors.join(' | '));
  await mixed.close();

  // A routine EEG with eye channels (two motor rows renamed LOC and ROC) is not a sleep study: it opens at 1 to 70 Hz.
  const eyeBytes = Buffer.from(motorBytes);
  for (const [i, label] of [[62, 'LOC'], [63, 'ROC']]) eyeBytes.write(label.padEnd(16, ' '), 256 + 16 * i, 'latin1');
  const eyes = await newPage({ width: 1440, height: 900 });
  await eyes.setInputFiles('#file-input', { name: 'routine-with-eog.edf', mimeType: 'application/octet-stream', buffer: eyeBytes });
  await eyes.waitForFunction(() => window.__leadline.state.info?.signals.length === 64 && window.__leadline.ready, null, { timeout: 60000 });
  const eyeView = await eyes.evaluate(() => ({ hp: document.getElementById('hp').value, lp: document.getElementById('lp').value, eog: window.__leadline.state.channels.filter((c) => c.kind === 'eog').length }));
  check('routine EEG with LOC and ROC rows opens at 1 to 70 Hz, not the sleep defaults', eyeView.hp === '1' && eyeView.lp === '70' && eyeView.eog === 2, JSON.stringify(eyeView));
  check('eye-channel page: no page errors', eyes.errors.length === 0, eyes.errors.join(' | '));
  await eyes.close();
  await lone.close();

  // The build works from a sub-path (GitHub Pages serves a project from /<repo>/).
  const subServer = await preview({ base: '/sub/path/', preview: { port: PORT + 1, strictPort: true }, logLevel: 'error' });
  const sub = await (await browser.newContext({ viewport: { width: 1024, height: 700 } })).newPage();
  const subErrors = [];
  sub.on('pageerror', (e) => subErrors.push(String(e)));
  sub.on('response', (r) => { if (r.status() >= 400) subErrors.push(`${r.status()} ${r.url()}`); });
  await sub.goto(`http://localhost:${PORT + 1}/sub/path/`);
  await sub.click('.start-samples [data-sample="motor"]');
  await sub.waitForFunction(() => window.__leadline?.ready, null, { timeout: 60000 });
  const subFont = await sub.evaluate(() => document.fonts.check('600 22px Sounding'));
  check('the build runs from a sub-path, samples, fonts and worker included', subErrors.length === 0 && subFont, subErrors.join(' | '));
  await sub.close();
  await new Promise((r) => subServer.httpServer.close(r));

  check('desktop: no requests to any other origin', page.offOrigin.length === 0, page.offOrigin.join(', '));
  check('desktop: no page errors', page.errors.length === 0, page.errors.join(' | '));

  // ---------- phone ----------
  const phone = await newPage({ width: 390, height: 844 }, 2);
  await phone.screenshot({ path: join(out, 'mobile-start.png') });
  await phone.click('.start-samples [data-sample="sleep"]');
  await ready(phone);
  await phone.waitForFunction(() => window.__leadline.state.spec !== null, null, { timeout: 60000 });
  await settle(phone);
  await phone.screenshot({ path: join(out, 'mobile.png') });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const wide = await phone.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).map((e) => `${e.tagName}#${e.id}.${e.className}`).slice(0, 5));
  check('phone: no horizontal page scroll', overflow <= 0, `overflow ${overflow}px ${wide.join(' ')}`);
  await phone.click('#settings-toggle');
  await settle(phone);
  await phone.screenshot({ path: join(out, 'mobile-settings.png') });
  await phone.click('#settings-toggle');
  await phone.click('.start-samples [data-sample="motor"]').catch(() => {});
  await phone.click('#samples-btn');
  await phone.click('.menu-list [data-sample="motor"]');
  await ready(phone);
  await settle(phone);
  await phone.screenshot({ path: join(out, 'mobile-motor-64.png') });
  await phone.click('#panel-open');
  await settle(phone);
  await phone.screenshot({ path: join(out, 'mobile-annotations.png') });
  check('phone: no requests to any other origin', phone.offOrigin.length === 0, phone.offOrigin.join(', '));
  check('phone: no page errors', phone.errors.length === 0, phone.errors.join(' | '));

  // ---------- README image, 2x ----------
  const hero = await newPage({ width: 1440, height: 900 }, 2);
  await hero.click('#samples-btn');
  await hero.click('.menu-list [data-sample="sleep"]');
  await ready(hero);
  await hero.waitForFunction(() => window.__leadline.state.spec !== null, null, { timeout: 60000 });
  await hero.evaluate((t) => window.__leadline.goTo(t), deep - 15);
  await ready(hero);
  await settle(hero);
  mkdirSync('docs', { recursive: true });
  await hero.screenshot({ path: 'docs/screenshot.png' });
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
