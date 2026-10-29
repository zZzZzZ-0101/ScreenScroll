import type { BrowserContext, Page, Worker } from '@playwright/test';
import { mergeHints, type DomHints } from '../../packages/core/src/hints';
import { expect, test, FIXTURES } from './fixtures';

interface Result {
  done: { status: string; warnings: string[] };
  frames: Array<{ hints: DomHints; hintsMs: number }>;
}

async function capture(context: BrowserContext, sw: Worker, path: string) {
  const page = await context.newPage();
  await page.goto(`${FIXTURES}/${path}`);
  await page.bringToFront();
  const result = (await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, url });
    const hook = (globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } })
      .__spTest;
    return hook.capture(tab!.id!);
  }, `${FIXTURES}/${path}`)) as Result;
  return { page, result, hints: mergeHints(result.frames.map((f) => f.hints)) };
}

/** Ground truth: every text line box in region coordinates, measured independently per character run. */
function lineBoxes(page: Page, rootSelector: string | null) {
  return page.evaluate((sel) => {
    const root = sel ? document.querySelector(sel)! : document.body;
    const scroller = sel ? root : document.scrollingElement!;
    const originTop = sel ? root.getBoundingClientRect().top + root.clientTop : 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const boxes: Array<{ y0: number; y1: number; text: string }> = [];
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue?.trim() || !n.parentElement?.checkVisibility()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width && r.height) {
          boxes.push({
            y0: r.top - originTop + scroller.scrollTop,
            y1: r.bottom - originTop + scroller.scrollTop,
            text: n.nodeValue.trim().slice(0, 20),
          });
        }
      }
    }
    return boxes;
  }, rootSelector);
}

function uncovered(boxes: Array<{ y0: number; y1: number; text: string }>, hints: DomHints) {
  const lines = hints.forbidden.filter((f) => f.kind === 'line');
  return boxes.filter((b) => !lines.some((f) => f.y0 <= b.y0 + 0.5 && f.y1 >= b.y1 - 0.5));
}

test('article: hints cover every text line and describe its structure', async ({
  context,
  serviceWorker,
}) => {
  const { page, result, hints } = await capture(context, serviceWorker, 'article.html');
  expect(result.done.warnings).toEqual([]);
  const boxes = await lineBoxes(page, null);
  expect(boxes.length).toBeGreaterThan(100);
  expect(uncovered(boxes, hints)).toEqual([]);

  // Headings: a section boundary at each h2 top and keep-with-next for each heading.
  const h2Tops = await page.evaluate(() =>
    [...document.querySelectorAll('h2')].map((h) => h.getBoundingClientRect().top + scrollY),
  );
  for (const y of h2Tops) {
    expect(hints.blockEnds.some((b) => b.kind === 'section' && Math.abs(b.y - y) < 1)).toBe(true);
    expect(hints.keepWithNext.some((k) => Math.abs(k.y0 - y) < 1 && k.y1 > y + 20)).toBe(true);
  }
  expect(hints.blockEnds.filter((b) => b.kind === 'paragraph').length).toBeGreaterThan(20);
  expect(hints.blockEnds.filter((b) => b.kind === 'line').length).toBeGreaterThan(50);
  expect(hints.forbidden.filter((f) => f.kind === 'atomic')).toHaveLength(2); // the two svg figures

  expect(hints.links.map((l) => l.href).sort()).toEqual([
    `${FIXTURES}/article.html#s4`,
    'https://example.org/ref',
  ]);
  const text = hints.textRuns.map((t) => t.text).join(' ');
  expect(text).toContain('Section 8');
  expect(text).toContain('Article fixture');

  // CAPTURE §11 budget.
  for (const f of result.frames) expect(f.hintsMs).toBeLessThan(50);
});

test('inner scroller: hints are in panel coordinates', async ({ context, serviceWorker }) => {
  const { page, hints } = await capture(context, serviceWorker, 'inner-scroll.html');
  const boxes = await lineBoxes(page, '#panel');
  expect(uncovered(boxes, hints)).toEqual([]);
  const end = hints.textRuns.find((t) => t.text.includes('END OF PANEL'))!;
  const scrollHeight = await page.evaluate(() => document.getElementById('panel')!.scrollHeight);
  expect(end.rect.y).toBeGreaterThan(scrollHeight - 200);
  expect(end.rect.y + end.rect.height).toBeLessThanOrEqual(scrollHeight);
  // Text outside the panel (top bar, sidebar) is not in the hints.
  expect(hints.textRuns.some((t) => /APP TOP BAR|SIDEBAR/.test(t.text))).toBe(false);
});

test('fixed header text is reported once, where frame 1 shows it', async ({
  context,
  serviceWorker,
}) => {
  const { hints } = await capture(context, serviceWorker, 'sticky-header.html');
  const bars = hints.textRuns.filter((t) => t.text.includes('FIXED TOP BAR'));
  expect(bars).toHaveLength(1);
  expect(bars[0]!.rect.y).toBeLessThan(48);
  expect(hints.textRuns.some((t) => t.text.includes('COOKIE BAR'))).toBe(false);
  expect(hints.textRuns.filter((t) => t.text.includes('STICKY SUBHEADER'))).toHaveLength(1);
});

test('virtual list: recycled rows are all reported once, at their own positions', async ({
  context,
  serviceWorker,
}) => {
  test.setTimeout(180_000);
  const { result, hints } = await capture(context, serviceWorker, 'virtual-list.html');
  expect(result.done.status).toBe('complete');
  const rows = new Map<number, number[]>();
  for (const t of hints.textRuns) {
    const m = /^Row (\d+) of/.exec(t.text);
    if (m) rows.set(Number(m[1]), [...(rows.get(Number(m[1])) ?? []), t.rect.y]);
  }
  expect(rows.size).toBe(1000);
  for (const [i, ys] of rows) {
    expect(ys).toHaveLength(1);
    // 60 px heading, 30 px rows, text box centred in the row (line-height 30).
    expect(Math.abs(ys[0]! - (60 + i * 30))).toBeLessThan(8);
  }
});

test('huge page: completes within the caps and hints stay inside the time budget', async ({
  context,
  serviceWorker,
}) => {
  test.setTimeout(600_000);
  const { page, result, hints } = await capture(context, serviceWorker, 'huge.html');
  const height = await page.evaluate(() => document.scrollingElement!.scrollHeight);
  expect(height).toBeGreaterThan(140_000);
  expect(result.done.status).toBe('complete');
  expect(result.done.warnings).toEqual([]);
  // A few more frames than screens: each leaves out the rows under the pill.
  expect(result.frames.length).toBeGreaterThanOrEqual(Math.ceil(height / 800));
  expect(result.frames.length).toBeLessThanOrEqual(Math.ceil(height / 720) + 1);
  expect(hints.textRuns.some((t) => t.text.includes('END OF HUGE PAGE'))).toBe(true);
  const ms = result.frames.map((f) => f.hintsMs).sort((a, b) => a - b);
  console.log(
    `hints ms: median ${ms[Math.floor(ms.length / 2)]!.toFixed(1)}, max ${ms.at(-1)!.toFixed(1)}`,
  );
  expect(ms.at(-1)!).toBeLessThan(50);
});

test('scroll-locked page: capture unlocks it, reaches the end, and locks it again', async ({
  context,
  serviceWorker,
}) => {
  const { page, result, hints } = await capture(context, serviceWorker, 'scroll-lock.html');
  expect(result.done.status).toBe('complete');
  expect(result.done.warnings).toEqual([]);
  expect(hints.textRuns.some((t) => t.text.includes('END OF LOCKED PAGE'))).toBe(true);
  expect(result.frames.length).toBeGreaterThanOrEqual(5);
  const overflow = await page.evaluate(() => [
    getComputedStyle(document.documentElement).overflowY,
    getComputedStyle(document.body).overflowY,
  ]);
  expect(overflow).toEqual(['hidden', 'hidden']);
});
