# Progress

## Current milestone
M1 — nearly done (see Remaining in M1). Next: M2 (smart pagination, Studio, export). M0 done (tag `m0`, local only; see Known issues), except one unverified item: `pnpm dev` opening Chrome on a desktop (needs user).

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

### M1 — Capture engine (nearly done, 2026-10-27; 3 sessions)
Everything below is covered by e2e tests in headless Chromium with the extension loaded, and the stitched output was inspected by eye for article, sticky-header, inner-scroll, lazy-images, iframe-xorigin, virtual-list and animations.

- **Pipeline**: popup / hotkey / context menu → background injects `capture.js` → content script scrolls, settles, collects hints → background paces `captureVisibleTab` (550 ms, quota backoff) → PNG frame + `docY` + real DPR + hints into IndexedDB. The session record holds tab and window ids, so a service-worker restart mid-capture is survived (tested by wiping in-memory state).
- **Scroll target**: document vs largest inner scroller, cropped to the panel. `overflow: hidden` scroll locks on html/body are undone when nothing else scrolls (`scroll-lock.html`); app layouts keep their panel (`inner-scroll.html`).
- **Fixed/sticky**: sticky → relative; fixed top hidden from frame 2 (before settling, because of the freeze stylesheet's 1 ms transitions); fixed bottom hidden; > 80% elements skipped; `background-attachment: fixed` → scroll (`fixed-background.html`, test fails with the conversion disabled); mid-viewport modals left in place with a warning (`modal.html`).
- **Motion**: freeze stylesheet plus finishing already-running animations/transitions; two captures of `animations.html` are pixel-identical. Playing videos are paused for the capture and resumed after (`video.html` with a 4 s generated test clip).
- **Lazy content**: eager images, `data-src` over placeholders, preload pass, global and per-frame image waits with a warning (`lazy-images.html` with 2.5 s image delay; test fails with the feature disabled).
- **Restore**: `MutationLog` (reverse, idempotent, error-tolerant, removes empty `style=""`). Tested after success, Esc and an injected grab failure, comparing the page with its pre-capture state.
- **Limits and warnings**: growth/caps (`infinite.html`), cross-origin iframes (`iframe-xorigin.html`), stuck scrolling, slow hints, images still loading, blocked pages (chrome:// tested; the message explains browser pages because Chrome hides their URL).
- **DOM hints** (`lib/hints-collector.ts` → `core/hints.ts`): line boxes, line and block boundaries, keep-with-next, atomic elements, opaque regions, tables, text runs, links; de-duplicated across frames. Checked against independently measured line boxes on `article.html` and `inner-scroll.html`; all 1,000 rows of `virtual-list.html` reported once at their own position; fixed-header text reported once. Budget: on `huge.html` (150,000 px, 189 frames) median 14.7 ms, max 27.4 ms per frame.
- **Stitching geometry** (`core/compose.ts`), **seam registration** (`core/registration.ts`, unit-tested, not wired yet).

Speed: `huge.html` (150,000 px, 189 screens) captured in 2.1 minutes in headless Chromium, ≈ 0.67 s per screen, dominated by the 550 ms rate limit. Extrapolated, a 30-screen page takes ≈ 20 s plus the preload pass, inside the spec's 25 s target; not yet measured on a real laptop.

Remaining in M1:
- Seam safety net wiring (needs the Studio's compositor — M2).
- `pagehide` restore test (needs a reliable back/forward-cache setup in the test browser).
- Popup/hotkey/context-menu item stays unticked until the manual check (needs a real user gesture).
- Manual real-site checks (Wikipedia, Gmail, Notion, Drive preview, MDN) — needs the user's browser.

### Verified (end of session 3)
`pnpm test` 75/75 (incl. offline guard), `pnpm e2e` 24/24 (4.4 min, incl. the 150,000 px page), `pnpm lint` and `pnpm typecheck` clean.

## Manual site checks
| Site | Date | Capture | Header once | Images loaded | No text cut | Text searchable | Links | Time | Notes |
|---|---|---|---|---|---|---|---|---|---|

## Known issues
- Git tag `m0` exists locally but could not be pushed: the session's git proxy dropped the tag push (only the branch push is allowed). Push it from a normal clone with `git push origin m0`, or re-create it there.
- After a capture nothing opens yet (the Studio is M2). Frames sit in IndexedDB.
- The e2e build is a non-production (unminified, React dev) build. Fine for tests; the offline guard checks the production build.

## Needs from user
- When you try the extension: check the right-click menu entries and the Alt+Shift+P / Alt+Shift+V hotkeys start a capture (they need a real user gesture, so e2e can't cover them).
- Run `pnpm install && pnpm dev` on the Windows desktop once to confirm WXT opens Chrome with the extension loaded (or load `packages/extension/.output/chrome-mv3` via chrome://extensions → Load unpacked).
