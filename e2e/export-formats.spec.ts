import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { expect, test, FIXTURES } from './fixtures';

/** Exports through the Studio's Export tab and checks what actually arrives on disk. */
test('export formats: PNG pages zip, one long PDF page, long PNG', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  const url = `${FIXTURES}/article.html`;
  await page.goto(url);
  await page.bringToFront();
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    await (
      globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } }
    ).__spTest.capture(tab!.id!);
  }, url);
  const studio = await studioPromise;
  await expect(studio.getByRole('button', { name: 'Save PDF' })).toBeVisible({ timeout: 60_000 });
  const pages = await studio.evaluate(
    () => (window as unknown as { __spStudio: { slices(): unknown[] } }).__spStudio.slices().length,
  );
  await studio.getByRole('tab', { name: 'Export' }).click();
  const format = studio.getByRole('combobox', { name: 'Format' });

  async function save(): Promise<Buffer> {
    const dl = studio.waitForEvent('download', { timeout: 60_000 });
    await studio.getByRole('button', { name: 'Save', exact: true }).click();
    return readFileSync(await (await dl).path());
  }

  await format.selectOption('png');
  const zip = unzipSync(new Uint8Array(await save()));
  const names = Object.keys(zip).sort();
  expect(names).toHaveLength(pages);
  expect(names[0]).toMatch(/^Article fixture_.*-1\.png$/);
  for (const n of names) expect(Buffer.from(zip[n]!.subarray(1, 4)).toString()).toBe('PNG');

  await format.selectOption('pdf-long');
  const long = await PDFDocument.load(new Uint8Array(await save()));
  expect(long.getPageCount()).toBe(1);
  expect(long.getPage(0).getHeight()).toBeGreaterThan(842 * 2);

  await format.selectOption('long-png');
  const png = await save();
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  // Height from the IHDR chunk: the whole capture, in one part for this page.
  const height = png.readUInt32BE(20);
  const docHeight = await page.evaluate(() => document.scrollingElement!.scrollHeight);
  expect(height).toBe(docHeight);
});
