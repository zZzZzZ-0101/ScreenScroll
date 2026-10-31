import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, FIXTURES } from './fixtures';

const WARNING =
  'A pop-up or overlay was covering the page and appears in the capture. Hide pop-ups and capture again to remove it.';

interface Result {
  id: string;
  done: { status: string; docHeight: number; warnings: string[] };
}
type Hook = {
  start(id: number, mode?: string, opts?: { hideOverlays?: boolean }): Promise<string>;
  wait(id: string): Promise<Result>;
  frameImages(id: string): Promise<string[]>;
};

async function run(
  context: import('@playwright/test').BrowserContext,
  sw: import('@playwright/test').Worker,
  path: string,
  hideOverlays: boolean,
) {
  const page = await context.newPage();
  await page.goto(`${FIXTURES}/${path}`);
  await page.bringToFront();
  const result = await sw.evaluate(
    async ([u, hide]) => {
      const [tab] = await chrome.tabs.query({ active: true, url: u as string });
      const hook = (globalThis as unknown as { __spTest: Hook }).__spTest;
      return hook.wait(await hook.start(tab!.id!, 'full', { hideOverlays: hide as boolean }));
    },
    [`${FIXTURES}/${path}`, hideOverlays],
  );
  return { page, result };
}

/** Grey of the first frame at (x, y) CSS px. */
async function greyAt(sw: import('@playwright/test').Worker, id: string, x: number, y: number) {
  const [png] = await sw.evaluate(
    (i) => (globalThis as unknown as { __spTest: Hook }).__spTest.frameImages(i),
    id,
  );
  const img = await loadImage(Buffer.from(png!, 'base64'));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(x, y, 1, 1).data;
  return (d[0]! + d[1]! + d[2]!) / 3;
}

for (const [path, hidden] of [
  ['modal.html', 2],
  ['modal-nested.html', 1],
  ['dialog.html', 1],
] as const) {
  test(`overlay killer on ${path}: warned without it, hidden with it, page put back`, async ({
    context,
    serviceWorker,
  }) => {
    const off = await run(context, serviceWorker, path, false);
    expect(off.result.done.warnings).toContain(WARNING);
    // The dimming is in the picture: the white page beside the pop-up is grey.
    expect(await greyAt(serviceWorker, off.result.id, 8, 200)).toBeLessThan(200);

    const on = await run(context, serviceWorker, path, true);
    expect(on.result.done.status).toBe('complete');
    expect(on.result.done.warnings).not.toContain(WARNING);
    expect(on.result.done.warnings).toContain(
      `${hidden} pop-up ${hidden === 1 ? 'layer was' : 'layers were'} hidden for this capture.`,
    );
    expect(await greyAt(serviceWorker, on.result.id, 8, 200)).toBeGreaterThan(245);
    // For review: the first screen with and without the overlay killer.
    mkdirSync('e2e-artifacts', { recursive: true });
    for (const [tag, r] of [
      ['off', off],
      ['on', on],
    ] as const) {
      const [png] = await serviceWorker.evaluate(
        (i) => (globalThis as unknown as { __spTest: Hook }).__spTest.frameImages(i),
        r.result.id,
      );
      writeFileSync(`e2e-artifacts/overlay-${path}-${tag}.png`, Buffer.from(png!, 'base64'));
    }
    expect(on.result.done.docHeight).toBeGreaterThan(1500);
    // Afterwards the pop-up is back, exactly as it was.
    const shown = await on.page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('.modal, .backdrop, .wall, dialog')].every(
          (el) => getComputedStyle(el).display !== 'none' && !el.style.display,
        ) && !!document.querySelector('.modal, .wall, dialog[open]'),
    );
    expect(shown).toBe(true);
  });
}

for (const path of ['fixed-decor.html', 'doc-viewer.html']) {
  test(`no pop-up on ${path}: no warning, nothing hidden`, async ({ context, serviceWorker }) => {
    const { result } = await run(context, serviceWorker, path, true);
    expect(result.done.warnings.join(' ')).not.toMatch(/pop-up/);
  });
}

test('Studio: "Hide pop-ups and capture again" opens a capture without the pop-up', async ({
  context,
  serviceWorker,
}) => {
  const first = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await run(context, serviceWorker, 'modal.html', false);
  const studio = await first;
  await studio.getByRole('button', { name: /1 note/ }).click();
  const second = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html') && p !== studio,
  });
  await studio.getByRole('button', { name: 'Hide pop-ups and capture again' }).click();
  const again = await second;
  await again.getByRole('button', { name: /1 note/ }).click();
  await expect(again.getByTestId('warnings')).toContainText('2 pop-up layers were hidden');
});
