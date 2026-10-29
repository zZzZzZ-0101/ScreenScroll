import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, FIXTURES } from './fixtures';

/** The UI for review (TESTING §3): every screen in a realistic state, plus one overview. */
const OUT = 'docs/screenshots';

test('UI screenshots and overview', async ({ context, serviceWorker }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const shots: Array<[string, string]> = [];
  const shoot = async (p: Page, name: string, label: string, element?: string) => {
    if (element) await p.locator(element).screenshot({ path: `${OUT}/${name}.png` });
    else await p.screenshot({ path: `${OUT}/${name}.png` });
    shots.push([`${OUT}/${name}.png`, label]);
  };

  const page = await context.newPage();
  await page.goto(`${FIXTURES}/article.html`);
  await page.bringToFront();
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, url });
    await (
      globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } }
    ).__spTest.capture(tab!.id!);
  }, `${FIXTURES}/article.html`);
  const studio = await studioPromise;
  await studio.setViewportSize({ width: 1280, height: 760 });
  await studio.waitForFunction(
    () => 'project' in ((window as unknown as { __spStudio?: object }).__spStudio ?? {}),
    null,
    { timeout: 60_000 },
  );
  await expect(studio.getByTestId('estimate')).toHaveText(/about/, { timeout: 20_000 });
  await studio.waitForTimeout(600);
  await shoot(studio, 'studio-pages', '1 · Pages: what will be saved');

  await studio.getByRole('button', { name: 'More ways to save' }).click();
  await shoot(studio, 'studio-save-menu', '2 · Save PDF, or anything else');
  await studio.keyboard.press('Escape');

  await studio.getByRole('tab', { name: 'Breaks' }).click();
  await studio.getByTestId('break').nth(1).hover();
  await studio.waitForTimeout(400);
  await shoot(studio, 'studio-breaks', '3 · Breaks: drag, add, remove');

  await studio.getByRole('tab', { name: 'Mark up' }).click();
  const b = (await studio.getByTestId('annotate-body').boundingBox())!;
  const drag = async (x0: number, y0: number, x1: number, y1: number) => {
    await studio.mouse.move(b.x + x0, b.y + y0);
    await studio.mouse.down();
    await studio.mouse.move(b.x + x1, b.y + y1, { steps: 6 });
    await studio.mouse.up();
  };
  await studio.keyboard.press('r');
  await drag(250, 150, 760, 210);
  await studio.keyboard.press('a');
  await drag(980, 120, 800, 175);
  await studio.keyboard.press('n');
  await studio.mouse.click(b.x + 230, b.y + 180);
  await studio.keyboard.press('t');
  await studio.mouse.click(b.x + 900, b.y + 90);
  await studio.keyboard.type('Start here');
  await studio.keyboard.press('Enter');
  await studio.keyboard.press('b');
  await drag(250, 100, 700, 130);
  await studio.keyboard.press('v');
  await studio.waitForTimeout(600);
  await shoot(studio, 'studio-markup', '4 · Mark up: one row of tools');

  await studio.getByRole('tab', { name: 'Pages' }).click();
  await studio.getByRole('button', { name: 'More options' }).click();
  await studio.waitForTimeout(600);
  await shoot(studio, 'studio-more-options', '5 · Everything else, folded away');

  await studio.emulateMedia({ colorScheme: 'dark' });
  await studio.getByRole('button', { name: 'More options' }).click();
  await studio.waitForTimeout(300);
  await shoot(studio, 'studio-dark', '6 · Dark mode');

  // Overview: popup at its own size next to the Studio screens, scaled down.
  const W = 640;
  const cols = 2;
  const imgs = await Promise.all(
    shots.map(async ([f, label]) => ({ img: await loadImage(f), label })),
  );
  const cell = (i: { img: { width: number; height: number } }) =>
    i.img.width <= 300 ? i.img.height : Math.round((i.img.height * W) / i.img.width);
  const rows: Array<typeof imgs> = [];
  for (let i = 0; i < imgs.length; i += cols) rows.push(imgs.slice(i, i + cols));
  const pad = 24;
  const labelH = 28;
  const heights = rows.map((r) => Math.max(...r.map(cell)) + labelH);
  const canvas = createCanvas(
    cols * W + (cols + 1) * pad,
    heights.reduce((a, h) => a + h + pad, pad),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eef1f1';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = pad;
  rows.forEach((r, ri) => {
    r.forEach((it, ci) => {
      const x = pad + ci * (W + pad);
      ctx.fillStyle = '#202124';
      ctx.font = '600 15px sans-serif';
      ctx.fillText(it.label, x, y + 18);
      const w = it.img.width <= 300 ? it.img.width : W;
      const h = cell(it);
      ctx.fillStyle = '#c9d1d1';
      ctx.fillRect(x - 1, y + labelH - 1, w + 2, h + 2);
      ctx.drawImage(it.img as never, x, y + labelH, w, h);
    });
    y += heights[ri]! + pad;
  });
  writeFileSync(`${OUT}/overview.png`, canvas.toBuffer('image/png'));
});
