import { createCanvas } from '@napi-rs/canvas';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { PageSlice } from '../packages/core/src/paginate';
import { expect, test, FIXTURES } from './fixtures';

const STANDARD_FONTS = new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
  .pathname;

interface StudioHook {
  slices(): PageSlice[];
  pdfBase64(): Promise<string>;
}

async function capturePdf(context: BrowserContext, sw: Worker, path: string, header?: object) {
  if (header) {
    await sw.evaluate(async (h) => {
      const { settings } = (await chrome.storage.local.get('settings')) as {
        settings?: { pdf?: object };
      };
      await chrome.storage.local.set({
        settings: { ...settings, pdf: { ...settings?.pdf, header: h } },
      });
    }, header);
  }
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
  await studio.waitForFunction(
    () => 'slices' in ((window as unknown as { __spStudio?: object }).__spStudio ?? {}),
    null,
    {
      timeout: 60_000,
    },
  );
  const slices = await studio.evaluate(() =>
    (window as unknown as { __spStudio: StudioHook }).__spStudio.slices(),
  );
  const b64 = await studio.evaluate(() =>
    (window as unknown as { __spStudio: StudioHook }).__spStudio.pdfBase64(),
  );
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  mkdirSync('e2e-artifacts', { recursive: true });
  const file = `e2e-artifacts/${path.replace('.html', '')}.pdf`;
  writeFileSync(file, bytes);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: STANDARD_FONTS })
    .promise;
  return { page, slices, pdf, file };
}

async function pageTexts(pdf: Awaited<ReturnType<typeof capturePdf>>['pdf']) {
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    out.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(''));
  }
  return out;
}

async function linkTargets(pdf: Awaited<ReturnType<typeof capturePdf>>['pdf']) {
  const uris: string[] = [];
  const jumps: number[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    for (const a of await (await pdf.getPage(i)).getAnnotations()) {
      if (a.subtype !== 'Link') continue;
      if (a.url) uris.push(a.url);
      else if (a.dest) jumps.push(await pdf.getPageIndex((a.dest as unknown[])[0] as never));
    }
  }
  return { uris, jumps };
}

function pageOf(slices: PageSlice[], y: number) {
  return slices.findIndex((s) => y >= s.y0 + s.overlapTop && y < s.y1);
}

async function targetY(page: Page, id: string) {
  return page.evaluate(
    (i) => document.getElementById(i)!.getBoundingClientRect().top + scrollY,
    id,
  );
}

test('CJK page: Chinese, Japanese and English are searchable; links, jumps, bookmarks, header', async ({
  context,
  serviceWorker,
}) => {
  const { page, slices, pdf, file } = await capturePdf(context, serviceWorker, 'cjk.html', {
    left: '{title}',
    center: '',
    right: '{page}/{pages}',
  });
  expect(slices.length).toBeGreaterThanOrEqual(3);

  // Text layer (PDF_OUTPUT §2 acceptance): phrases found, each on exactly one page.
  const texts = await pageTexts(pdf);
  for (const phrase of [
    '汉字分页测试',
    '日本語のテキスト',
    'Searchable English sentence',
    '结束 End of document',
  ]) {
    expect(
      texts.filter((t) => t.includes(phrase)),
      phrase,
    ).toHaveLength(1);
  }
  // Independent reader: poppler finds the same text.
  const poppler = execFileSync('pdftotext', [file, '-']).toString();
  expect(poppler).toContain('汉字分页测试');
  expect(poppler).toContain('日本語のテキスト');

  // Header (Chinese title, drawn as an image + searchable twin) on every page.
  for (const t of texts) expect(t).toContain('中文分页测试 · CJK fixture');

  // Links: the external one, and in-document jumps to the pages showing their targets.
  const { uris, jumps } = await linkTargets(pdf);
  expect(uris).toContain('https://example.org/zh');
  const expected = [];
  for (const id of ['s2', 's3', 's3-1']) expected.push(pageOf(slices, await targetY(page, id)));
  expect(jumps).toEqual(expected);

  // Bookmarks: h1–h3, nested.
  const outline = await pdf.getOutline();
  expect(outline.map((o) => o.title)).toEqual(['中文分页测试']);
  expect(outline[0]!.items.map((o) => o.title)).toEqual([
    '第二节 Section two',
    '第三节 Section three',
  ]);
  expect(outline[0]!.items[1]!.items.map((o) => o.title)).toEqual(['小节 3.1']);

  // Look at the first page (header, text) for review.
  const p1 = await pdf.getPage(1);
  const vp = p1.getViewport({ scale: 1.5 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await p1.render({ canvas: canvas as never, viewport: vp }).promise;
  writeFileSync('e2e-artifacts/cjk-pdf-p1.png', canvas.toBuffer('image/png'));
});

test('article: text, external and in-page links survive into the PDF', async ({
  context,
  serviceWorker,
}) => {
  const { page, slices, pdf } = await capturePdf(context, serviceWorker, 'article.html');
  const all = (await pageTexts(pdf)).join('\n');
  for (const s of ['Article fixture', 'Section 1', 'Section 8', 'Figure 1. A diagram.'])
    expect(all).toContain(s);
  const { uris, jumps } = await linkTargets(pdf);
  expect(uris).toContain('https://example.org/ref');
  expect(jumps).toEqual([pageOf(slices, await targetY(page, 's4'))]);
  // One h1 with the eight h2 sections nested under it.
  const outline = await pdf.getOutline();
  expect(outline.map((o) => o.title)).toEqual(['Article fixture']);
  expect(outline[0]!.items).toHaveLength(8);
});
