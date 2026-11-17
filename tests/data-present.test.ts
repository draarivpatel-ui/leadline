import { describe, expect, it } from 'vitest';
import { hasData, hasFilterGolden } from './helpers';

// Most checks compare against downloaded recordings and generated reference values. Without them those checks
// skip, so this test fails instead of letting a fresh clone look green.
describe('reference data', () => {
  it.skipIf(process.env.LEADLINE_ALLOW_MISSING_DATA === '1')('is present (run scripts/fetch-test-data.sh, then scripts/golden/run.sh)', () => {
    expect(hasData && hasFilterGolden, 'test-data/ is missing: run `sh scripts/fetch-test-data.sh && sh scripts/golden/run.sh`, or set LEADLINE_ALLOW_MISSING_DATA=1 to run only the self-contained tests').toBe(true);
  });
});
