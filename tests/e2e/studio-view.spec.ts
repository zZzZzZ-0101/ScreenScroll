import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test, FIXTURES } from './fixtures';

async function studioFor(context: BrowserContext, sw: Worker, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${FIXTURES}/${path}`);
  await page.bringToFront();
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await (
      globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } }
    ).__spTest.capture(tab!.id!);
  }, `${FIXTURES}/${path}`);
  const studio = await studioPromise;
  await studio.setViewportSize({ width: 1400, height: 900 });
  await studio.waitForFunction(
    () => 'project' in ((window as unknown as { __spStudio?: object }).__spStudio ?? {}),
    null,
    {
      timeout: 60_000,
    },
  );
  return studio;
}

const firstPageWidth = (studio: Page) =>
  studio
    .getByTestId('pages-view')
    .locator('div.relative.bg-white')
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);

test('zoom like a PDF viewer: buttons, presets, keys and Ctrl+wheel', async ({
  context,
  serviceWorker,
}) => {
  const studio = await studioFor(context, serviceWorker, 'article.html');
  const level = studio.getByRole('combobox', { name: 'Zoom level' });
  await expect(level).toHaveValue('page'); // fits a whole page by default
  const fit = await firstPageWidth(studio);

  await level.selectOption('1');
  // 100% = actual size: A4 is 595 pt = 794 CSS px.
  await expect.poll(() => firstPageWidth(studio)).toBeCloseTo(794, -1);
  await studio.getByRole('button', { name: 'Zoom in' }).click();
  await expect(level).toHaveValue('1.1');
  await studio.getByRole('button', { name: 'Zoom out' }).click();
  await studio.getByRole('button', { name: 'Zoom out' }).click();
  await expect(level).toHaveValue('0.9');

  await studio.getByTestId('pages-view').click({ position: { x: 5, y: 5 } });
  await studio.keyboard.press('+');
  await expect(level).toHaveValue('1');
  await studio.keyboard.press('0');
  await expect(level).toHaveValue('page');
  expect(await firstPageWidth(studio)).toBeCloseTo(fit, 0);

  // Ctrl+wheel zooms the pages, not the browser.
  const box = (await studio.getByTestId('pages-view').boundingBox())!;
  await studio.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await studio.keyboard.down('Control');
  await studio.mouse.wheel(0, -100);
  await studio.keyboard.up('Control');
  await expect.poll(() => firstPageWidth(studio)).toBeGreaterThan(fit);
  expect(await studio.evaluate(() => window.devicePixelRatio)).toBe(1);

  // Fit width fills the view; the zoom survives a reload.
  await level.selectOption('width');
  await expect.poll(() => firstPageWidth(studio)).toBeGreaterThan(900);
  await studio.reload();
  await expect(studio.getByRole('combobox', { name: 'Zoom level' })).toHaveValue('width', {
    timeout: 60_000,
  });

  // Mark up has its own fit: zooming there changes the drawing scale.
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await level.selectOption('2');
  const w = await studio
    .getByTestId('annotate-body')
    .evaluate((el) => el.getBoundingClientRect().width);
  const css = await studio.evaluate(
    () =>
      (window as unknown as { __spStudio: { size(): { width: number } } }).__spStudio.size().width,
  );
  expect(w).toBeCloseTo(css * 2, -1);
});

test('theme: system, light, dark, remembered everywhere', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const studio = await studioFor(context, serviceWorker, 'tiny.html');
  const theme = () => studio.evaluate(() => document.documentElement.dataset.theme);
  await studio.emulateMedia({ colorScheme: 'light' });
  expect(await theme()).toBe('light');
  await studio.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(theme).toBe('dark'); // System follows the system

  await studio.getByRole('button', { name: 'Theme: System' }).click(); // → Light
  await expect.poll(theme).toBe('light');
  await studio.getByRole('button', { name: 'Theme: Light' }).click(); // → Dark
  await expect.poll(theme).toBe('dark');
  const header = await studio.evaluate(
    () => getComputedStyle(document.querySelector('header')!).backgroundColor,
  );
  expect(header).not.toBe('rgb(255, 255, 255)');

  // Other pages follow the stored choice.
  await studio.emulateMedia({ colorScheme: 'light' });
  const other = await context.newPage();
  await other.emulateMedia({ colorScheme: 'light' });
  await other.goto(`chrome-extension://${extensionId}/captures.html`);
  await expect
    .poll(() => other.evaluate(() => document.documentElement.dataset.theme))
    .toBe('dark');
});

test('side panel: resize by dragging, move to the other side, hide and show', async ({
  context,
  serviceWorker,
}) => {
  const studio = await studioFor(context, serviceWorker, 'tiny.html');
  const panel = studio.getByTestId('side-panel');
  const before = (await panel.boundingBox())!;
  expect(before.x + before.width).toBeCloseTo(1400, -1); // on the right

  const edge = studio.getByRole('separator', { name: 'Resize panel' });
  const e = (await edge.boundingBox())!;
  await studio.mouse.move(e.x + e.width / 2, e.y + 100);
  await studio.mouse.down();
  await studio.mouse.move(e.x - 120, e.y + 100, { steps: 6 });
  await studio.mouse.up();
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeCloseTo(before.width + 120, -1);
  // Keyboard resizing on the edge.
  await edge.focus();
  await studio.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeCloseTo(before.width + 104, -1);

  await studio.getByRole('button', { name: 'Move panel to the left' }).click();
  await expect.poll(async () => (await panel.boundingBox())!.x).toBeLessThan(10);
  await studio.screenshot({ path: 'e2e-artifacts/panel-left.png' });

  await studio.getByRole('button', { name: 'Hide panel' }).click();
  await expect(panel).toBeHidden();
  await studio.reload();
  await expect(studio.getByRole('button', { name: 'Show panel' })).toBeVisible({ timeout: 60_000 });
  await studio.getByRole('button', { name: 'Show panel' }).click();
  await expect(studio.getByTestId('side-panel')).toBeVisible();
  expect((await studio.getByTestId('side-panel').boundingBox())!.x).toBeLessThan(10); // still left
});
