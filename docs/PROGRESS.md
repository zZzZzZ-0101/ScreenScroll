# Progress

## Current milestone
M3 — built and verified except the manual viewer checks (see M3 below). M1 and M2 are complete apart from their manual real-site checks; no milestone is tagged yet (tags follow the manual checks). Next: M4 (selection/element capture, annotation editor).

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

### M2 — Smart pagination, Studio v1, export (2026-10-27)
Built:
- `core/layout.ts` (paper maths, readability advice), `core/filename.ts`, `core/rows.ts` (pixel analysis), `core/paginate.ts` (candidates + DP + forced cuts + fallback), `core/crop.ts`, `core/debug.ts`, `@scrollpress/core/pdf` (pdf-lib assembly; kept out of the service worker and content script).
- Studio (`studio.html?session=…`): opens after every capture with frames. Pages view with full-resolution previews, Long strip with drag/add/remove breaks, snapping, magnifier and colours by kind, thumbnails rail, warnings chip, Pages and Export panels, keyboard shortcuts (Ctrl+S, Ctrl+Shift+C, Ctrl+P, ←/→).
- Exports: multi-page PDF, single long page PDF (≤ 14,000 pt), PNG/JPEG/WebP per page (zip), long PNG in ≤ 16,384 px parts, copy page, print (opens the PDF in the browser's viewer), break overlay (PNG + JSON), estimated size.
- Popup: "After capture: Open Studio / Save PDF directly" and default paper.

Verified:
- Synthetic suite (TESTING §1): 9 generated captures × A4 portrait/landscape, Letter, A5 × pixel-only and hints+pixels; all five invariants hold. Debug overlays and full-resolution strips around every break were inspected; the suite found and drove fixes for descender stems mistaken for table rules, headings separated from their text in pixel-only mode, and table-row grading.
- PDFs rendered back to images with pdf.js and inspected: article, sticky header, inner scroller, tall image (forced cut + "continued" note), synthetic Latin/CJK and photo pages. Text is legible at 100% on A4 when the page has margins to crop.
- e2e: every break on article and tall-image is checked against the page's own text line boxes; forced cuts only inside the tall image with overlap and warning; wide-margins (700 px column at 1920 px) is cropped and readable, and the readability warning appears with cropping off; Studio UI interactions (remove, re-run, double-click add, drag-to-pin, landscape, size estimate, debug export); "Save PDF directly" downloads a PDF and closes its tab; PNG zip, one-long-page PDF and long PNG exports checked on disk.

Suite at the end of M2: `pnpm test` 137/137, `pnpm e2e` 31/31 (5.3 min), lint and typecheck clean.

Not verified automatically (manual): copy page to clipboard, print, how Chrome names the downloaded file (the test browser renames downloads), the 11-site checklist.

Known limitations:
- Auto crop keeps full-width elements (e.g. a full-width header bar), so such pages print small; the Studio shows the readability warning. Manual crop handles are not built yet.
- Pixel analysis and composition run on the main thread (no Web Worker yet); fine for the fixtures, unmeasured on very long real pages.
- The footer uses Helvetica: non-Latin domains would show "?" (Unicode headers/footers are M3).

### M3 — Real-document PDF (2026-10-28)
Built:
- Invisible text layer: a 552-byte glyphless TrueType generated in code, embedded as Type0/CIDFontType2 (Identity-H) with a ToUnicode map; runs sized to their line boxes and stretched to their width; DOM reading order; each run on exactly one page (never twice across a forced-cut overlap).
- Links: URI annotations, and in-PDF jumps for anchors on the captured page; clipped at page breaks.
- Bookmarks from h1–h3, nested, opening the bookmarks panel.
- Header/footer templates (left/centre/right, tokens `{title} {url} {domain} {date} {time} {page} {pages}`); non-Latin text drawn with the browser's fonts as an image plus an invisible searchable twin; space reserved only when a band has text.
- Studio Export tab: Searchable text / Clickable links / Bookmarks toggles, header and footer inputs. One-long-page PDFs get text, links and bookmarks too.

Verified:
- Synthetic capture: pdf.js and poppler (`pdftotext`, `pdffonts`) extract every line, English and Chinese, in reading order; pdf.js positions match the visible text within 0.5 pt; fontTools decodes the font; bookmarks, URI links and jumps resolve to the right pages; a Chinese header title is visible and searchable; rendered pages show no stray text and an intact footer.
- e2e through the extension: `cjk.html` — Chinese, Japanese and English phrases each found on exactly one page by pdf.js and by poppler; Chinese title in the header on every page; external link, three in-document jumps to the right pages; nested bookmarks. `article.html` — text, external link, in-page jump and bookmarks.

Manual: Ctrl+F for an English word and a Chinese phrase in Chrome's PDF viewer and in Acrobat Reader; select text and copy-paste.

## Manual site checks
| Site | Date | Capture | Header once | Images loaded | No text cut | Text searchable | Links | Time | Notes |
|---|---|---|---|---|---|---|---|---|---|

## Known issues
- Git tag `m0` exists locally but could not be pushed: the session's git proxy dropped the tag push (only the branch push is allowed). Push it from a normal clone with `git push origin m0`, or re-create it there.
- After a capture nothing opens yet (the Studio is M2). Frames sit in IndexedDB.
- The e2e build is a non-production (unminified, React dev) build. Fine for tests; the offline guard checks the production build.

## Needs from user
- M3 manual checks: open an exported PDF of a Chinese page in Chrome and in Acrobat Reader; Ctrl+F an English word and a Chinese phrase; select a paragraph and paste it somewhere. Click a link and a bookmark.
- M2 manual checks: on a few real pages, open the Studio, save the PDF and look at it at 100% on A4: legible? any text cut? Also try Copy page, Print, and check the downloaded file name.
- When you try the extension: check the right-click menu entries and the Alt+Shift+P / Alt+Shift+V hotkeys start a capture (they need a real user gesture, so e2e can't cover them).
- Run `pnpm install && pnpm dev` on the Windows desktop once to confirm WXT opens Chrome with the extension loaded (or load `packages/extension/.output/chrome-mv3` via chrome://extensions → Load unpacked).
