import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test, FIXTURES } from './fixtures';

/**
 * Every fixture page, captured on screen and in the background (TESTING: edge matrix).
 * Each capture must end with frames or an explicit warning, leave the page as it was, cover
 * the page without gaps, and the two ways must agree on where the text is. In the
 * background the page must not move.
 */
const PAGES = [
  'animations.html',
  'article.html',
  'canvas-text.html',
  'changing.html',
  'cjk.html',
  'dialog.html',
  'doc-viewer.html',
  'fixed-background.html',
  'fixed-decor.html',
  'fluid.html',
  'hostile-title.html',
  'iframe-xorigin.html',
  'infinite.html',
  'inner-scroll.html',
  'lazy-images.html',
  'long-table.html',
  'modal-nested.html',
  'modal.html',
  'overlay-viewer.html',
  'personal.html',
  'scroll-lock.html',
  'shifting.html',
  'sticky-header.html',
  'tall-image.html',
  'tiny.html',
  'video.html',
  'virtual-list.html',
  'wide-margins.html',
];

interface Frame {
  docY: number;
  crop: { height: number };
  hints: { textRuns: Array<{ text: string; rect: { x: number; y: number } }> };
}
interface Run {
  done: { status: string; warnings: string[]; size?: { height: number } };
  frames: Frame[];
}

async function setQuiet(sw: Worker, quiet: boolean) {
  await sw.evaluate(async (q) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      settings: {
        ...(settings ?? {}),
        afterCapture: 'studio',
        capture: { ...(settings?.capture ?? {}), quiet: q },
      },
    });
  }, quiet);
}

/** What capturing must not change, and whether the page moved meanwhile. */
const snapshot = (page: Page) =>
  page.evaluate(() => ({
    scrollY,
    htmlStyle: document.documentElement.getAttribute('style'),
    bodyStyle: document.body.getAttribute('style'),
    styles: document.querySelectorAll('style').length,
    htmlClass: document.documentElement.className,
  }));

async function captureOnce(
  context: BrowserContext,
  sw: Worker,
  path: string,
  quiet: boolean,
): Promise<{ run: Run; moved: number[]; before: object; after: object }> {
  await setQuiet(sw, quiet);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${FIXTURES}/${path}`);
  await page.bringToFront();
  await page.waitForTimeout(300);
  const before = await snapshot(page);
  await page.evaluate(() => {
    const w = window as unknown as { moved: number[] };
    w.moved = [];
    addEventListener('scroll', () => w.moved.push(scrollY), { capture: true });
  });
  const studio = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
    timeout: 90_000,
  });
  const run = (await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, url });
    return (
      globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } }
    ).__spTest.capture(tab!.id!);
  }, `${FIXTURES}/${path}`)) as Run;
  await (await studio).close();
  await page.waitForTimeout(200);
  const after = await snapshot(page);
  const moved = await page.evaluate(() => (window as unknown as { moved: number[] }).moved);
  await page.close();
  return { run, moved, before, after };
}

function checkRun(path: string, how: string, r: Awaited<ReturnType<typeof captureOnce>>) {
  const { run } = r;
  const at = `${path} (${how})`;
  // Never silent: frames, or a reason.
  expect(run.frames.length > 0 || run.done.warnings.length > 0, at).toBe(true);
  expect(['complete', 'partial', 'error', 'cancelled'], at).toContain(run.done.status);
  if (run.done.status !== 'complete') expect(run.done.warnings.length, at).toBeGreaterThan(0);
  // The page is left as it was.
  expect(r.after, at).toEqual(r.before);
  // No gaps between frames.
  const fs = [...run.frames].sort((a, b) => a.docY - b.docY);
  let end = fs[0]?.docY ?? 0;
  for (const f of fs) {
    expect(f.docY, `${at}: gap before frame at ${f.docY}`).toBeLessThanOrEqual(end + 1);
    end = Math.max(end, f.docY + f.crop.height);
  }
}

/** Text runs by text, for texts that appear once (positions comparable across captures). */
function uniqueRuns(run: Run): Map<string, number> {
  const all = new Map<string, number[]>();
  for (const f of run.frames)
    for (const t of f.hints.textRuns) {
      const k = t.text.trim();
      if (k.length < 6) continue;
      all.set(k, [...(all.get(k) ?? []), t.rect.y]);
    }
  return new Map([...all].filter(([, ys]) => ys.length === 1).map(([k, ys]) => [k, ys[0]!]));
}

for (const path of PAGES) {
  test(`matrix: ${path} on screen and in the background`, async ({ context, serviceWorker }) => {
    test.setTimeout(180_000);
    const screen = await captureOnce(context, serviceWorker, path, false);
    checkRun(path, 'on screen', screen);
    const quiet = await captureOnce(context, serviceWorker, path, true);
    checkRun(path, 'in background', quiet);
    const inner = quiet.run.done.warnings.some((w) => /scrolls inside the page/.test(w));
    // In the background the page itself never moves (inner scroll areas still scroll).
    if (!inner)
      expect(new Set(quiet.moved.filter((y) => y !== quiet.before.scrollY)), path).toEqual(
        new Set(),
      );
    // Both ways agree on where the text is (pages that change between loads aside).
    if (!/changing|infinite|animations|virtual|shifting|video/.test(path) && !inner) {
      const a = uniqueRuns(screen.run);
      const b = uniqueRuns(quiet.run);
      const off: string[] = [];
      for (const [k, y] of a) {
        const y2 = b.get(k);
        if (y2 !== undefined && Math.abs(y2 - y) > 2) off.push(`${k.slice(0, 30)}: ${y} vs ${y2}`);
      }
      expect(off.slice(0, 5), path).toEqual([]);
      const missing = [...a.keys()].filter((k) => !b.has(k));
      expect(
        missing.length,
        `${path}: texts only on screen: ${missing.slice(0, 5).join(' | ')}`,
      ).toBeLessThanOrEqual(Math.ceil(a.size * 0.05));
    }
  });
}
