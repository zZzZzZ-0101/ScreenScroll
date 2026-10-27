# Decisions (append-only)

Format: `YYYY-MM-DD — decision — reason — alternatives considered`

- 2026-10-26 — Scroll-and-stitch via `captureVisibleTab`, not CDP — works on Chrome/Edge/Firefox with only `activeTab`; no debugger infobar — CDP `captureBeyondViewport` kept as an experimental M6 toggle.
- 2026-10-26 — DOM hints first, pixel analysis as fallback/validation — the extension owns the DOM, so it knows where text lines are; pixels cover canvas/iframes/images of text — pure pixel splitting (as in webtoon tools).
- 2026-10-26 — Globally optimal breaks via DP (Knuth–Plass style) — greedy breaking produces cascades of bad breaks — greedy (reference prototype).
- 2026-10-26 — Desktop only — user requirement — mobile PWA / Firefox Android dropped.
- 2026-10-26 — MIT licence; ideas only from AGPL OpenCapture — keep freedom to publish — AGPL.
- 2026-10-27 — TypeScript 5.9, not 7.0 — TS 7 (native port) was just released; typescript-eslint and WXT type generation are tested against 5.x — TS 7.
- 2026-10-27 — Build output stays at WXT's default `packages/extension/.output/chrome-mv3` (as CLAUDE.md says), not `dist/chrome-mv3` (TODO M0 wording) — avoids fighting WXT defaults; the two docs disagreed — custom outDir.
- 2026-10-27 — e2e uses a separate build (`wxt build --mode e2e` → `.output/chrome-mv3-e2e`) that adds `host_permissions` for localhost and a test hook guarded by the compile-time flag `__SP_E2E__` — Playwright can't click the toolbar button, so `activeTab` is never granted; production stays at zero host permissions (checked by the offline guard test) — granting `<all_urls>` in production.
- 2026-10-27 — Vite's modulepreload polyfill is disabled — it contains a `fetch()` call, which the offline guard forbids; extension pages load modules directly — allowlisting it.
- 2026-10-27 — Verified: `chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2` (from WXT's generated Chrome API types, which come from Chrome's API schema; developer.chrome.com was unreachable from the build sandbox). The ≥550 ms spacing in CAPTURE §9 is consistent with it. Still to confirm by experiment in M1 (quota error text + backoff).
- 2026-10-27 — Default hotkeys: Alt+Shift+P (full page), Alt+Shift+V (visible), Alt+Shift+O (open popup). Chrome allows at most 4 suggested keys per extension, so Select (S) and Element (E) get theirs in M4 when those modes exist — users can rebind at chrome://extensions/shortcuts.
- 2026-10-27 — Correction to the e2e permission entry above: the e2e build needs `<all_urls>`, not localhost host permissions. Verified by experiment: `captureVisibleTab` fails with "Either the '<all_urls>' or 'activeTab' permission is required" when only `http://localhost/*` is granted. Production is unchanged (no host permissions; enforced by the offline guard test).
- 2026-10-27 — The content script drives the capture loop and asks the service worker for each frame; the SW only paces `captureVisibleTab` and writes to IndexedDB — keeps the SW thin and restart-tolerant (each frame is one short request); the content script owns scroll state and the mutation log anyway — SW-driven loop.
- 2026-10-27 — Frames are stored uncropped (full viewport PNG + crop rect) and cropped at composition — no image decoding in the SW — cropping in the SW with OffscreenCanvas (costs SW time and memory).
- 2026-10-27 — PNG dimensions are read from the IHDR header, and data URLs are decoded with `atob`, so the SW never calls `fetch()` or decodes images — offline guard + thin SW.
- 2026-10-27 — Fixed elements are classified top/bottom by their top edge relative to mid-viewport — simple and matches the fixture cases; the spec's "mid-viewport overlay" class (modals) is left alone and will get its warning with `modal.html` — measuring anchoring from computed `top`/`bottom` values.
