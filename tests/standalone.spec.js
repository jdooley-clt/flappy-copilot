import { test, expect, canvasFits, expectCspMeta, expectSpaceReachesGame } from './helpers.js';

const candidate = '/flappy-copilot/';
const arcadeUrl = 'https://jdooley-clt.github.io/arcade/';

test.beforeEach(async ({ page }) => {
  await page.goto(candidate);
  await page.waitForFunction(() => typeof state !== 'undefined' && state === 'menu' && frame > 0);
});

test('ships the Content Security Policy and referrer policy without inline code', async ({ page }) => {
  await expectCspMeta(page.mainFrame());
  expect(await page.locator('script:not([src]), style, [style], [onclick], [onkeydown]').count()).toBe(0);
  for (const rel of await page.locator('a[target="_blank"]').evaluateAll((anchors) => anchors.map((a) => a.rel))) {
    expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
  }
});

test('standalone chrome fits desktop, narrow portrait, and landscape without overlapping the canvas', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await canvasFits(page.mainFrame());
    await expect(page.getByRole('heading', { level: 1, name: /flappy-copilot\.exe/ })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Flappy Copilot game', exact: true })).toBeVisible();
    const link = page.getByRole('link', { name: 'GitHub Arcade', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', arcadeUrl);
    expect(await link.getAttribute('target')).toBeNull();
    const bounds = await link.boundingBox();
    const canvas = await page.locator('#game').boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    // The pause button is a real target (WCAG 2.5.8 asks for at least 24 by 24 CSS pixels).
    const button = await page.getByRole('button', { name: 'Pause', exact: true }).boundingBox();
    expect(button.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    expect(button.y + button.height).toBeLessThanOrEqual(viewport.height);
    expect(button.width).toBeGreaterThanOrEqual(24);
    expect(button.height).toBeGreaterThanOrEqual(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    if (viewport.width === 1280) expect(canvas.height).toBe(792);
  }
});

test('navigation focus is isolated from game input and canvas interaction restores Space', async ({ page, isMobile, browserName }) => {
  const link = page.getByRole('link', { name: 'GitHub Arcade', exact: true });
  // WebKit's default keyboard navigation uses Option+Tab to include links.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.keyboard.press(tab);
  await expect(page.locator('#pause-button')).toBeFocused();
  await page.keyboard.press(tab);
  await expect(link).toBeFocused();
  expect(await link.evaluate((anchor) => anchor.matches(':focus-visible'))).toBe(true);
  expect(await link.evaluate((anchor) => getComputedStyle(anchor).outlineStyle)).toBe('solid');
  await page.keyboard.press('Space');
  await page.keyboard.press('m');
  expect(await page.evaluate(() => ({ state, muted }))).toEqual({ state: 'menu', muted: false });

  // Observe the original document after a real click/tap without leaving it.
  await link.evaluate((anchor) => anchor.addEventListener('click', (event) => event.preventDefault(), { once: true }));
  if (isMobile) await link.tap();
  else await link.click();
  expect(await page.evaluate(() => state)).toBe('menu');

  if (isMobile) await page.locator('#game').tap();
  else await page.locator('#game').click();
  expect(await page.evaluate(() => state)).toBe('play');
  await expect(link).not.toBeFocused();
  await expectSpaceReachesGame(page, page.mainFrame());
});

test('Enter follows the same-tab Arcade destination', async ({ page, browserName }) => {
  // Keep this deterministic; the review browser pass checks the real public site.
  await page.route(arcadeUrl, (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Arcade navigation destination</title>',
  }));
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.keyboard.press(tab);
  await page.keyboard.press(tab);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(arcadeUrl);
  await expect(page).toHaveTitle('Arcade navigation destination');
});

test('P pauses and resumes every state and the status region announces each change', async ({ page }) => {
  const status = page.getByRole('status');
  await page.keyboard.press('p');
  await expect.poll(() => page.evaluate(() => paused)).toBe(true);
  await expect(status).toHaveText('Paused');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  const frozen = await page.evaluate(() => frame);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => ({ frame, state }))).toEqual({ frame: frozen, state: 'menu' });
  await page.keyboard.press('p');
  await expect(status).toHaveText('Resumed');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => frame)).toBeGreaterThan(frozen);

  // A paused run holds the bird where it is; one Space resumes and flaps.
  await page.keyboard.press('Space');
  await expect(status).toHaveText('Run started');
  await page.keyboard.press('p');
  await expect.poll(() => page.evaluate(() => paused)).toBe(true);
  const held = await page.evaluate(() => ({ frame, y: bird.y, state: 'play' }));
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => ({ frame, y: bird.y, state }))).toEqual(held);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => ({ paused, state, flapped: bird.vy < 0 })))
    .toEqual({ paused: false, state: 'play', flapped: true });

  await page.waitForFunction(() => state === 'dead');
  await expect(status).toHaveText(/^Game over\. Score \d+\. Best \d+\./);
  await page.keyboard.press('m');
  await expect(status).toHaveText('Audio muted');
  await page.keyboard.press('m');
  await expect(status).toHaveText('Audio unmuted');
});

test('the pause button works from the keyboard and by pointer without leaking game keys', async ({ page, isMobile, browserName }) => {
  const button = page.locator('#pause-button');
  await expect(button).toHaveAttribute('aria-keyshortcuts', 'P');
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(button).toBeFocused();
  expect(await button.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  // Flap keys stop at the focused button; Space activates it instead of flapping.
  await page.keyboard.press('w');
  await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(() => ({ state, paused }))).toEqual({ state: 'menu', paused: false });
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => paused)).toBe(true);
  await expect(button).toHaveText('Resume');
  expect(await page.evaluate(() => state)).toBe('menu');
  // Resuming hands the keyboard back to the game, so the next Space starts the run.
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => paused)).toBe(false);
  await expect(button).not.toBeFocused();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => state)).toBe('play');

  if (isMobile) await button.tap();
  else await button.click();
  await expect.poll(() => page.evaluate(() => paused)).toBe(true);
  await expect(button).toHaveText('Resume');
  if (isMobile) await button.tap();
  else await button.click();
  await expect.poll(() => page.evaluate(() => paused)).toBe(false);
  await expect(button).not.toBeFocused();
  await expectSpaceReachesGame(page, page.mainFrame());
});

test('a hidden page pauses a live run without penalty and does not pause the start screen', async ({ page }) => {
  const hidePage = () => page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  await hidePage();
  expect(await page.evaluate(() => paused)).toBe(false);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => state)).toBe('play');
  await hidePage();
  expect(await page.evaluate(() => paused)).toBe(true);
  await expect(page.getByRole('status')).toHaveText('Paused');
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => ({ paused, flapped: bird.vy < 0 }))).toEqual({ paused: false, flapped: true });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('decorative motion stops while the game stays playable', async ({ page }) => {
    const before = await page.evaluate(() => ({ frame, star: stars[0].x }));
    await expect.poll(() => page.evaluate(() => frame)).toBeGreaterThan(before.frame + 10);
    expect(await page.evaluate(() => ({ y: bird.y, star: stars[0].x }))).toEqual({ y: 280, star: before.star });
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => state)).toBe('play');
    await page.waitForFunction(() => state === 'dead');
    expect(await page.evaluate(() => shakeT)).toBe(0);
  });
});
