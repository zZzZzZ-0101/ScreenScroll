import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// `wxt build --mode e2e` (→ .output/chrome-mv3-e2e) adds a test hook and a localhost
// host permission so Playwright can trigger captures without a toolbar click.
// Production builds contain neither.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // A fixed name, so the download address of the latest build never changes.
  zip: { artifactTemplate: 'screenscroll-{{browser}}.zip' },
  vite: (env) => ({
    plugins: [tailwindcss()],
    define: { __SP_E2E__: JSON.stringify(env.mode === 'e2e') },
    // The modulepreload polyfill calls fetch(); extension pages don't need it and the
    // offline guard forbids it.
    build: { modulePreload: { polyfill: false } },
  }),
  manifest: (env) => ({
    // WebAssembly for text recognition (onnxruntime's .wasm, shipped in the package).
    // 'wasm-unsafe-eval' allows compiling it; script-src stays 'self', so no remote code.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
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
      ...(env.mode === 'e2e' ? ['debugger'] : []),
    ],
    // captureVisibleTab accepts only <all_urls> or an activeTab grant, so the e2e build
    // (which cannot click the toolbar) needs <all_urls>. Production asks for nothing.
    host_permissions: env.mode === 'e2e' ? ['<all_urls>'] : [],
    // Sharp capture (Settings → Sharpness) renders the page at 2–3× through the debugger. It
    // is asked for only when the user picks High or Maximum; the e2e build has it granted.
    optional_permissions: env.mode === 'e2e' ? [] : ['debugger'],
    // Capture several pages (batch) needs every site, asked for only when the user starts one.
    optional_host_permissions: env.mode === 'e2e' ? [] : ['<all_urls>'],
    // The icon opens the small panel in entrypoints/popup (UI §1).
    action: { default_title: 'ScreenScroll' },
    commands: {
      'capture-full': {
        suggested_key: { default: 'Alt+Shift+P' },
        description: 'Capture full page',
      },
      'capture-selection': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Capture a selection',
      },
      'capture-element': {
        suggested_key: { default: 'Alt+Shift+E' },
        description: 'Capture an element',
      },
      'capture-visible': {
        suggested_key: { default: 'Alt+Shift+V' },
        description: 'Capture visible area',
      },
    },
  }),
});
