import { AxeBuilder } from '@axe-core/playwright';
import { test, expect, readyGame, startWithSpace } from './helpers.js';
import { origin } from '../scripts/cabinet.mjs';

const candidate = `${origin}/flappy-copilot/`;
const gatedImpacts = ['serious', 'critical'];

// Only the blocking impacts gate the deploy; the full report stays in the trace for review.
async function gatedViolations(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  // analyze() opens and closes a blank page in this context; make the game the active page
  // again so its animation-frame loop (and rAF-polled waits) cannot stall afterwards.
  await page.bringToFront();
  return violations
    .filter((violation) => gatedImpacts.includes(violation.impact))
    .map(({ id, impact, help, nodes }) => ({ id, impact, help, targets: nodes.map((node) => node.target) }));
}

// Start screen, a live run, and the game-over screen. The bird reaches the ground in about a
// second without flaps, well before the first pipe spawns, so the ending is deterministic.
async function auditEveryState(page, frame, startRun) {
  await expect.soft(await gatedViolations(page), 'start screen').toEqual([]);
  await startRun();
  await expect.soft(await gatedViolations(page), 'mid-game').toEqual([]);
  await frame.waitForFunction(() => state === 'dead');
  await expect.soft(await gatedViolations(page), 'game over').toEqual([]);
}

for (const colorScheme of ['light', 'dark']) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('standalone game has no serious or critical accessibility violations', async ({ page }) => {
      await page.goto(candidate);
      await page.waitForFunction(() => typeof state !== 'undefined' && state === 'menu' && frame > 0);
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await auditEveryState(page, page.mainFrame(), async () => {
        await page.keyboard.press('Space');
        await expect.poll(() => page.evaluate(() => state)).toBe('play');
      });
    });

    test('game inside the cabinet has no serious or critical accessibility violations', async ({ page }) => {
      await page.goto('/arcade/');
      await page.getByRole('button', { name: 'Play Flappy Copilot', exact: true }).click();
      const frame = await readyGame(page, candidate);
      await expect(frame.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await auditEveryState(page, frame, () => startWithSpace(page, frame));
    });
  });
}

test('the gate catches an injected serious violation', async ({ page }) => {
  await page.goto(candidate);
  await page.waitForFunction(() => typeof state !== 'undefined' && state === 'menu' && frame > 0);
  expect(await gatedViolations(page)).toEqual([]);
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '#injected-violation';
    document.body.append(link);
  });
  const violations = await gatedViolations(page);
  expect(violations).toEqual([expect.objectContaining({ id: 'link-name', impact: 'serious' })]);
});
