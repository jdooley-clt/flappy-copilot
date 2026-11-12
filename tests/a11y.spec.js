import { AxeBuilder } from '@axe-core/playwright';
import { test, expect, readyGame, startWithSpace } from './helpers.js';
import { origin } from '../scripts/cabinet.mjs';

const candidate = `${origin}/flappy-copilot/`;
const blockingImpacts = ['serious', 'critical'];

// The standalone page must be clean at every impact. Inside the cabinet the blocking impacts
// gate the whole composite page, while lesser findings count only when they point into the
// game's frame (a frame target is a selector per frame, so it has more than one entry): the
// shell's own markup belongs to the arcade repository.
function gatedViolations(violations, inCabinet) {
  return violations
    .map(({ id, impact, help, nodes }) => ({
      id, impact, help,
      targets: nodes.map((node) => node.target)
        .filter((target) => !inCabinet || blockingImpacts.includes(impact) || target.length > 1),
    }))
    .filter((violation) => violation.targets.length > 0);
}

async function audit(page, frame, inCabinet) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  // analyze() opens and closes a blank page in this context; make the game the active page
  // again so its animation-frame loop (and rAF-polled waits) cannot stall afterwards, and
  // resume the run if the game paused itself while it was hidden.
  await page.bringToFront();
  await frame.evaluate(() => { if (paused) setPaused(false); });
  return gatedViolations(violations, inCabinet);
}

// Start screen, a live run, the paused run, and the game-over screen. The bird reaches the
// ground in about a second without flaps, well before the first pipe spawns, so the ending is
// deterministic.
async function auditEveryState(page, frame, inCabinet, startRun) {
  await expect.soft(await audit(page, frame, inCabinet), 'start screen').toEqual([]);
  await startRun();
  await expect.soft(await audit(page, frame, inCabinet), 'mid-game').toEqual([]);
  await page.keyboard.press('p');
  await expect.poll(() => frame.evaluate(() => paused), 'P pauses the run').toBe(true);
  await expect.soft(await audit(page, frame, inCabinet), 'paused').toEqual([]);
  await frame.waitForFunction(() => state === 'dead');
  await expect.soft(await audit(page, frame, inCabinet), 'game over').toEqual([]);
}

for (const colorScheme of ['light', 'dark']) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('standalone game has no accessibility violations of any impact', async ({ page }) => {
      await page.goto(candidate);
      await page.waitForFunction(() => typeof state !== 'undefined' && state === 'menu' && frame > 0);
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await auditEveryState(page, page.mainFrame(), false, async () => {
        await page.keyboard.press('Space');
        await expect.poll(() => page.evaluate(() => state)).toBe('play');
      });
    });

    test('game inside the cabinet has no serious or critical violations, and none of any impact in its frame', async ({ page }) => {
      await page.goto('/arcade/');
      await page.getByRole('button', { name: 'Play Flappy Copilot', exact: true }).click();
      const frame = await readyGame(page, candidate);
      await expect(frame.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await auditEveryState(page, frame, true, () => startWithSpace(page, frame));
    });
  });
}

test('the gate catches an injected serious violation and an injected moderate one', async ({ page }) => {
  await page.goto(candidate);
  await page.waitForFunction(() => typeof state !== 'undefined' && state === 'menu' && frame > 0);
  expect(await audit(page, page.mainFrame(), false)).toEqual([]);
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '#injected-violation';
    const stray = document.createElement('p');
    stray.textContent = 'injected text outside every landmark';
    document.body.append(link, stray);
  });
  const violations = await audit(page, page.mainFrame(), false);
  expect(violations.map(({ id, impact }) => `${id}:${impact}`).sort()).toEqual(['link-name:serious', 'region:moderate']);
});

test('the cabinet gate catches a moderate violation injected into the game frame', async ({ page }) => {
  await page.goto('/arcade/');
  await page.getByRole('button', { name: 'Play Flappy Copilot', exact: true }).click();
  const frame = await readyGame(page, candidate);
  expect(await audit(page, frame, true)).toEqual([]);
  await frame.evaluate(() => {
    const skipped = document.createElement('h4');
    skipped.textContent = 'injected heading two levels below the title';
    document.querySelector('main').append(skipped);
  });
  const violations = await audit(page, frame, true);
  expect(violations).toEqual([expect.objectContaining({ id: 'heading-order', impact: 'moderate' })]);
  expect(violations[0].targets.every((target) => target.length > 1)).toBe(true);
});
