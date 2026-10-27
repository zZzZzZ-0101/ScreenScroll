# Progress

## Current milestone
M1 — in progress. M0 done (tag `m0`, local only; see Known issues), except one unverified item: `pnpm dev` opening Chrome on a desktop (needs user).

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

### M1 — Capture engine (in progress, 2026-10-27)
Working and verified:
- Full-page and visible capture end to end: popup / hotkey → background injects `capture.js` → content script scrolls and settles → background paces `captureVisibleTab` (550 ms, quota backoff) → PNG frames + measured `docY` + real DPR into IndexedDB.
- Scroll target: document vs largest inner scroller, cropped to the panel (`core/scroll-target.ts`). Verified on `inner-scroll.html`: only the panel, full height, no top bar or sidebar.
- Fixed/sticky handling: sticky → relative, fixed top hidden after frame 1, fixed bottom hidden always, > 80%-viewport elements skipped. Verified on `sticky-header.html`: top bar once (48 px), sticky once, cookie bar absent.
- Freeze stylesheet, video pause, `background-attachment: fixed` → scroll (code in place; no fixture yet for the last two).
- Restore through `core/mutation-log.ts` (reverse, idempotent, error-tolerant). Verified after success: scroll back at 0, no leftover `<style>`, inline styles or nodes; sticky element's computed position restored.
- Stitching geometry (`core/compose.ts`): each frame draws only rows no earlier frame covered. Stitched PNGs of all three fixtures inspected by eye: no seams, no repeats, no progress pill in the output.
- Loop planner (`core/capture-plan.ts`): growth detection and hard caps (300 screens / 200k px) with explicit warnings; unit-tested.
- Seam safety net (`core/registration.ts`): row-profile NCC registration with a confidence flag; unit-tested, **not yet wired** into the Studio.
- Blocked-page detection (`core/blocked.ts`): unit-tested; the popup shows the message, not yet e2e-tested.

Added in session 2:
- Lazy content: `loading=lazy` → eager, `data-src`/`data-srcset` copied in only over placeholders (`core/lazy.ts`), preload pass (0.9 viewport / 120 ms, capped at the capture's screen limit or 60 s with a warning), one global image wait (≤ 5 s), per-frame visible-image wait (≤ 1.5 s) with a warning if any image was still loading. `lazy-images.html` serves images with a 2.5 s delay; the e2e test samples top/middle/bottom of all 12 images. **The test fails with the new code disabled and passes with it** (checked both ways, 3 stable runs). The first version of the test only sampled image centres and missed a half-blank image at a frame seam; the global wait fixed that.
- Restore on Esc and on a failed frame grab: e2e tests compare the page with its pre-capture state. They found elements left with an empty `style=""`; `MutationLog` now removes those in a final pass.
- Infinite scroll: `infinite.html` + e2e test, capture stops at the cap with "Page kept loading more content; captured the first N screens."
- Cross-origin iframes: explicit warning; `iframe-xorigin.html` + e2e (one warning for the :5178 frame, none for the same-origin one). Stitched output inspected: both frames captured as pixels.
- Modal / pop-up overlays: a visible fixed box in the middle band of the viewport is left in place with a warning (CAPTURE §4). `modal.html` + e2e. The one-click "Overlay killer" is M6.
- Context menu: "Capture full page" / "Capture visible area". Not testable headless (needs a real right-click); needs a manual check.

- DOM hints data model (`core/hints.ts`): types plus `mergeHints`, which de-duplicates entries from overlapping frames on rounded geometry and sorts deterministically; unit-tested. The content-script collector that fills it is not written yet.

Not done yet in M1: the per-frame DOM hints collector in the content script (the big remaining item, needed by M2 pagination); `pagehide` restore test; SW-restart safety; wiring the seam safety net; fixtures virtual-list, animations, huge; Studio tab opening after capture; manual real-site checks.

### Verified (end of session 2)
`pnpm test` 75/75 (incl. offline guard), `pnpm e2e` 12/12, `pnpm lint` and `pnpm typecheck` clean.

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
