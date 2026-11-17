// Starts a Vite dev server, opens the harness in the installed Google Chrome (headless), and checks the result,
// including that the page made no request to any other origin. Run through browser-lock.sh.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const server = await createServer({ server: { port: 5183, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failed = false;
try {
  const page = await browser.newPage();
  const offOrigin = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost:5183/')) offOrigin.push(r.url()); });
  page.on('pageerror', (e) => { console.error('page error', e); failed = true; });
  await page.goto('http://localhost:5183/tests/browser/harness.html');
  await page.waitForFunction(() => window.__result, null, { timeout: 120000 });
  const r = await page.evaluate(() => window.__result);
  console.log(JSON.stringify(r, null, 2));
  const checks = [
    ['no error', !r.error],
    ['EDF+C with 64 signals', r.variant === 'EDF+C' && r.signals === 64],
    ['64 channels drawn', r.channels === 64],
    ['round trip median under 50 ms', r.roundTripMedianMs < 50],
    ['sleep excerpt is 24600 s', r.sleepDuration === 24600],
    ['hypnogram aligned by start time', r.hypnogramOffset === -29400],
    ['broken file fails with TOO_SHORT', r.brokenFile === 'TOO_SHORT'],
    ['1 Hz non-EEG rows equal the raw data under high-pass 0.3 Hz', r.slowRowsRaw === true && r.kinds?.join() === 'eeg,eeg,eog,other,other,other,other'],
    ['EEG rows are filtered', r.eegFiltered === true],
    ['no off-origin requests', offOrigin.length === 0],
  ];
  for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed = true; }
  if (offOrigin.length) console.log('off-origin:', offOrigin);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
