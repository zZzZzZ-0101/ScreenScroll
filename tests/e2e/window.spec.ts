import { expect, test } from './fixtures';

/**
 * Capture a window: the browser's picker can't be driven from a test, so the shared stream
 * is a canvas with a known picture; everything after it (one frame, sharing stopped, saved,
 * opened in the Studio) is the real path.
 */
test('capture a window: one picture of what was shared, opened in the Studio', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { stopped: number };
    w.stopped = 0;
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 600;
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 900, 600);
      g.fillStyle = '#0e7c7b';
      g.fillRect(0, 0, 900, 60);
      g.fillStyle = '#222';
      for (let y = 100; y < 560; y += 30) g.fillRect(40, y, 700, 12);
      // Keep drawing, as a live window would.
      setInterval(() => g.fillRect(0, 590, 1, 1), 50);
      const s = c.captureStream(30);
      for (const tr of s.getTracks()) {
        const stop = tr.stop.bind(tr);
        tr.stop = () => {
          w.stopped++;
          stop();
        };
      }
      return s;
    };
  });
  await page.goto(`chrome-extension://${extensionId}/window.html`);
  await expect(page.getByRole('heading', { name: 'Capture a window' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose what to capture' }).click();
  await page.waitForURL(/studio\.html\?session=/, { timeout: 30_000 });
  await page.waitForFunction(
    () => 'slices' in ((window as unknown as { __spStudio?: object }).__spStudio ?? {}),
    null,
    { timeout: 30_000 },
  );
  const slices = await page.evaluate(() =>
    (
      window as unknown as { __spStudio: { slices(): Array<{ y0: number; y1: number }> } }
    ).__spStudio.slices(),
  );
  expect(slices).toHaveLength(1);
  // The blank rows at the bottom are trimmed, as for any capture.
  expect(slices[0]!.y1).toBeGreaterThan(550);
  expect(slices[0]!.y1).toBeLessThanOrEqual(600);
  await expect(page.getByRole('heading', { name: /^Window / })).toBeVisible();
});

test('capture a window: cancelling the picker says nothing was captured', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError');
    };
  });
  await page.goto(`chrome-extension://${extensionId}/window.html`);
  await page.getByRole('button', { name: 'Choose what to capture' }).click();
  await expect(page.getByRole('status')).toHaveText('Nothing was shared, so nothing was captured.');
});
