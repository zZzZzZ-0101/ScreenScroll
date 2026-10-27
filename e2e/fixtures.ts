import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const EXTENSION_PATH = fileURLToPath(
  new URL('../packages/extension/.output/chrome-mv3-e2e', import.meta.url),
);
export const FIXTURES = 'http://localhost:5177';

interface ExtFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

// Extensions need a persistent context; the bundled Chromium supports them headless.
export const test = base.extend<ExtFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADED,
      viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(sw);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;
