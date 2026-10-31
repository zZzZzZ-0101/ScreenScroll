import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from './fixtures';

test('Open an image: a tall screenshot becomes a capture, paginated between its lines', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // 800 × 5000 px: lines of "text" (dark bars) with gaps, like a long chat screenshot.
  const c = createCanvas(800, 5000);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 800, 5000);
  g.fillStyle = '#222';
  for (let y = 40; y < 4960; y += 28) g.fillRect(60, y, 600 + ((y * 7) % 80), 14);
  mkdirSync('e2e-artifacts', { recursive: true });
  const file = 'e2e-artifacts/long-screenshot.png';
  writeFileSync(file, c.toBuffer('image/png'));

  const lib = await context.newPage();
  await lib.goto(`chrome-extension://${extensionId}/captures.html`);
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await lib.locator('input[type=file]').setInputFiles(file);
  const studio = await studioPromise;
  await expect(studio.getByRole('heading', { name: 'long-screenshot' })).toBeVisible({
    timeout: 30_000,
  });
  type Slice = { y0: number; y1: number };
  const slices = () =>
    studio.evaluate(() =>
      (window as unknown as { __spStudio: { slices(): Slice[] } }).__spStudio.slices(),
    );
  await expect.poll(async () => (await slices()).length).toBeGreaterThan(1);
  const got = await slices();
  expect(got[0]!.y0).toBe(0);
  expect(got.at(-1)!.y1).toBeGreaterThan(4950);
  // Every break falls between bars: rows 14–27 of each 28-row pitch from 40, or exactly at a
  // bar's first row (slices are [y0, y1), so the bar starts the next page).
  for (const s of got.slice(0, -1)) {
    const r = (s.y1 - 40) % 28;
    expect(r === 0 || r >= 14).toBe(true);
  }
  // Stored in 1000-row frames.
  const frames = await serviceWorker.evaluate(async () => {
    const req = indexedDB.open('scrollpress');
    const d: IDBDatabase = await new Promise((res) => (req.onsuccess = () => res(req.result)));
    const all: { imageHeight: number; sessionId: string }[] = await new Promise((res) => {
      const q = d.transaction('frames').objectStore('frames').getAll();
      q.onsuccess = () => res(q.result);
    });
    return all.map((f) => f.imageHeight);
  });
  expect(frames).toEqual([1000, 1000, 1000, 1000, 1000]);
  await expect(lib.getByText('long-screenshot')).toBeVisible();
});

test('Open an image: a file that is not an image says so', async ({ context, extensionId }) => {
  mkdirSync('e2e-artifacts', { recursive: true });
  writeFileSync('e2e-artifacts/not-an-image.png', 'just text');
  const lib = await context.newPage();
  await lib.goto(`chrome-extension://${extensionId}/captures.html`);
  await lib.locator('input[type=file]').setInputFiles('e2e-artifacts/not-an-image.png');
  await expect(
    lib.getByText('not-an-image.png is not an image this browser can open.'),
  ).toBeVisible();
});
