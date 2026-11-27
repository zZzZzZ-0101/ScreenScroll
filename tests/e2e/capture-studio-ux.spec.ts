import { chromium, test as baseTest, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { Annotation } from '../../packages/core/src/annotations';
import type { PageSlice } from '../../packages/core/src/paginate';
import type { Region } from '../../packages/core/src/region';
import { expect, test, FIXTURES } from './fixtures';

const PROD_EXTENSION_PATH = fileURLToPath(new URL('../../extension', import.meta.url));

interface StudioProject {
  annotations: Annotation[];
  crop: Region | null;
  excludedPages?: number[];
  pageOrder?: number[];
}

interface StudioHook {
  slices(): PageSlice[];
  project(): StudioProject;
  size(): { width: number; height: number };
}

interface CaptureResult {
  id: string;
  done: { status: string; warnings: string[]; title?: string };
  frames: unknown[];
}

type TestHook = {
  capture(tabId: number, mode?: string): Promise<CaptureResult>;
};

const studioHook = <T>(studio: Page, fn: (h: StudioHook) => T | Promise<T>) =>
  studio.evaluate(`(${fn.toString()})(window.__spStudio)`) as Promise<T>;

const studioReady = (studio: Page) =>
  studio.waitForFunction(
    () => 'project' in ((window as unknown as { __spStudio?: object }).__spStudio ?? {}),
    null,
    { timeout: 60_000 },
  );

/** Screen coordinates for a document point inside AnnotateView, scrolling it into view first. */
async function annotateScreen(studio: Page, docWidth: number, x: number, y: number) {
  await studio.getByTestId('annotate-view').evaluate(
    (el, pt) => {
      const body = el.querySelector('[data-testid="annotate-body"]') as HTMLElement;
      const z = body.getBoundingClientRect().width / pt.docWidth;
      const top = pt.y * z;
      if (top < el.scrollTop + 40 || top > el.scrollTop + el.clientHeight - 140) {
        el.scrollTop = Math.max(0, top - 160);
      }
    },
    { y, docWidth },
  );
  const box = (await studio.getByTestId('annotate-body').boundingBox())!;
  const z = box.width / docWidth;
  return { x: box.x + x * z, y: box.y + y * z, z };
}

async function annotateDrag(
  studio: Page,
  docWidth: number,
  from: [number, number],
  to: [number, number],
) {
  const a = await annotateScreen(studio, docWidth, ...from);
  await studio.mouse.move(a.x, a.y);
  await studio.mouse.down();
  const b = await annotateScreen(studio, docWidth, ...to);
  await studio.mouse.move(b.x, b.y, { steps: 8 });
  await studio.mouse.up();
}

async function annotateClick(studio: Page, docWidth: number, x: number, y: number) {
  const p = await annotateScreen(studio, docWidth, x, y);
  await studio.mouse.click(p.x, p.y);
}

async function dragElementBy(studio: Page, testId: string, dx: number, dy: number) {
  const el = studio.getByTestId(testId);
  await expect(el).toBeVisible();
  const box = (await el.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await studio.mouse.move(cx, cy);
  await studio.mouse.down();
  await studio.mouse.move(cx + dx, cy + dy, { steps: 8 });
  await studio.mouse.up();
}

async function captureArticleToStudio(
  context: Parameters<Parameters<typeof test>[1]>[0]['context'],
  serviceWorker: Parameters<Parameters<typeof test>[1]>[0]['serviceWorker'],
): Promise<{ page: Page; studio: Page }> {
  const page = await context.newPage();
  await page.goto(`${FIXTURES}/article.html`);
  await page.bringToFront();
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
    timeout: 60_000,
  });
  await serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, url });
    await (globalThis as unknown as { __spTest: TestHook }).__spTest.capture(tab!.id!);
  }, `${FIXTURES}/article.html`);
  const studio = await studioPromise;
  await studio.setViewportSize({ width: 1400, height: 900 });
  await studioReady(studio);
  return { page, studio };
}

baseTest(
  'F0 (production build): debugger permission granted and Scrolling/Sharpness work in Popup and Options',
  async () => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADED,
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${PROD_EXTENSION_PATH}`,
        `--load-extension=${PROD_EXTENSION_PATH}`,
      ],
    });
    try {
      const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const extensionId = new URL(sw.url()).host;

      const hasDebugger = await sw.evaluate(() =>
        chrome.permissions.contains({ permissions: ['debugger'] }),
      );
      expect(hasDebugger).toBe(true);

      const pageErrors: string[] = [];

      // 1. Popup controls: Scrolling (In background / On screen) & Sharpness (2× / 3× / 1×).
      const popup = await context.newPage();
      popup.on('pageerror', (err) => pageErrors.push(`popup: ${err.message}`));
      await popup.setViewportSize({ width: 360, height: 720 });
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);

      const popupRadio = (group: string, name: string) =>
        popup.getByRole('radiogroup', { name: group }).getByRole('radio', { name });

      await expect(popupRadio('Scrolling', 'On screen')).toBeChecked();
      await expect(popupRadio('Sharpness', '1×')).toBeChecked();

      await popupRadio('Scrolling', 'In background').click();
      await expect(popupRadio('Scrolling', 'In background')).toBeChecked();
      await popupRadio('Sharpness', '2×').click();
      await expect(popupRadio('Sharpness', '2×')).toBeChecked();
      await expect(
        popup.getByRole('alert').filter({ hasText: /permission|failed/i }),
      ).toHaveCount(0);

      await expect
        .poll(() =>
          sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.capture),
        )
        .toMatchObject({ quiet: true, resolution: 'high' });

      await popupRadio('Sharpness', '3×').click();
      await expect(popupRadio('Sharpness', '3×')).toBeChecked();
      await expect
        .poll(() =>
          sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.capture),
        )
        .toMatchObject({ quiet: true, resolution: 'max' });

      // Switch back to On screen and 1×.
      await popupRadio('Scrolling', 'On screen').click();
      await expect(popupRadio('Scrolling', 'On screen')).toBeChecked();
      await popupRadio('Sharpness', '1×').click();
      await expect(popupRadio('Sharpness', '1×')).toBeChecked();
      await expect(
        popup.getByRole('alert').filter({ hasText: /permission|failed/i }),
      ).toHaveCount(0);
      await expect
        .poll(() =>
          sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.capture),
        )
        .toMatchObject({ quiet: false, resolution: 'standard' });
      await popup.close();

      // 2. Options page controls: Scrolling, Sharpness, and unrelated capture settings.
      const options = await context.newPage();
      options.on('pageerror', (err) => pageErrors.push(`options: ${err.message}`));
      await options.goto(`chrome-extension://${extensionId}/options.html`);

      const quietRow = options.getByTestId('set-capture.quiet');
      const sharpRow = options.getByTestId('set-capture.resolution');
      const speedRow = options.getByTestId('set-capture.speed');

      await expect(quietRow.getByRole('radio', { name: /^On screen/ })).toBeChecked();
      await expect(sharpRow.getByRole('radio', { name: /^Standard/ })).toBeChecked();

      await quietRow.getByRole('radio', { name: /^In background/ }).click();
      await expect(quietRow.getByRole('radio', { name: /^In background/ })).toBeChecked();
      await sharpRow.getByRole('radio', { name: /^High \(2×\)/ }).click();
      await expect(sharpRow.getByRole('radio', { name: /^High \(2×\)/ })).toBeChecked();
      await speedRow.getByRole('radio', { name: /^Fast/ }).click();
      await expect(speedRow.getByRole('radio', { name: /^Fast/ })).toBeChecked();
      await expect(options.getByRole('alert')).toHaveCount(0);

      await expect
        .poll(() =>
          sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.capture),
        )
        .toMatchObject({ quiet: true, resolution: 'high', speed: 'fast' });

      await sharpRow.getByRole('radio', { name: /^Maximum \(3×\)/ }).click();
      await expect(sharpRow.getByRole('radio', { name: /^Maximum \(3×\)/ })).toBeChecked();

      // Reload options and verify persistence.
      await options.reload();
      await expect(quietRow.getByRole('radio', { name: /^In background/ })).toBeChecked();
      await expect(sharpRow.getByRole('radio', { name: /^Maximum \(3×\)/ })).toBeChecked();

      // Back to On screen / Standard cleanly.
      await quietRow.getByRole('radio', { name: /^On screen/ }).click();
      await sharpRow.getByRole('radio', { name: /^Standard/ }).click();
      await expect(quietRow.getByRole('radio', { name: /^On screen/ })).toBeChecked();
      await expect(sharpRow.getByRole('radio', { name: /^Standard/ })).toBeChecked();
      await expect(options.getByRole('alert')).toHaveCount(0);
      await expect
        .poll(() =>
          sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.capture),
        )
        .toMatchObject({ quiet: false, resolution: 'standard' });

      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  },
);

test('M1: Clean (Reader) capture extracts article cleanly, restores DOM, and warns on non-article pages', async ({
  context,
  serviceWorker,
}) => {
  // 1. Clean (Reader) capture on an article page.
  const article = await context.newPage();
  await article.goto(`${FIXTURES}/article.html`);
  await article.bringToFront();

  const domBefore = await article.evaluate(() => ({
    bodyHtml: document.body.innerHTML,
    htmlClass: document.documentElement.className,
    childCount: document.body.children.length,
  }));

  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
    timeout: 60_000,
  });
  const res = await serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, url });
    return (globalThis as unknown as { __spTest: TestHook }).__spTest.capture(tab!.id!, 'reader');
  }, `${FIXTURES}/article.html`);

  expect(res.done.status).toBe('complete');
  expect(res.done.title).toBe('Article fixture');
  expect(res.frames.length).toBeGreaterThan(0);

  const studio = await studioPromise;
  await studioReady(studio);
  await expect(studio.locator('header h1')).toHaveText('Article fixture');
  const readerSlices = await studioHook(studio, (h) => h.slices());
  expect(readerSlices.length).toBeGreaterThanOrEqual(1);

  // Source page DOM is completely restored untouched after reader capture.
  const domAfter = await article.evaluate(() => ({
    bodyHtml: document.body.innerHTML,
    htmlClass: document.documentElement.className,
    childCount: document.body.children.length,
    leftovers: document.querySelectorAll('[data-screenscroll]').length,
  }));
  expect(domAfter.bodyHtml).toBe(domBefore.bodyHtml);
  expect(domAfter.htmlClass).toBe(domBefore.htmlClass);
  expect(domAfter.childCount).toBe(domBefore.childCount);
  expect(domAfter.leftovers).toBe(0);
  await studio.close();
  await article.close();

  // 2. Clean (Reader) capture on a non-article page (tiny.html) shows explicit fallback warning.
  const tiny = await context.newPage();
  await tiny.goto(`${FIXTURES}/tiny.html`);
  await tiny.bringToFront();
  const tinyHtmlBefore = await tiny.evaluate(() => document.body.innerHTML);

  const pagesBefore = context.pages().length;
  const tinyRes = await serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, url });
    return (globalThis as unknown as { __spTest: TestHook }).__spTest.capture(tab!.id!, 'reader');
  }, `${FIXTURES}/tiny.html`);

  expect(tinyRes.done.status).toBe('error');
  expect(tinyRes.frames).toHaveLength(0);
  expect(tinyRes.done.warnings.join(' ')).toContain(
    'This page does not look like an article, so Clean page could not extract it. Try Capture full page instead.',
  );

  // On-page pill displays the explicit plain fallback message (never fails silently).
  const pill = tiny.locator('[data-screenscroll="pill"]');
  await expect(pill).toHaveAttribute(
    'data-message',
    'This page does not look like an article, so Clean page could not extract it. Try Capture full page instead.',
  );
  // No empty Studio tab opened, and source page DOM remains intact.
  expect(context.pages().length).toBe(pagesBefore);
  expect(await tiny.evaluate(() => document.body.innerHTML)).toBe(tinyHtmlBefore);
});

test('M2: Studio interactive box resize, arrow endpoints, crop resize, keyboard nudge, and highlighter', async ({
  context,
  serviceWorker,
}) => {
  const { studio } = await captureArticleToStudio(context, serviceWorker);
  const { width: docWidth } = await studioHook(studio, (h) => h.size());

  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await expect(studio.getByTestId('annotate-view')).toBeVisible();

  const anns = () => studioHook(studio, (h) => h.project().annotations);

  // 1. Draw rect, select it, drag handle-se, verify geometry changes and Ctrl+Z undoes in 1 step.
  await studio.keyboard.press('r');
  await annotateDrag(studio, docWidth, [200, 140], [360, 240]);
  await studio.keyboard.press('v');
  await annotateClick(studio, docWidth, 280, 140);
  await expect(studio.getByTestId('handle-se')).toBeVisible();

  const rectBefore = (await anns())[0] as Extract<Annotation, { kind: 'rect' }>;
  expect(rectBefore.kind).toBe('rect');
  await dragElementBy(studio, 'handle-se', 60, 40);

  const rectAfter = (await anns())[0] as Extract<Annotation, { kind: 'rect' }>;
  expect(rectAfter.w).toBeGreaterThan(rectBefore.w + 20);
  expect(rectAfter.h).toBeGreaterThan(rectBefore.h + 15);

  await studio.keyboard.press('Control+z');
  const rectUndone = (await anns())[0] as Extract<Annotation, { kind: 'rect' }>;
  expect(rectUndone.w).toBeCloseTo(rectBefore.w, 1);
  expect(rectUndone.h).toBeCloseTo(rectBefore.h, 1);

  // 2. Draw arrow, select it, drag endpoint-end, verify endpoint moves while start stays fixed.
  await studio.keyboard.press('a');
  await annotateDrag(studio, docWidth, [200, 320], [380, 360]);
  await studio.keyboard.press('v');
  await annotateClick(studio, docWidth, 290, 340);
  await expect(studio.getByTestId('endpoint-end')).toBeVisible();

  const arrowBefore = (await anns()).find((a) => a.kind === 'arrow') as Extract<
    Annotation,
    { kind: 'arrow' }
  >;
  await dragElementBy(studio, 'endpoint-end', 50, 40);

  const arrowAfter = (await anns()).find((a) => a.kind === 'arrow') as Extract<
    Annotation,
    { kind: 'arrow' }
  >;
  expect(arrowAfter.x2).toBeGreaterThan(arrowBefore.x2 + 20);
  expect(arrowAfter.y2).toBeGreaterThan(arrowBefore.y2 + 15);
  expect(arrowAfter.x1).toBeCloseTo(arrowBefore.x1, 1);
  expect(arrowAfter.y1).toBeCloseTo(arrowBefore.y1, 1);

  // 3. Draw crop box, drag crop-handle-se, verify project().crop updates.
  await studio.keyboard.press('c');
  await annotateDrag(studio, docWidth, [120, 120], [560, 460]);
  await expect(studio.getByTestId('crop-handle-se')).toBeVisible();

  const cropBefore = await studioHook(studio, (h) => h.project().crop);
  expect(cropBefore).not.toBeNull();
  await dragElementBy(studio, 'crop-handle-se', 40, 50);

  const cropAfter = await studioHook(studio, (h) => h.project().crop);
  expect(cropAfter!.x1).toBeGreaterThan(cropBefore!.x1 + 15);
  expect(cropAfter!.y1).toBeGreaterThan(cropBefore!.y1 + 20);
  await studio.getByRole('button', { name: 'Reset crop' }).click();
  expect(await studioHook(studio, (h) => h.project().crop)).toBeNull();

  // 4. Select rect, nudge with ArrowRight (+1) and Shift+ArrowDown (+10), verify undo.
  await studio.keyboard.press('v');
  await annotateClick(studio, docWidth, rectUndone.x + rectUndone.w / 2, rectUndone.y);
  await expect(studio.getByTestId('selection')).toBeVisible();

  const nudgeStart = (await anns())[0] as Extract<Annotation, { kind: 'rect' }>;
  await studio.keyboard.press('ArrowRight');
  const afterRight = (await anns())[0] as Extract<Annotation, { kind: 'rect' }>;
  expect(afterRight.x).toBeCloseTo(nudgeStart.x + 1, 2);
  expect(afterRight.y).toBeCloseTo(nudgeStart.y, 2);

  await studio.keyboard.press('Shift+ArrowDown');
  const afterDown = (await anns())[0] as Extract<Annotation, { kind: 'rect' }>;
  expect(afterDown.x).toBeCloseTo(nudgeStart.x + 1, 2);
  expect(afterDown.y).toBeCloseTo(nudgeStart.y + 10, 2);

  await studio.keyboard.press('Control+z');
  await studio.keyboard.press('Control+z');
  const afterNudgeUndo = (await anns())[0] as Extract<Annotation, { kind: 'rect' }>;
  expect(afterNudgeUndo.x).toBeCloseTo(nudgeStart.x, 2);
  expect(afterNudgeUndo.y).toBeCloseTo(nudgeStart.y, 2);

  // 5. Activate Highlighter (H), draw stroke, verify annotation created.
  await studio.keyboard.press('h');
  await expect(studio.getByRole('button', { name: 'Highlighter', pressed: true })).toBeVisible();
  await annotateDrag(studio, docWidth, [220, 420], [420, 425]);

  const highlighters = (await anns()).filter((a) => a.kind === 'highlighter') as Array<
    Extract<Annotation, { kind: 'highlighter' }>
  >;
  expect(highlighters).toHaveLength(1);
  expect(highlighters[0]!.points.length).toBeGreaterThanOrEqual(4);
});

test('M3: Reversible Studio page management (exclude, reorder, reload persistence, Include all / Reset order)', async ({
  context,
  serviceWorker,
}) => {
  const { studio } = await captureArticleToStudio(context, serviceWorker);

  const initialSlices = await studioHook(studio, (h) => h.slices());
  const total = initialSlices.length;
  expect(total).toBeGreaterThanOrEqual(3);

  // Exclude page 2 (0-based index 1).
  const thumb1 = studio.getByTestId('thumb-item-1');
  await thumb1.hover();
  await thumb1.getByRole('button', { name: 'Exclude page' }).click();

  await expect(studio.locator('header')).toContainText(`${total - 1} of ${total} pages`);
  expect(await studioHook(studio, (h) => h.slices().length)).toBe(total - 1);
  await expect(thumb1).toHaveAttribute('data-excluded', 'true');
  const toolsBar = studio.getByTestId('page-tools-bar');
  await expect(toolsBar).toBeVisible();
  await expect(toolsBar).toContainText('1 excluded');

  // Reorder: move original page 3 (thumb-item-2) up twice so it becomes the first active page.
  const thumb2 = studio.getByTestId('thumb-item-2');
  await thumb2.hover();
  await thumb2.getByRole('button', { name: 'Move page up' }).click();
  await thumb2.hover();
  await thumb2.getByRole('button', { name: 'Move page up' }).click();

  const reorderedSlices = await studioHook(studio, (h) => h.slices());
  expect(reorderedSlices).toHaveLength(total - 1);
  expect(reorderedSlices[0]!.y0).toBe(initialSlices[2]!.y0);
  await expect(toolsBar.getByRole('button', { name: 'Include all' })).toBeVisible();
  await expect(toolsBar.getByRole('button', { name: 'Reset order' })).toBeVisible();

  // Wait for debounced IndexedDB save, then reload Studio and verify persistence.
  await studio.waitForTimeout(600);
  await studio.reload();
  await studioReady(studio);

  await expect(studio.locator('header')).toContainText(`${total - 1} of ${total} pages`);
  const reloadedSlices = await studioHook(studio, (h) => h.slices());
  expect(reloadedSlices).toHaveLength(total - 1);
  expect(reloadedSlices[0]!.y0).toBe(initialSlices[2]!.y0);
  await expect(studio.getByTestId('page-tools-bar')).toBeVisible();

  // 1-click reversibility: Include all, then Reset order.
  await studio.getByTestId('page-tools-bar').getByRole('button', { name: 'Include all' }).click();
  expect(await studioHook(studio, (h) => h.slices().length)).toBe(total);
  await expect(studio.locator('header')).toContainText(`${total} pages`);
  await expect(studio.getByTestId('thumb-item-1')).toHaveAttribute('data-excluded', 'false');

  await studio.getByTestId('page-tools-bar').getByRole('button', { name: 'Reset order' }).click();
  const resetSlices = await studioHook(studio, (h) => h.slices());
  expect(resetSlices).toHaveLength(total);
  expect(resetSlices[0]!.y0).toBe(initialSlices[0]!.y0);
  await expect(studio.getByTestId('page-tools-bar')).toHaveCount(0);
});

test('M4: Find & Redact, Ctrl+F Quick Find, Header Undo/Redo, Breaks Zoom, Output Presets & Effective DPI', async ({
  context,
  serviceWorker,
}) => {
  const { studio } = await captureArticleToStudio(context, serviceWorker);

  // 1. Output presets & effective DPI readout in Pages panel.
  await studio.getByRole('button', { name: 'More options' }).click();
  const dpi = studio.getByTestId('effective-dpi');
  await expect(dpi).toBeVisible();
  await expect(dpi).toHaveText(/^\d+ dpi on paper$/);

  const presets = studio.getByTestId('output-presets');
  await expect(presets).toBeVisible();
  const qualitySelect = studio.getByRole('combobox', { name: /^PDF quality/ });
  const paperSelect = studio.getByRole('combobox', { name: 'Paper', exact: true });
  await expect(qualitySelect).toHaveValue('balanced');

  await presets.locator('[data-preset="share-small"]').click();
  await expect(qualitySelect).toHaveValue('compact');
  await expect(studio.getByTestId('preset-undo')).toBeVisible();

  await studio.getByTestId('preset-undo').click();
  await expect(qualitySelect).toHaveValue('balanced');
  await expect(studio.getByTestId('preset-undo')).toHaveCount(0);

  await presets.locator('[data-preset="archive"]').click();
  await expect(qualitySelect).toHaveValue('lossless');
  await presets.locator('[data-preset="print-a4"]').click();
  await expect(paperSelect).toHaveValue('A4');
  await expect(qualitySelect).toHaveValue('balanced');

  // 2. Ctrl+F Quick Find in Pages mode: bar + search-highlight ring + Escape closes.
  await studio.keyboard.press('Control+f');
  const quickFind = studio.getByTestId('quick-find');
  await expect(quickFind).toBeVisible();
  const searchInput = quickFind.getByRole('textbox', { name: 'Find in capture' });
  await searchInput.fill('Section 2');
  await expect(studio.getByTestId('quick-find-count')).toHaveText(/^1 of \d+$/);
  await expect(studio.getByTestId('search-highlight')).toBeVisible();

  await searchInput.press('Escape');
  await expect(quickFind).toHaveCount(0);
  await expect(studio.getByTestId('search-highlight')).toHaveCount(0);

  // 3. Global header Undo/Redo in Pages mode.
  const totalPages = await studioHook(studio, (h) => h.slices().length);
  const headerUndo = studio.getByTestId('header-undo');
  const headerRedo = studio.getByTestId('header-redo');
  await expect(headerUndo).toBeDisabled();

  const thumb1 = studio.getByTestId('thumb-item-1');
  await thumb1.hover();
  await thumb1.getByRole('button', { name: 'Exclude page' }).click();
  expect(await studioHook(studio, (h) => h.slices().length)).toBe(totalPages - 1);
  await expect(headerUndo).toBeEnabled();

  await headerUndo.click();
  expect(await studioHook(studio, (h) => h.slices().length)).toBe(totalPages);
  await expect(headerRedo).toBeEnabled();

  await headerRedo.click();
  expect(await studioHook(studio, (h) => h.slices().length)).toBe(totalPages - 1);
  await headerUndo.click();
  expect(await studioHook(studio, (h) => h.slices().length)).toBe(totalPages);

  // 4. Breaks mode: ZoomControl + global header Undo/Redo.
  await studio.getByRole('tab', { name: 'Breaks' }).click();
  await expect(studio.getByTestId('strip-view')).toBeVisible();

  const zoomGroup = studio.getByRole('group', { name: 'Zoom' });
  await expect(zoomGroup).toBeVisible();
  const stripWidthBefore = (await studio.getByTestId('strip-body').boundingBox())!.width;
  await zoomGroup.getByRole('button', { name: 'Zoom in' }).click();
  await expect
    .poll(async () => (await studio.getByTestId('strip-body').boundingBox())!.width)
    .toBeGreaterThan(stripWidthBefore + 5);
  await zoomGroup.getByRole('button', { name: 'Zoom out' }).click();

  const breaks = studio.getByTestId('break');
  const breaksBefore = await breaks.count();
  expect(breaksBefore).toBeGreaterThan(1);
  const firstBreakY = await studioHook(studio, (h) => h.slices()[0]!.y1);
  const resetBreaks = studio.getByRole('button', { name: 'Reset breaks' });
  await expect(resetBreaks).toBeDisabled();

  await breaks.first().hover();
  await studio.getByRole('button', { name: 'Remove break 1' }).click();
  await expect(resetBreaks).toBeEnabled();
  expect(await studioHook(studio, (h) => h.slices()[0]!.y1)).not.toBe(firstBreakY);
  await expect(headerUndo).toBeEnabled();

  await headerUndo.click();
  await expect(resetBreaks).toBeDisabled();
  expect(await studioHook(studio, (h) => h.slices()[0]!.y1)).toBe(firstBreakY);
  await expect(headerRedo).toBeEnabled();

  await headerRedo.click();
  await expect(resetBreaks).toBeEnabled();
  expect(await studioHook(studio, (h) => h.slices()[0]!.y1)).not.toBe(firstBreakY);

  await headerUndo.click();
  await expect(resetBreaks).toBeDisabled();

  // 5. Mark up → Find & Redact with Mosaic style + single-step Ctrl+Z batch undo.
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await expect(studio.getByTestId('redact')).toBeVisible();

  const findInput = studio.getByTestId('find-redact-input');
  await findInput.fill('Section');
  const matchCount = studio.getByTestId('find-redact-count');
  await expect(matchCount).toBeVisible();
  await expect(matchCount).toHaveText(/^\d+ matches$/);

  await studio
    .getByRole('radiogroup', { name: 'Hide style' })
    .getByRole('radio', { name: 'Mosaic' })
    .click();

  const annsBefore = await studioHook(studio, (h) => h.project().annotations.length);
  await studio.getByTestId('find-redact-apply').click();

  const annsAfter = await studioHook(studio, (h) => h.project().annotations);
  expect(annsAfter.length).toBeGreaterThan(annsBefore + 5);
  expect(annsAfter.slice(annsBefore).every((a) => a.kind === 'pixelate')).toBe(true);

  // Single Ctrl+Z undoes the entire redaction batch in one step.
  await studio.keyboard.press('Control+z');
  expect(await studioHook(studio, (h) => h.project().annotations.length)).toBe(annsBefore);
});
