import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  webServer: {
    command: 'node packages/fixtures/scripts/serve.mjs',
    url: 'http://localhost:5177/index.html',
    reuseExistingServer: true,
  },
});
