import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// `wxt build --mode e2e` (→ .output/chrome-mv3-e2e) adds a test hook and a localhost
// host permission so Playwright can trigger captures without a toolbar click.
// Production builds contain neither.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  zip: { artifactTemplate: 'scrollpress-{{version}}-{{browser}}.zip' },
  vite: (env) => ({
    plugins: [tailwindcss()],
    define: { __SP_E2E__: JSON.stringify(env.mode === 'e2e') },
    // The modulepreload polyfill calls fetch(); extension pages don't need it and the
    // offline guard forbids it.
    build: { modulePreload: { polyfill: false } },
  }),
  manifest: (env) => ({
    name: 'ScrollPress',
    description: 'Capture whole web pages as clean multi-page PDFs. Offline, no ads.',
    permissions: [
      'activeTab',
      'scripting',
      'storage',
      'unlimitedStorage',
      'downloads',
      'clipboardWrite',
      'contextMenus',
    ],
    host_permissions: env.mode === 'e2e' ? ['http://localhost/*', 'http://127.0.0.1/*'] : [],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+O' },
        description: 'Open ScrollPress',
      },
      'capture-full': {
        suggested_key: { default: 'Alt+Shift+P' },
        description: 'Capture full page',
      },
      'capture-visible': {
        suggested_key: { default: 'Alt+Shift+V' },
        description: 'Capture visible area',
      },
    },
  }),
});
