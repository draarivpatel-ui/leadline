// Static guarantees on the shipped page: CSP, no inline handlers, keyboard accessibility hooks,
// and the repo hygiene rules (no em/en dashes, no smooth scrolling, no AI mentions).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'src', 'app', 'style.css'), 'utf8');
const main = readFileSync(join(ROOT, 'src', 'app', 'main.ts'), 'utf8');

function* shipped(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* shipped(p);
    else if (/\.(ts|css|html|svg)$/.test(e)) yield p;
  }
}

describe('content security policy', () => {
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';

  it('a CSP meta tag is present', () => {
    expect(csp).not.toBe('');
  });

  it('scripts, workers and connections are same-origin only', () => {
    for (const directive of ["script-src 'self'", "worker-src 'self'", "connect-src 'self'", "default-src 'none'"]) {
      expect(csp, directive).toContain(directive);
    }
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/script-src[^;]*data:/);
  });

  it('styles may be inline (element.style writes) but nothing else is', () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('no inline event handlers or inline scripts remain to be blocked', () => {
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(main).toContain("addEventListener('submit'");
  });
});

describe('keyboard accessibility', () => {
  it('the trace area is focusable so printable-key shortcuts have a focus gate (WCAG 2.1.4)', () => {
    expect(html).toMatch(/id="traces-wrap"[^>]*tabindex="0"/);
    expect(main).toContain("t.closest('#traces-wrap')");
  });

  it('focus is visible (WCAG 2.4.7)', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline/);
  });

  it('icon-only buttons each carry an accessible name', () => {
    const iconButtons = html.match(/<button\b[^>]*class="[^"]*btn-icon[^"]*"[^>]*>/g) ?? [];
    expect(iconButtons.length).toBeGreaterThan(0);
    for (const b of iconButtons) expect(b, b).toContain('aria-label');
  });
});

describe('repo hygiene', () => {
  it('no em dashes or en dashes in shipped sources', () => {
    for (const p of shipped(join(ROOT, 'src'))) {
      expect(readFileSync(p, 'utf8'), p).not.toMatch(/[\u2013\u2014]/);
    }
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it('no smooth scrolling (breaks deterministic rendering)', () => {
    expect(css).not.toMatch(/scroll[-]behavior/);
    expect(html).not.toMatch(/scroll[-]behavior/);
  });

  it('no AI mentions in shipped sources', () => {
    for (const p of [join(ROOT, 'index.html'), ...shipped(join(ROOT, 'src'))]) {
      expect(readFileSync(p, 'utf8'), p).not.toMatch(/\bAI\b/);
    }
  });
});
