import { expect, test, FIXTURES } from './fixtures';

/** Screenshots of the Studio for human review (TESTING §3), plus basic interaction checks. */
test('Studio UI: pages view, long strip with break editing, export panel', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`${FIXTURES}/article.html`);
  await page.bringToFront();
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await (
      globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } }
    ).__spTest.capture(tab!.id!);
  }, `${FIXTURES}/article.html`);
  const studio = await studioPromise;
  await studio.setViewportSize({ width: 1400, height: 900 });
  await expect(studio.getByRole('button', { name: 'Save PDF' })).toBeVisible({ timeout: 60_000 });
  await expect(studio.getByTestId('pages-view')).toBeVisible();
  await studio.screenshot({ path: 'e2e-artifacts/studio-pages.png' });

  // Long strip: breaks are drawn and can be removed; the page count reacts.
  await studio.getByRole('tab', { name: 'Long strip' }).click();
  const breaks = studio.getByTestId('break');
  const before = await breaks.count();
  expect(before).toBeGreaterThan(1);
  await breaks.first().hover();
  await expect(studio.getByRole('img', { name: 'Magnified view of the break' })).toBeVisible();
  await studio.screenshot({ path: 'e2e-artifacts/studio-strip.png' });
  await studio.getByRole('button', { name: 'Remove break 1' }).click();
  await expect(studio.getByRole('button', { name: 'Re-run smart breaks' })).toBeEnabled();

  // Re-run restores the automatic breaks.
  await studio.getByRole('button', { name: 'Re-run smart breaks' }).click();
  await expect(breaks).toHaveCount(before);

  // Double-click adds a pinned break; dragging one moves it and pins it.
  const scrollerBox = (await studio.getByTestId('strip-view').boundingBox())!;
  const bodyBox = (await studio.getByTestId('strip-body').boundingBox())!;
  await studio.mouse.dblclick(bodyBox.x + 60, Math.max(bodyBox.y, scrollerBox.y) + 90);
  await expect(breaks).toHaveCount(before + 1);
  await studio.getByRole('button', { name: 'Re-run smart breaks' }).click();
  await expect(breaks).toHaveCount(before);
  const handle = breaks.nth(1);
  const hb = (await handle.boundingBox())!;
  await studio.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await studio.mouse.down();
  await studio.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - 60, { steps: 6 });
  await studio.mouse.up();
  await expect(studio.getByText(/📌 manual/)).toBeVisible();
  await studio.getByRole('button', { name: 'Re-run smart breaks' }).click();

  // Paper controls: landscape holds less per page, so there are more pages.
  const pagesBefore = await breaks.count();
  await studio.getByRole('radio', { name: 'Landscape' }).click();
  await expect.poll(() => breaks.count()).toBeGreaterThan(pagesBefore);
  await studio.getByRole('radio', { name: 'Portrait' }).click();

  await studio.getByRole('tab', { name: 'Export' }).click();
  await expect(studio.getByText(/Article fixture_\d{4}-\d{2}-\d{2}_\d{4}\.pdf/)).toBeVisible();
  await expect(studio.getByTestId('estimate')).toHaveText(/Estimated size: ≈ \d/, {
    timeout: 20_000,
  });
  await studio.screenshot({ path: 'e2e-artifacts/studio-export.png' });

  // Debug overlay export (PAGINATION §9) asks for "<name>-breaks.png" and ".json".
  await studio.getByRole('button', { name: 'Save break overlay (debug)' }).click();
  await expect
    .poll(() =>
      serviceWorker.evaluate(
        async () => (await chrome.storage.session.get('lastDownload')).lastDownload as string,
      ),
    )
    .toMatch(/-breaks\.json$/);
});
