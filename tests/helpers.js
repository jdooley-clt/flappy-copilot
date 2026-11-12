import { test as base, expect } from '@playwright/test';

// The exact policy index.html ships. Loosening it must be a deliberate change here too.
export const cspPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none';"
  + " media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none';"
  + " base-uri 'none'; form-action 'none'";

export const test = base.extend({
  page: async ({ page }, use) => {
    const failures = [];
    const failedRequests = [];
    const cspViolations = [];
    // Every frame, including the game inside the cabinet, reports violations as they happen,
    // so a frame that is later reloaded or removed cannot hide one.
    await page.exposeBinding('__reportCspViolation', ({ frame }, report) => {
      cspViolations.push(`${frame.url()}: ${report}`);
    });
    await page.addInitScript(() => {
      window.addEventListener('securitypolicyviolation', (event) => {
        window.__reportCspViolation(`${event.violatedDirective} blocked ${event.blockedURI}`
          + ` (${event.sourceFile || event.documentURI}:${event.lineNumber})`);
      });
    });
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });
    page.on('requestfailed', (request) => {
      failedRequests.push(request);
    });
    await use(page);
    for (const request of failedRequests) {
      const reason = request.failure()?.errorText;
      // Cancellation can be emitted before framedetached. Check after the interaction,
      // and exclude only canceled navigations whose browsing context was removed.
      if (request.isNavigationRequest() && request.frame().isDetached()
          && ['net::ERR_ABORTED', 'cancelled'].includes(reason)) continue;
      failures.push(`${reason} ${request.url()}`);
    }
    expect.soft(cspViolations, 'No Content Security Policy violations in any frame').toEqual([]);
    expect(failures, 'No uncaught errors, console errors, or missing requested assets').toEqual([]);
  },
});
export { expect };

export async function expectCspMeta(frame) {
  const csp = frame.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(csp).toHaveAttribute('content', cspPolicy);
  // A meta policy only governs what follows it, so nothing but the charset may precede it.
  expect(await csp.evaluate((meta) => [...meta.parentNode.children].indexOf(meta))).toBe(1);
  await expect(frame.locator('meta[name="referrer"]')).toHaveAttribute('content', 'strict-origin-when-cross-origin');
}

export async function readyGame(page, expectedUrl) {
  const iframe = page.locator('#frame-host iframe');
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute('src', expectedUrl);
  await expect.poll(() => page.frames().find((frame) => frame.url() === expectedUrl)?.url()).toBe(expectedUrl);
  const frame = page.frames().find((entry) => entry.url() === expectedUrl);
  await frame.waitForFunction(() => typeof state !== 'undefined' && state === 'menu' && frame > 0);
  await expect.poll(() => frame.evaluate(() => {
    const pixels = document.querySelector('canvas').getContext('2d').getImageData(0, 0, 480, 640).data;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    }
    return colors.size;
  }), { message: 'Real game draw loop painted a nonblank, multicolor menu' }).toBeGreaterThan(10);
  return frame;
}

export async function startWithSpace(page, frame) {
  // Deliberately no focus/click inside the game: this catches the cabinet's launch regression.
  await page.keyboard.press('Space');
  await expect.poll(() => frame.evaluate(() => state)).toBe('play');
  await expect(page.locator('#library')).toBeHidden();
  await expect(page.locator('#frame-host iframe')).toBeFocused();
  await expect.poll(() => frame.evaluate(() => bird.vy)).toBeLessThan(0);
}

// Space must reach the game whatever the physics did meanwhile. A live run flaps the bird
// upward; a finished run restarts once the game accepts input again (30 frames after dying).
// Random pipe gaps can end a run at any moment, so this never depends on survival.
export async function expectSpaceReachesGame(page, frame) {
  for (let attempt = 1; ; attempt++) {
    await frame.waitForFunction(() => state !== 'dead' || deadT > 30);
    const before = await frame.evaluate(() => state);
    await page.keyboard.press('Space');
    const outcome = await frame.waitForFunction((previous) => {
      if (state === 'play' && bird.vy < 0) return 'flap';
      if (previous === 'dead' && state === 'play') return 'restart';
      if (previous !== 'dead' && state === 'dead') return 'died';
      return false;
    }, before);
    if (await outcome.jsonValue() !== 'died') return;
    // The bird died between the state check and the key press; press again once input reopens.
    expect(attempt, 'Space reaches the game within a few runs').toBeLessThan(4);
  }
}

// Pipes spawn 92 frames into a run and only advance while the run is alive. Keep the bird
// flapping until a pipe has left its spawn column; if a death ends the run first, restart
// and try again rather than failing on physics the test does not control.
export async function expectPipesAdvance(page, frame) {
  await expect.poll(async () => {
    const snapshot = await frame.evaluate(() => ({
      state, deadT, y: bird.y, vy: bird.vy, advanced: pipes.some((pipe) => pipe.x < W + 10),
    }));
    if (snapshot.advanced) return true;
    const canRestart = snapshot.state === 'dead' && snapshot.deadT > 30;
    const shouldFlap = snapshot.state === 'play' && snapshot.vy > 0 && snapshot.y > 240;
    if (canRestart || shouldFlap) await page.keyboard.press('Space');
    return false;
  }, { message: 'Pipes advance from their spawn column during a live run', intervals: [40], timeout: 30_000 })
    .toBe(true);
}

export async function canvasFits(frame) {
  const bounds = await frame.locator('#game').evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  expect(bounds.width).toBeGreaterThan(100);
  expect(bounds.height).toBeGreaterThan(100);
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.y).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight + 1);
  expect(bounds.width / bounds.height).toBeCloseTo(3 / 4, 2);
}
