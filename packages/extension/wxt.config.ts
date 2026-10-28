import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// `wxt build --mode e2e` (→ .output/chrome-mv3-e2e) adds a test hook and a localhost
// host permission so Playwright can trigger captures without a toolbar click.
// Production builds contain neither.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  zip: { artifactTemplate: 'screenscroll-{{version}}-{{browser}}.zip' },
  vite: (env) => ({
    plugins: [tailwindcss()],
    define: { __SP_E2E__: JSON.stringify(env.mode === 'e2e') },
    // The modulepreload polyfill calls fetch(); extension pages don't need it and the
    // offline guard forbids it.
    build: { modulePreload: { polyfill: false } },
  }),
  manifest: (env) => ({
    name: 'ScreenScroll',
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
    // captureVisibleTab accepts only <all_urls> or an activeTab grant, so the e2e build
    // (which cannot click the toolbar) needs <all_urls>. Production asks for nothing.
    host_permissions: env.mode === 'e2e' ? ['<all_urls>'] : [],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+O' },
        description: 'Open ScreenScroll',
      },
      'capture-full': {
        suggested_key: { default: 'Alt+Shift+P' },
        description: 'Capture full page',
      },
      'capture-selection': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Capture a selection',
      },
      // Chrome allows four suggested keys; this one is unassigned until the user sets it.
      'capture-element': { description: 'Capture an element' },
      'capture-visible': {
        suggested_key: { default: 'Alt+Shift+V' },
        description: 'Capture visible area',
      },
    },
  }),
});
