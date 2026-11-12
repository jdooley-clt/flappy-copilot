import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { baselinePath, measurePayload } from './payload.js';

// The game must stay small: the build output may not grow more than 10% over the recorded
// baseline. Deliberate growth updates tests/payload-baseline.json in the same change.
const headroom = 1.1;
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

test('published payload stays within 10% of its recorded baseline', async ({}, testInfo) => {
  const actual = measurePayload();
  testInfo.annotations.push({
    type: 'payload',
    description: `raw ${actual.raw} B (baseline ${baseline.raw} B), gzip ${actual.gzip} B (baseline ${baseline.gzip} B)`,
  });
  expect(Object.keys(actual.files).sort(), 'every published file is recorded in the baseline')
    .toEqual(Object.keys(baseline.files).sort());
  expect(actual.raw, 'raw bytes').toBeLessThanOrEqual(Math.floor(baseline.raw * headroom));
  expect(actual.gzip, 'gzipped bytes').toBeLessThanOrEqual(Math.floor(baseline.gzip * headroom));
});
