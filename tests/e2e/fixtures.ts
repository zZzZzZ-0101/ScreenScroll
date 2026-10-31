import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const EXTENSION_PATH = fileURLToPath(
  new URL('../../packages/extension/.output/chrome-mv3-e2e', import.meta.url),
);
export const FIXTURES = 'http://localhost:5177';

interface ExtOptions {
  /** Run the browser in a UTF-8 locale, like a desktop. Off reproduces systems whose file
   * names can't hold every title (Chrome then refuses non-ASCII download names). */
  utf8: boolean;
  /** A real window (1600 × 1000) whose size sets the page's, instead of an emulated
   * 1280 × 800 viewport; for tests that resize the window. */
  windowed: boolean;
}

interface ExtFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

// Extensions need a persistent context; the bundled Chromium supports them headless.
export const test = base.extend<ExtFixtures & ExtOptions>({
  utf8: [true, { option: true }],
  windowed: [false, { option: true }],
  context: async ({ utf8, windowed }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADED,
      viewport: windowed ? null : { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        ...(windowed ? ['--window-size=1600,1000', '--screen-info={1920x1080}'] : []),
      ],
      env: { ...process.env, LANG: utf8 ? 'C.UTF-8' : 'C', LC_ALL: utf8 ? 'C.UTF-8' : 'C' },
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
