import type { Worker } from '@playwright/test';
import { expect, test, FIXTURES } from './fixtures';

type Hook = {
  start(tabId: number, mode: string, opts?: object): Promise<string>;
  wait(id: string): Promise<{
    done: { status: string; docHeight: number; warnings: string[] };
    frames: Array<{ dpr: number; imageWidth: number; docY: number }>;
  }>;
};

const capture = (sw: Worker, url: string) =>
  sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    const h = (globalThis as unknown as { __spTest: Hook }).__spTest;
    return h.wait(await h.start(tab!.id!, 'full'));
  }, url);

const stored = (sw: Worker) =>
  sw.evaluate(
    async () => (await chrome.storage.local.get('settings')).settings as Record<string, unknown>,
  );

test('settings page: every option with default and recommendation, reset, undo', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  for (const section of [
    'Capture',
    'Pages and PDF',
    'Text recognition',
    'Files and storage',
    'Appearance',
  ])
    await expect(page.getByRole('heading', { name: section })).toBeVisible();
  const speed = page.getByTestId('set-capture.speed');
  await expect(speed).toContainText('Default: Normal · Recommended: Normal');
  await page.screenshot({ path: 'docs/screenshots/settings.png', fullPage: true });

  // Change, see it stored; "Use recommended" and per-setting Reset.
  await speed.getByRole('radio', { name: 'Fast' }).click();
  await expect
    .poll(async () => ((await stored(serviceWorker)).capture as { speed: string }).speed)
    .toBe('fast');
  await expect(speed.getByRole('button', { name: 'Reset' })).toBeVisible();
  await speed.getByRole('button', { name: 'Use recommended' }).click();
  await expect
    .poll(async () => ((await stored(serviceWorker)).capture as { speed: string }).speed)
    .toBe('normal');

  const keep = page.getByTestId('set-keepDays');
  await keep.getByRole('radio', { name: '30 days' }).click();
  await page.getByTestId('set-theme').getByRole('radio', { name: 'Dark' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

  // Reset all, then Undo.
  await page.getByRole('button', { name: /Reset all \(2\)/ }).click();
  await expect.poll(async () => (await stored(serviceWorker)).keepDays).toBe(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await stored(serviceWorker)).keepDays).toBe(30);
});

test('capture settings: start where I am, sharp 2× capture, speeds', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  const url = `${FIXTURES}/article.html`;
  await page.goto(url);
  await page.bringToFront();
  const total = await page.evaluate(() => document.scrollingElement!.scrollHeight);

  const set = (patch: object) =>
    serviceWorker.evaluate(async (p) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...(settings as object), ...p } });
    }, patch);

  // "Where I am now": scrolled 2000 px down, the capture covers the rest of the page.
  await set({ capture: { start: 'here', speed: 'fast', resolution: 'standard' } });
  await page.evaluate(() => scrollTo(0, 2000));
  const here = await capture(serviceWorker, url);
  expect(here.done.docHeight).toBeCloseTo(total - 2000, -1);
  // The page is put back where it was.
  expect(await page.evaluate(() => scrollY)).toBe(2000);

  // Sharp: frames at 2 device px per CSS px, layout unchanged, override removed afterwards.
  await page.bringToFront(); // the Studio of the first capture came to the front
  await set({ capture: { start: 'top', speed: 'normal', resolution: 'high' } });
  const width = await page.evaluate(() => innerWidth);
  const sharp = await capture(serviceWorker, url);
  expect(sharp.done.status).toBe('complete');
  expect(sharp.frames.every((f) => f.dpr === 2 && f.imageWidth === width * 2)).toBe(true);
  expect(sharp.done.docHeight).toBe(total);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
});
