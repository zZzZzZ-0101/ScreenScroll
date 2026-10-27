# Progress

## Current milestone
M0 — done (tag `m0`), except one unverified item: `pnpm dev` opening Chrome on a desktop (needs user). Next: M1 (capture engine).

## Done
### M0 — Scaffold (2026-10-27)
- pnpm monorepo: `packages/core` (pure TS), `packages/extension` (WXT 0.21 + React 19 + Tailwind 4), `packages/fixtures` (static fixture server on :5177 / :5178).
- TS strict everywhere (`noUncheckedIndexedAccess` on), ESLint (flat config, network globals banned), Prettier.
- Commands: `pnpm dev | build | zip | test | e2e | fixtures | lint | typecheck`.
- Vitest: `core/pixel.ts` (port of the reference prototype: ink rows, margin trim, greedy cuts), 6 tests.
- Offline guard test: builds the production bundle, fails on `fetch(`/XHR/WebSocket/EventSource/sendBeacon or non-allowlisted URL literals, and on any host permission. Verified it fails when a `fetch()` call is planted in the background script.
- Playwright: persistent Chromium context with the e2e build loaded (headless works); smoke tests open the popup and a fixture page.
- Manifest: `activeTab, scripting, storage, unlimitedStorage, downloads, clipboardWrite, contextMenus`; `commands` with 3 suggested hotkeys; teal page-with-scissors icons (16/32/48/128, rendered from `assets-src/icon.svg` by `scripts/icons.mjs`).

### Verified
- `pnpm test` 8/8, `pnpm e2e` 2/2, `pnpm lint`, `pnpm typecheck` clean, `pnpm zip` → `scrollpress-0.0.1-chrome.zip` (78 kB).
- `pnpm dev` builds `.output/chrome-mv3-dev` and starts the dev server; it could not auto-open Chrome in the cloud sandbox (no Chrome on PATH). Not yet tried on a desktop.

## Manual site checks
| Site | Date | Capture | Header once | Images loaded | No text cut | Text searchable | Links | Time | Notes |
|---|---|---|---|---|---|---|---|---|---|

## Known issues
- The popup's capture button is a disabled placeholder until M1.
- The e2e build is a non-production (unminified, React dev) build. Fine for tests; the offline guard checks the production build.

## Needs from user
- Run `pnpm install && pnpm dev` on the Windows desktop once to confirm WXT opens Chrome with the extension loaded (or load `packages/extension/.output/chrome-mv3` via chrome://extensions → Load unpacked).
