import type { BrowserContext, Page, Worker } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { expect, test, FIXTURES } from './fixtures';

/** Edge cases across the extension: odd pages, odd input, odd use of the UI. */

type Hook = {
  start(tabId: number, mode: string, opts?: object): Promise<string>;
  wait(id: string): Promise<{ done: { status: string; warnings: string[] }; frames: unknown[] }>;
  capture(tabId: number): Promise<unknown>;
};

async function openPage(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${FIXTURES}/${path}`);
  await page.bringToFront();
  return page;
}

const studioOpens = (context: BrowserContext) =>
  context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
    timeout: 60_000,
  });

async function ready(studio: Page) {
  await studio.waitForFunction(
    () => 'project' in ((window as unknown as { __spStudio?: object }).__spStudio ?? {}),
    null,
    { timeout: 60_000 },
  );
}

async function capture(context: BrowserContext, sw: Worker, path: string): Promise<Page> {
  await openPage(context, path);
  const studioPromise = studioOpens(context);
  await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await (globalThis as unknown as { __spTest: Hook }).__spTest.capture(tab!.id!);
  }, `${FIXTURES}/${path}`);
  const studio = await studioPromise;
  await studio.setViewportSize({ width: 1280, height: 800 });
  await ready(studio);
  return studio;
}

const lastDownload = (sw: Worker) =>
  sw.evaluate(
    async () => (await chrome.storage.session.get('lastDownload')).lastDownload as string,
  );

const slices = (studio: Page) =>
  studio.evaluate(
    () => (window as unknown as { __spStudio: { slices(): unknown[] } }).__spStudio.slices().length,
  );

test('a page shorter than one sheet: one page, saved as a one-page PDF', async ({
  context,
  serviceWorker,
}) => {
  const studio = await capture(context, serviceWorker, 'tiny.html');
  expect(await slices(studio)).toBe(1);
  await expect(studio.getByText(/· 1 page$/)).toBeVisible();
  await expect(studio.getByTestId('estimate')).toHaveText(/^1 page · /);
  const dl = studio.waitForEvent('download');
  await studio.getByRole('button', { name: 'Save PDF' }).click();
  const pdf = await PDFDocument.load(readFileSync(await (await dl).path()));
  expect(pdf.getPageCount()).toBe(1);
});

test('a title full of forbidden characters becomes a safe file name', async ({
  context,
  serviceWorker,
}) => {
  const studio = await capture(context, serviceWorker, 'hostile-title.html');
  const dl = studio.waitForEvent('download');
  await studio.getByRole('button', { name: 'Save PDF' }).click();
  await dl;
  const name = await lastDownload(serviceWorker);
  expect(name).toMatch(/\.pdf$/);
  expect(name).not.toMatch(/[\\/:*?"<>|]/);
  expect(name.startsWith('.')).toBe(false);
  expect(name.startsWith(' ')).toBe(false);
  expect(name).toContain('报告');
  expect(name).toContain('🙂');
  expect(name).toContain('עברית');
});

test.describe('where the file system cannot hold the title', () => {
  test.use({ utf8: false });
  test('the file is still saved, under a plain name, and the toast says why', async ({
    context,
    serviceWorker,
  }) => {
    const studio = await capture(context, serviceWorker, 'hostile-title.html');
    const dl = studio.waitForEvent('download');
    await studio.getByRole('button', { name: 'Save PDF' }).click();
    await dl;
    const name = await lastDownload(serviceWorker);
    expect(name).toMatch(/^[\x20-\x7e]+\.pdf$/);
    await expect(studio.getByRole('status')).toContainText('did not accept the page title');
  });
});

test('an empty region is reported, not silently dropped', async ({ context, serviceWorker }) => {
  await openPage(context, 'tiny.html');
  const url = `${FIXTURES}/tiny.html`;
  const id = await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return (globalThis as unknown as { __spTest: Hook }).__spTest.start(tab!.id!, 'selection', {
      region: { x0: 10, x1: 300, y0: 40, y1: 40 },
    });
  }, url);
  const result = await serviceWorker.evaluate(
    (i) => (globalThis as unknown as { __spTest: Hook }).__spTest.wait(i),
    id,
  );
  // Either nothing was captured and the user is told why, or the Studio says it's empty.
  expect(result.done.status).not.toBe('complete');
  expect(result.done.warnings.join(' ')).toMatch(/empty|nothing/i);
});

test('a missing or deleted capture shows a clear message', async ({ context, extensionId }) => {
  const studio = await context.newPage();
  for (const q of ['?session=does-not-exist', '', '?session=']) {
    await studio.goto(`chrome-extension://${extensionId}/studio.html${q}`);
    await expect(studio.getByRole('alert')).toHaveText('This capture no longer exists.');
  }
});

test('corrupted settings in storage do not break the Studio', async ({
  context,
  serviceWorker,
}) => {
  for (const bad of [
    'garbage',
    { page: null, breakStyle: 'x', pdf: [] },
    { page: { paper: 'A99', marginsMm: { top: -1e9 } } },
  ]) {
    await serviceWorker.evaluate(async (v) => chrome.storage.local.set({ settings: v }), bad);
    const studio = await capture(context, serviceWorker, 'article.html');
    expect(await slices(studio)).toBeGreaterThan(1);
    await expect(studio.getByRole('button', { name: 'Save PDF' })).toBeEnabled();
    await studio.close();
  }
});

test('double clicks and repeated Ctrl+S save one file', async ({ context, serviceWorker }) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  let downloads = 0;
  studio.on('download', () => downloads++);
  const save = studio.getByRole('button', { name: 'Save PDF' });
  await save.dblclick();
  await studio.keyboard.press('Control+s');
  await expect.poll(() => downloads, { timeout: 20_000 }).toBe(1);
  // Still one after the job has had time to finish.
  await studio.waitForTimeout(3000);
  expect(downloads).toBe(1);
  // Once idle, saving works again.
  await save.click();
  await expect.poll(() => downloads, { timeout: 20_000 }).toBe(2);
});

test('fast typing in settings fields keeps every character', async ({ context, serviceWorker }) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  await studio.getByRole('button', { name: 'More options' }).click();
  const name = studio.getByRole('textbox', { name: 'File name' });
  await name.fill('');
  const typed = 'Quarterly report {date} final-final v2';
  await name.pressSequentially(typed, { delay: 0 });
  await expect(name).toHaveValue(typed);
  const header = studio.getByRole('textbox', { name: 'Header left' });
  await header.pressSequentially('{title} · draft', { delay: 0 });
  await expect(header).toHaveValue('{title} · draft');
  // Storage ends with the last value, not an earlier one that finished late.
  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => {
        const s = (await chrome.storage.local.get('settings')).settings as {
          filenameTemplate: string;
          pdf: { header: { left: string } };
        };
        return [s.filenameTemplate, s.pdf.header.left];
      }),
    )
    .toEqual([typed, '{title} · draft']);
  await expect(
    studio.getByText(/^Quarterly report \d{4}-\d{2}-\d{2} final-final v2\.pdf$/),
  ).toBeVisible();
});

test('keyboard only: modes and the Save menu', async ({ context, serviceWorker }) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  await studio.getByRole('tab', { name: 'Breaks' }).focus();
  await studio.keyboard.press('Enter');
  await expect(studio.getByRole('tab', { name: 'Breaks' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const more = studio.getByRole('button', { name: 'More ways to save' });
  await more.focus();
  await studio.keyboard.press('Enter');
  const items = studio.getByRole('menuitem');
  await expect(items.first()).toBeFocused();
  await studio.keyboard.press('ArrowUp'); // wraps to the last item
  await expect(items.last()).toBeFocused();
  await expect(items.last()).toHaveText(/Print/);
  await studio.keyboard.press('Escape');
  await expect(studio.getByRole('menu')).toBeHidden();
  await expect(more).toBeFocused();
  // Clicking elsewhere also closes it.
  await more.click();
  await studio.mouse.click(10, 400);
  await expect(studio.getByRole('menu')).toBeHidden();
});

test('narrow window and dark mode', async ({ context, serviceWorker }) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  for (const [w, h] of [
    [1024, 700],
    [800, 600],
  ] as const) {
    await studio.setViewportSize({ width: w, height: h });
    for (const mode of ['Pages', 'Breaks', 'Mark up']) {
      await studio.getByRole('tab', { name: mode }).click();
      const overflow = await studio.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${w}px, ${mode}`).toBeLessThanOrEqual(0);
      await expect(studio.getByRole('button', { name: 'Save PDF' })).toBeInViewport();
    }
  }
  await studio.screenshot({ path: 'e2e-artifacts/edge-narrow-markup.png' });

  await studio.setViewportSize({ width: 1280, height: 800 });
  await studio.emulateMedia({ colorScheme: 'dark' });
  await studio.getByRole('tab', { name: 'Pages' }).click();
  const bg = await studio.evaluate(
    () => getComputedStyle(document.querySelector('header')!).backgroundColor,
  );
  expect(bg).not.toBe('rgb(255, 255, 255)');
  await studio.screenshot({ path: 'e2e-artifacts/edge-dark-pages.png' });
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await studio.screenshot({ path: 'e2e-artifacts/edge-dark-markup.png' });
});

test('mark up: no-ops, tiny drags and leaving mid-edit', async ({ context, serviceWorker }) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  const anns = () =>
    studio.evaluate(() =>
      (
        window as unknown as {
          __spStudio: {
            project(): { annotations: Array<{ kind: string; text?: string }>; crop: unknown };
          };
        }
      ).__spStudio.project(),
    );
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  const body = (await studio.getByTestId('annotate-body').boundingBox())!;
  const at = (dx: number, dy: number) => ({ x: body.x + dx, y: body.y + dy });

  // Undo, redo and delete with nothing to act on.
  await studio.keyboard.press('Control+z');
  await studio.keyboard.press('Control+y');
  await studio.keyboard.press('Delete');
  expect((await anns()).annotations).toEqual([]);
  await expect(studio.getByRole('button', { name: 'Undo' })).toBeDisabled();

  // A 2 px drag is a click, not a shape; a 10 px crop is too small to mean anything.
  await studio.keyboard.press('r');
  let p = at(300, 200);
  await studio.mouse.move(p.x, p.y);
  await studio.mouse.down();
  await studio.mouse.move(p.x + 2, p.y + 1);
  await studio.mouse.up();
  await studio.keyboard.press('c');
  await studio.mouse.move(p.x, p.y);
  await studio.mouse.down();
  await studio.mouse.move(p.x + 10, p.y + 10);
  await studio.mouse.up();
  expect(await anns()).toEqual({ annotations: [], crop: null });

  // Text: only spaces, or Esc, leaves nothing.
  await studio.keyboard.press('t');
  p = at(400, 300);
  await studio.mouse.click(p.x, p.y);
  await studio.keyboard.type('   ');
  await studio.keyboard.press('Enter');
  await studio.mouse.click(p.x, p.y + 60);
  await studio.keyboard.type('gone');
  await studio.keyboard.press('Escape');
  expect((await anns()).annotations).toEqual([]);

  // Typing, then switching mode without pressing Enter, keeps the text.
  await studio.mouse.click(p.x, p.y + 120);
  await studio.keyboard.type('kept');
  await studio.getByRole('tab', { name: 'Pages' }).click();
  expect((await anns()).annotations).toMatchObject([{ kind: 'text', text: 'kept' }]);

  // Clear all, then undo brings it back.
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await studio.getByRole('button', { name: /Clear all/ }).click();
  expect((await anns()).annotations).toEqual([]);
  await studio.keyboard.press('Control+z');
  expect((await anns()).annotations).toHaveLength(1);

  // Tool keys typed into the text box don't switch tools.
  await studio.keyboard.press('t');
  await studio.mouse.click(p.x, p.y + 200);
  await studio.keyboard.type('rabbit');
  await studio.keyboard.press('Enter');
  await expect(studio.getByRole('button', { name: 'Text' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect((await anns()).annotations.map((a) => a.text)).toEqual(['kept', 'rabbit']);
});

test('break edits survive switching modes', async ({ context, serviceWorker }) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  const ys = () =>
    studio.evaluate(() =>
      (window as unknown as { __spStudio: { slices(): Array<{ y1: number }> } }).__spStudio
        .slices()
        .map((s) => Math.round(s.y1)),
    );
  await studio.getByRole('tab', { name: 'Breaks' }).click();
  const before = await ys();
  await studio.getByTestId('break').first().hover();
  await studio.getByRole('button', { name: 'Remove break 1' }).click();
  // Removing a break re-flows the pages (the count may stay the same).
  await expect.poll(ys).not.toEqual(before);
  const edited = await ys();
  expect(edited).not.toContain(before[0]);
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await studio.getByRole('tab', { name: 'Pages' }).click();
  await studio.getByRole('tab', { name: 'Breaks' }).click();
  expect(await ys()).toEqual(edited);
  await expect(studio.getByRole('button', { name: 'Reset breaks' })).toBeEnabled();
  await studio.getByRole('button', { name: 'Reset breaks' }).click();
  expect(await ys()).toEqual(before);
});

test('popup: a page that cannot be captured says so before any click', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const popup = await context.newPage();
  // Opened as a tab, the popup's own extension page is the active tab: not capturable.
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('alert')).toBeVisible();
  await expect(popup.getByRole('button', { name: /Capture full page/ })).toBeDisabled();
  await expect(popup.getByRole('button', { name: 'Area' })).toBeDisabled();

  // The one setting in the popup persists.
  await popup.getByRole('checkbox', { name: /Skip the preview/ }).check();
  await popup.reload();
  await expect(popup.getByRole('checkbox', { name: /Skip the preview/ })).toBeChecked();
  await expect(popup.getByText('Saves a PDF right away')).toBeVisible();
  expect(
    await serviceWorker.evaluate(
      async () =>
        ((await chrome.storage.local.get('settings')).settings as { afterCapture: string })
          .afterCapture,
    ),
  ).toBe('pdf');
  await popup.getByRole('radio', { name: '5 seconds' }).click();
  await expect(popup.getByRole('radio', { name: '5 seconds' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await popup.screenshot({ path: 'e2e-artifacts/popup-blocked.png' });
});
