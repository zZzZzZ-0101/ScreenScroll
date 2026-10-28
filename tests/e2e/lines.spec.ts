import { expect, test, FIXTURES } from './fixtures';

type Hook = {
  start(tabId: number, mode: string): Promise<string>;
  wait(id: string): Promise<{ done: { status: string; docWidth: number; docHeight: number } }>;
  capture(tabId: number): Promise<{ done: { docWidth: number; docHeight: number } }>;
};

test('line to line: click a first line, scroll, click a last line; everything between', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  const url = `${FIXTURES}/article.html`;
  await page.goto(url);
  await page.bringToFront();
  const id = await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    return (globalThis as unknown as { __spTest: Hook }).__spTest.start(tab!.id!, 'lines');
  }, url);
  // The picker is up: a guide line follows the pointer.
  await page.mouse.move(400, 200);
  await page.waitForTimeout(200);
  await page.mouse.click(400, 200);
  await page.screenshot({ path: 'e2e-artifacts/lines-start.png' });
  // Scroll freely with the wheel, far past one screen, then click the last line.
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(400);
  const scrolled = await page.evaluate(() => scrollY);
  await page.mouse.move(400, 500);
  await page.screenshot({ path: 'e2e-artifacts/lines-end.png' });
  await page.mouse.click(400, 500);
  const result = await serviceWorker.evaluate(
    (i) => (globalThis as unknown as { __spTest: Hook }).__spTest.wait(i),
    id,
  );
  expect(result.done.status).toBe('complete');
  expect(result.done.docHeight).toBeCloseTo(scrolled + 300, -1);
  expect(result.done.docWidth).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  // Clicks during picking never reached the page (no link was followed).
  expect(page.url()).toBe(url);
});

test('line to line: Enter captures from the first line to the end', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  const url = `${FIXTURES}/article.html`;
  await page.goto(url);
  await page.bringToFront();
  const id = await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    return (globalThis as unknown as { __spTest: Hook }).__spTest.start(tab!.id!, 'lines');
  }, url);
  await page.waitForTimeout(300);
  await page.mouse.click(300, 100);
  await page.keyboard.press('Enter');
  const result = await serviceWorker.evaluate(
    (i) => (globalThis as unknown as { __spTest: Hook }).__spTest.wait(i),
    id,
  );
  const total = await page.evaluate(() => document.scrollingElement!.scrollHeight);
  expect(result.done.docHeight).toBeCloseTo(total - 100, -1);
});

test('full page picks the viewer in front, not the larger list behind it', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  const url = `${FIXTURES}/overlay-viewer.html`;
  await page.goto(url);
  await page.bringToFront();
  const result = await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    return (globalThis as unknown as { __spTest: Hook }).__spTest.capture(tab!.id!);
  }, url);
  const viewer = await page.evaluate(() => {
    const v = document.getElementById('viewer')!;
    return { height: v.scrollHeight, width: v.clientWidth };
  });
  expect(result.done.docHeight).toBe(viewer.height);
  expect(result.done.docWidth).toBe(viewer.width);
});
