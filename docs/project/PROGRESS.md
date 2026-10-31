# Progress

## Current milestone
M4 — built and verified except manual checks (see M4 below). M1–M3 are complete apart from their manual real-site and viewer checks; no milestone is tagged yet (tags follow the manual checks). M5 started: merged-PDF assembly is in core (tested); History, merge queue UI, batch and Options are next. A UI simplification and an edge-case pass were done first, at the user's request (below).

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
- Icon-click/hotkey/context-menu item stays unticked until the manual check (needs a real user gesture).
- Manual real-site checks (Wikipedia, Gmail, Notion, Drive preview, MDN) — needs the user's browser.

### Verified (end of session 3)
`pnpm test` 75/75 (incl. offline guard), `pnpm e2e` 24/24 (4.4 min, incl. the 150,000 px page), `pnpm lint` and `pnpm typecheck` clean.

### M2 — Smart pagination, Studio v1, export (2026-10-27)
Built:
- `core/layout.ts` (paper maths, readability advice), `core/filename.ts`, `core/rows.ts` (pixel analysis), `core/paginate.ts` (candidates + DP + forced cuts + fallback), `core/crop.ts`, `core/debug.ts`, `@screenscroll/core/pdf` (pdf-lib assembly; kept out of the service worker and content script).
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
- e2e through the extension: `cjk.html` — Chinese, Japanese and English phrases each found on exactly one page by pdf.js, by poppler and by PDFium's own search API (the engine of Chrome's viewer, via `scripts/pdfium-search.py`, when `pypdfium2` is installed), with full-height highlight boxes; Chinese title in the header on every page; external link, three in-document jumps to the right pages; nested bookmarks. `article.html` — text, external link, in-page jump and bookmarks.

Manual: Ctrl+F for an English word and a Chinese phrase in Chrome's PDF viewer UI and in Acrobat Reader; select text and copy-paste.

### M4 — Capture modes and annotation editor (2026-10-28)
Built:
- Selection (drag, auto-scroll at the edges, size readout, corner handles, Enter/Esc), element (hover outline, ↑/↓ parent/child, SVG shapes pick the whole drawing), "Pick scroll area", delayed capture (3/5/10 s with a countdown). Regions are content coordinates of whatever scrolls (`core/region.ts`), so the compositor stitches them unchanged.
- Studio Annotate view and tab: Select V, Crop C, Arrow A, Rectangle R, Ellipse O, Line L, Pen P, Highlighter H, Text T, Step number N, Blur B, Pixelate X; colour swatches and picker, stroke, font size (applied to the selection too); move by dragging, double-click to edit text, Delete; unlimited undo/redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z); Clear all, Reset crop.
- Annotations live in document coordinates (`core/annotations.ts`) and are drawn by one renderer into every output: PDF pages, one-long-page PDF, image zips, long PNG, copy page, print, Pages previews and thumbnails. Blur/pixelate also drop the text-layer runs, links and bookmarks underneath.
- Crop tool: x becomes the export crop, y the pagination range. Automatic side crop widens to keep annotations in the margins; page breaks avoid cutting annotations up to 300 px tall.
- Projects (annotations + crop) are saved with the capture in IndexedDB and come back when the Studio reopens.

Verified:
- Unit: annotation model, hit tests, history, renderer, annotation-aware breaks and crop (159 tests total).
- e2e `modes.spec.ts`: selection dragged past the bottom edge, a region near the page bottom and an element picked with ↑ match Playwright screenshots of the same area (mean difference < 2/255); a scrolling element and the scroll-area picker capture the whole panel; delayed capture waits; Esc cancels.
- e2e `annotate.spec.ts` on `article.html`: draws with every main tool via mouse and keyboard, undo/redo, select/delete/move, style change, crop (slices follow the crop exactly), reset; reload restores the project; the exported PDF has the red rectangle where drawn, no dark pixels under the blur, flat blocks under the pixelate, and the redacted heading, paragraph, link and bookmark are absent in pdf.js and poppler.
- Looked at: Annotate view, crop shading, Pages previews with annotations, PDF page 1 rendered by pdf.js.

Manual: draw on a real capture with a mouse/trackpad (feel of pen and highlighter, text editing), and copy a page with annotations.

Not built yet: re-opening a project from History (History is M5); auto-redact (M6); resize handles on existing shapes (move, restyle and redraw instead).

### After the first real-site test (2026-10-28)
User report: Google Drive PDF preview not captured; no way to choose "from this line to that line"; no panel under the icon. Done: panel restored with the useful settings; line-to-line mode; scroller in front at the centre preferred (Drive-like overlay fixture); explicit warning for viewers in embedded frames; Saved captures page (sizes, search, open, delete with undo, auto-delete after N days). Tests: `lines.spec.ts`, `library.spec.ts`, panel in `smoke.spec.ts`.
Second report (Drive works but pages are cut "robotically"): document-page detection added; on a Drive-like fixture (`doc-viewer.html`, dark viewer, dimmed list on one side, a page with a dark table) the PDF has exactly one page per document page, cropped, each page's text complete (`doc-viewer.spec.ts`, `sheets.test.ts`).
Open: confirm on the user's real Drive file; background capture (planned, see DECISIONS).

### Repository reorganisation and popup removal (2026-10-28)
- No popup or start page: icon click = capture; right-click the icon for the rest; red "!" badge with the reason on pages that can't be captured. Studio duplicates removed (second break slider, second page count, debug button → Ctrl+Shift+D).
- Layered layout (see README "Repository layout"); README rewritten as the starting point; workspace packages renamed `@screenscroll/*`.
- Tests: manifest has no popup and four commands; icon click on a browser page marks the icon and clears on the next capture; icon menu stores "skip the preview" and the 5-second entry waits.

### UI distillation and edge-case pass (2026-10-28)
Asked for: a much simpler UI that keeps all the power, and a lot of edge testing.

Built:
- Popup: one primary "Capture full page" button, three tiles (Visible, Area, Element), a timer, one "skip the preview" checkbox. Blocked pages are explained before any click, with the buttons disabled.
- Studio: three modes (Pages / Breaks / Mark up) instead of two tab sets; Save PDF split button holding every other output; Pages panel with Paper, Orientation, break slider, page count and size, and everything else under "More options"; Breaks panel with three one-line instructions; Mark up toolbar in one row with S/M/L size and a one-line hint per tool; plain-language break tooltips.
- Screenshots of every screen and an overview: `docs/screenshots/` (regenerated by `tests/e2e/screenshots.spec.ts`).

Edge cases now tested (and the bugs they found, all fixed — see DECISIONS):
- Core, `packages/core/test/edge.test.ts`: pagination fuzz on 3,000 seeded random documents (lines, images and blocks taller than a page, crops, reversed ranges, pinned/removed breaks outside the page and NaN) checking continuity, max height, overlap only after forced cuts, no clean break inside a line, crop, determinism; degenerate heights (0 … 1,000,000 px); one giant image; margins larger than the paper; 1 px and 20,000 px wide captures; hostile file names (reserved, forbidden characters, dots, CJK/emoji, 500 chars, control and format characters); unknown template tokens; 13 blocked-URL cases; reversed and out-of-bounds regions; one-point strokes, zero-size boxes, empty text; undo/redo at both ends; trailing-blank trimming.
- Extension unit: corrupt stored settings (7 shapes plus field-by-field), fallback file names.
- e2e `edge.spec.ts`: one-line page → one page; hostile title → safe name keeping 报告 🙂 עברית; non-UTF-8 file system → fallback name with explanation; empty selection → error with reason; missing/deleted capture; three kinds of corrupt settings; double click + Ctrl+S → one file; keyboard-only modes and Save menu (focus, wrap, Esc, click-away); 1024 and 800 px windows in all modes without horizontal overflow; dark mode; Mark up no-ops (undo/redo/delete with nothing, 2 px drag, 10 px crop, blank text, Esc), leaving Mark up mid-typing, keys typed right after the text click; break edits kept across modes and Reset; popup blocked state and persisted checkbox; fast typing in File name and header fields keeps every character and the last value is stored.

Suite: `pnpm test` 219, `pnpm e2e` 53 (see the commit), lint and typecheck clean.

### Mark up for scanning, saved-captures delete (2026-10-28)
- Mark up toolbar trimmed to scanning tools (crop, text, rectangle, arrow, step number, mosaic, blur; three ink colours). Mark up → Page holds page labels and the watermark (every page / first / chosen pages); it shows in the Pages preview and is drawn in the PDF (rendered and checked: diagonal, faint, only on the chosen page).
- Saved captures: delete is immediate and complete; select several or all and delete for good. e2e checks the database is empty afterwards (0 sessions, 0 frames, 0 KB).
- Not yet: watermark on the single long-page PDF; details panel and export quality presets; WeChat-style area toolbar with left/right edges; OCR; background capture.
- Suite: `pnpm test` 233, affected e2e specs 20/20, lint and typecheck clean.

### Stop hint, filters, area toolbar (2026-10-28)
- Capture pill always on screen (frames skip the rows under it); Esc/Cancel keep nothing, Stop here keeps what was captured; same buttons in the toolbar panel while capturing; icon REC/WAIT; page input held off with a steady notice; tab switch waits instead of picturing the wrong tab; resize ends the capture with a notice. Pickers' hints have a Cancel button.
- Six page filters with details and exact parameters (Mark up → Page → Filter; Settings).
- Area mode: eight handles, x/y/size readout, nudge keys, toolbar (box, arrow, text, mosaic, undo, extend, copy, PDF, cancel, capture). Marks carry into the Studio.
- Checked by eye: pill mid-capture and with the paused notice; filter panel and black & white pages; area toolbar with marks.
- Needs a real-browser check: Copy from the area toolbar on a real site (clipboard focus), the toolbar panel's Stop/Cancel while capturing, REC/WAIT on the icon.

### Quality presets, Details, line-to-line edges, OCR (2026-10-29)
- PDF quality presets wired into export (Compact ≤ 150 dpi … Lossless PNG); sizes ordered on the tall-image fixture (e2e).
- Details panel with every number and its calculation; unit-tested against hand-worked numbers.
- Line to line: side handles for left/right edges (e2e).
- OCR: PP-OCRv6 small on onnxruntime-web in a worker; model downloaded on request, checksummed, kept in IndexedDB; canvas-only page becomes searchable in English and Chinese (e2e with the model served locally; `pnpm ocr:check` with the real model).
- Needs the user's check: Download model from the real mirrors (jsDelivr/unpkg are blocked in the build sandbox), and OCR on a real Google Drive PDF preview.

### M5: history, merge, batch (2026-10-30)
- Merge into one PDF (order, page ranges, bookmarks per capture, page numbers across), full-text search with snippets, Capture several pages (tabs of the window, or addresses), all with e2e tests.
- Needs the user's check: batch on real sites (logins, slow pages), and the all-sites permission prompt.

### Document pages, Mark up previews (2026-10-30)
- Page detection measured against the viewer's background (scans, slides, light viewers, dark bands, a list showing through the gaps), 13 unit tests; doc-viewer e2e within 2 px of the real page edges.
- Pages by hand (Pages panel): five numbers, prefilled from detection; e2e test.
- Mark up shows the chosen filter and the watermark at once; e2e tests.
- Needs the user's check: the PDF preview that came out at 2/3 of a page. If it still does, "Wrong page size? Set pages by hand" fixes it, and a screenshot of that capture would make a test case.

### M6: page width (2026-10-31)
- Settings → Page width (1000 / 1200 / 1440 px): window narrowed for the capture, put back on finish, Esc and tab close; 3 unit + 3 e2e tests.
- Needs the user's check: a maximised window comes back maximised.
- Overlay killer: the pop-up note in the Studio has "Hide pop-ups and capture again"; 6 e2e tests (3 kinds of pop-up, 2 look-alikes that must stay, the Studio flow). Needs the user's check on real consent walls and newsletter pop-ups.

## Manual site checks
| Site | Date | Capture | Header once | Images loaded | No text cut | Text searchable | Links | Time | Notes |
|---|---|---|---|---|---|---|---|---|---|

## Known issues
- Git tag `m0` exists locally but could not be pushed: the session's git proxy dropped the tag push (only the branch push is allowed). Push it from a normal clone with `git push origin m0`, or re-create it there.
- The e2e build is a non-production (unminified, React dev) build. Fine for tests; the offline guard checks the production build.

## Needs from user
- Look at `docs/screenshots/overview.png` (or load the extension) and say whether the simpler UI goes far enough, or too far (the popup is gone: a click on the icon captures at once; anything you miss?).
- M4 manual checks: capture a selection and an element on a real site; annotate it (pen, highlighter, text), save the PDF, reopen the capture's Studio tab later and check the annotations are still there.
- M3 manual checks: open an exported PDF of a Chinese page in Chrome and in Acrobat Reader; Ctrl+F an English word and a Chinese phrase; select a paragraph and paste it somewhere. Click a link and a bookmark.
- M2 manual checks: on a few real pages, open the Studio, save the PDF and look at it at 100% on A4: legible? any text cut? Also try Copy page, Print, and check the downloaded file name.
- When you try the extension: check the right-click menu entries and the Alt+Shift+P / Alt+Shift+V hotkeys start a capture (they need a real user gesture, so e2e can't cover them).
- Run `pnpm install && pnpm dev` on the Windows desktop once to confirm WXT opens Chrome with the extension loaded (or load `packages/extension/.output/chrome-mv3` via chrome://extensions → Load unpacked).
