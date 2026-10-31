# Roadmap — master checklist

Work top to bottom. Each milestone ends with: tests green, the manual checks listed for that milestone done, `docs/project/PROGRESS.md` updated, and a commit/tag (`m1`, `m2`, …).
Time estimates are rough agent hours. **M0–M2 (~9–10 h) already replaces the paid feature.** M3–M4 bring it to FireShot-Pro level. M5–M6 make it better than FireShot.

Legend: `[ ]` todo · `(L#)` = lesson from `docs/product/PRIOR_ART.md` §7 · `→ DOC` = spec location.

---

## M0 — Scaffold (~1 h)

- [x] pnpm monorepo: `packages/core`, `packages/extension` (WXT, React, Tailwind), `packages/fixtures`. TS strict, ESLint, Prettier. → ARCHITECTURE
- [ ] `pnpm dev` loads the unpacked extension in Chrome with hot reload (builds and serves; desktop launch not yet verified — see PROGRESS). `pnpm build` produces `packages/extension/.output/chrome-mv3` (see DECISIONS). `pnpm zip` produces an installable zip.
- [x] Vitest in `core`. Playwright set up with the extension loaded (a smoke test opens the popup).
- [x] Offline guard test (bundle grep). → TESTING §1
- [x] Minimal manifest: `activeTab`, `scripting`, `storage`, `unlimitedStorage`, `downloads`, `clipboardWrite`, `contextMenus`; `commands` key for hotkeys. Icons (simple teal page-with-scissors glyph; SVG → PNG sizes).
- [x] `docs/project/DECISIONS.md` (append-only decision log) and `docs/project/PROGRESS.md` (status + manual-check results) created.
- [x] Port the reference Python prototype's whitespace logic to `core/pixel.ts` as a first test target.

## M1 — Capture engine: full page & visible (~4 h)

- [ ] Toolbar icon click captures the full page; icon and page right-click menus; hotkeys via `commands` (no popup since 2026-10-28). → UI §1
- [x] Content-script injection on demand. Blocked-page detection with clear messages. → CAPTURE §13
- [x] Scroll-target detection (document vs largest inner scroller), with crop rect for inner scrollers (L9). → CAPTURE §3
- [ ] Mutation log + bulletproof restore (success, error, Esc, pagehide) (L13). → CAPTURE §10
- [x] Freeze animations/transitions; pause videos. → CAPTURE §6
- [x] Sticky → relative; fixed top → hide after frame 1; fixed bottom → hide always; skip >80%-viewport fixed elements; `background-attachment: fixed` → scroll (L8). → CAPTURE §4
- [x] Unlock `overflow:hidden` scroll locks during capture, then restore.
- [x] Preload pass for lazy content; eager-ify lazy images; per-frame image `decode()` wait; `document.fonts.ready` (L10). → CAPTURE §5
- [x] Capture loop with measured offsets, ≥550 ms pacing, quota-error backoff. Actual DPR from the image width. → CAPTURE §9
- [x] Frames streamed to IndexedDB as PNG blobs. SW restart-safe.
- [x] In-page progress pill, hidden during each grab; Esc cancels. → UI §2
- [x] Growth detection + hard cap + loud warnings, never silent truncation (L11).
- [x] Per-frame DOM hints: line boxes, atomic elements, boundaries, keep-with-next, opaque regions, tables, links, text runs. Deduplicated. ≤50 ms/frame budget. → CAPTURE §11
- [ ] Seam safety net: image registration when offsets are unreliable. → CAPTURE §9
- [x] Fixture pages: article, sticky-header, lazy-images, inner-scroll, virtual-list, infinite, modal, animations, huge. E2E passes. → TESTING §2–3
- [ ] Manual: Wikipedia, Gmail, Notion, Drive preview, MDN. Record in PROGRESS.

## M2 — Smart pagination, Studio v1, export (~4–5 h) ← replaces the paid feature

- [x] `core/layout.ts`: paper presets, orientation, margins, scale, T. → PAGINATION §1
- [x] `core/pixel.ts` (implemented as `core/rows.ts`): row uniformity vs the row's own mode, edge-ignore, rule-only rows, gaps, line-gap estimate, least-damage row. → PAGINATION §4
- [x] `core/paginate.ts`: badness from hints + pixel validation + DP with window, slider mapping α/β, pinned/removed breaks as constraints (L1, L2). → PAGINATION §2–3
- [x] Forced cuts for over-tall elements, with overlap + "continued" marker + warning. → PAGINATION §5
- [x] Auto side-crop to the content columns (L6). → PAGINATION §6
- [x] Readability guard: estimated text pt size with suggestions. → PAGINATION §1
- [x] **Debug overlay export** (PNG + JSON). Build it before tuning anything. → PAGINATION §9
- [x] Synthetic generator + invariants test suite (all 5 invariants green). → TESTING §1
- [x] Studio v1: long-strip view with draggable/addable/removable breaks, snapping, magnifier, colour by kind (L3); pages view; thumbnails rail; warnings chip; break-style slider + "re-run". → UI §3
- [x] Paper size / orientation / margins controls always visible in the Pages tab (L4, L5).
- [x] Page composition without a giant canvas. PNG/JPEG auto choice with size estimate. → PDF_OUTPUT §1
- [ ] Export: multi-page PDF (default), single long page (capped), PNG/JPEG/WebP per page (zip), long image (split if huge), copy to clipboard, print. → PDF_OUTPUT §6 _(all built; PDF, long page, PNG zip and long PNG verified by e2e; copy and print need a manual check)_
- [x] Filename template + Windows sanitising + Unicode titles (L15). → PDF_OUTPUT §7
- [x] "After capture → Save PDF directly" fast path.
- [ ] Manual: the 11-site checklist; check PDF pages at 100% zoom on A4 for legibility.

## M3 — Real-document PDF: text layer, links, headers (~3 h)

- [ ] Invisible text layer from `TextRun`s: glyphless Identity-H font + ToUnicode (or the Noto subset fallback). Ctrl+F works for English **and Chinese** in Chrome's viewer and Acrobat (L7). → PDF_OUTPUT §2 _(built; verified with pdf.js, poppler and PDFium — the engine of Chrome's viewer — for English, Chinese and Japanese, including highlight boxes; Acrobat and Chrome's actual UI need a manual Ctrl+F check)_
- [x] Reading order sorting; runs assigned to the correct page at cuts.
- [x] Link annotations (URI + in-document GoTo). → PDF_OUTPUT §3
- [x] Header/footer templates with tokens; non-Latin titles render visibly. → PDF_OUTPUT §4
- [x] PDF metadata; outline/bookmarks from h1–h3. → PDF_OUTPUT §5
- [x] E2E: extracted text contains expected strings; links present; outline present.

## M4 — More capture modes & annotation editor (~4–5 h)

- [x] Selection capture with auto-scroll past the edges, size readout, handles. → UI §2, CAPTURE §14
- [x] Element capture: hover outline, ↑/↓ parent/child, captures full content if the element scrolls.
- [x] Manual "Pick scroll area" mode (L9 fallback).
- [x] Delayed capture (3/5/10 s).
- [x] Editor (Konva) in document coordinates: select, crop, arrow, rect, ellipse, line, pen, highlighter, text, step numbers, blur, pixelate; colours/stroke/font; unlimited undo/redo; shortcuts. → UI §3
- [x] Annotations survive re-pagination; they're flattened into page images at export.
- [x] Projects persisted (re-editable later from History). *(Saved with the capture and restored by the Studio; the History entry point is M5.)*

## M5 — History, merge, batch (~3 h)

- [x] History page: list with thumbnails, full-text search (title/URL/captured text, with the matching words shown), retention settings, storage meter, delete one/several/all. → UI §4
- [x] Merge queue: add any captures, reorder, page ranges → one PDF with consistent paper settings (L12). → UI §5
- [x] All open tabs → full-page capture each (sequential, progress list, skip blocked tabs with reasons). Optional host permission requested at runtime.
- [x] URL list → open each in a tab, wait for load, capture full page, close. Then one PDF or one per URL. _(Opened in front, not in the background: captureVisibleTab pictures the visible tab.)_
- [x] Options page complete. → UI §6

## M6 — Beyond FireShot (pick in order; ~4 h+)

- [x] **Capture at width W** (temporary window resize + restore) for legible A4 (L6). → CAPTURE §8
- [ ] **Clean (reader) capture** via Readability + print-like stylesheet; optional "real text PDF via print". → CAPTURE §12
- [x] **Overlay killer**: one click hides modals/cookie banners/chat bubbles, then recapture.
- [x] **Auto-redact**: detect emails/phones/card numbers in DOM text → checklist → blur.
- [x] Table header repetition across pages. → PAGINATION §7
- [x] Watermark. → PDF_OUTPUT §4 (multi-page PDF; Mark up → Page)
- [ ] **Import** (images done 2026-10-31; PDF not yet): open a tall PNG/JPEG/WebP or a tall single-page PDF (e.g. old FireShot output) in the Studio → pixel-mode pagination → export. Handle image-only PDFs by rendering at native image resolution via pdf.js.
- [ ] Firefox desktop build (`wxt build -b firefox`), smoke-tested on the fixtures.
- [ ] Experimental CDP capture engine toggle (`chrome.debugger`), compared against scroll-stitch on the fixtures.
- [ ] Browser-window capture via `getDisplayMedia`.

## M7 — Power and precision (user direction, 2026-10-28)

Goal: the most capable screen capture tool available, that still looks simple. Automate first; make every automatic decision editable; ask the user only where confidence is low.

**Highest resolution**
- [ ] Capture at up to 2–3× the screen's pixel density (temporary device-scale override via `chrome.debugger` `Emulation.setDeviceMetricsOverride`, or browser zoom + restore). *Verify: debugger banner, memory per frame, rate limits.* Setting: Standard / High / Maximum.
- [ ] Never downscale on export unless asked; show the effective DPI per page.

**Smarter automation (less hand-editing)**
- [x] Confidence per break: highlight only the breaks that "need a look"; jump between them.
- [ ] Main-content detection: offer the article / chat / document panel pre-selected, with one click for "whole page instead".
- [ ] Repeated headers, footers and sticky bars detected across frames and removed automatically (with a note).
- [ ] Seam check by image registration on every frame; re-capture a frame automatically when a seam doesn't match.
- [ ] Auto break style per page type (article, table, chat, code, slides).
- [ ] Overlay killer and auto-redact run as suggestions after capture (M6 items, surfaced here).

**Capture scope — any part of the screen**
- [x] Line to line: click the first line, scroll, click the last line (2026-10-28).
- [x] Document viewers: one PDF page per document page, cropped to the page (2026-10-28).
- [ ] **Capture in the background** while the user reads another tab (tabCapture stream instead of captureVisibleTab; the Studio opens without taking focus).
- [ ] Viewers inside embedded frames (some document previews): find the frame's scroller and capture it.
- [ ] Several areas in one capture (pick, add another, finish) → one document.
- [ ] Horizontal and two-way scrolling (wide tables, boards, maps, canvases).
- [ ] Several scroll areas in one page (e.g. both panes of a mail client).
- [ ] "Follow my scroll": capture while the user scrolls by hand, for pages that fight automation.
- [ ] Only the scrolled part between two points (start here → end here).
- [ ] Timed series (every N seconds) and whole-window capture.

**Editing**
- [ ] Resize and rotate handles, multi-select, align and snap, layers order.
- [ ] Shapes with fill and opacity, callouts, text with background, stamps, zoom-in inset (magnified detail).
- [ ] Brush blur, find-text-and-redact, redact-all-matches.
- [ ] Page tools: reorder, delete, duplicate, insert blank, split one page, per-page crop.
- [ ] Combine captures side by side or stacked; compare two captures (visual diff).

**Interface**
- [ ] Interface languages, starting with Chinese (Simplified and Traditional).
- [ ] Export/import of saved captures and settings as a backup file. (Settings done 2026-10-31; captures not yet.)

**Output**
- [ ] Markdown/HTML with images, SVG, PDF/A; presets ("Print A4", "Share small", "Archive").

## Always / cross-cutting

- [ ] No network calls, no analytics, no remote code: offline guard test stays green.
- [ ] Every style mutation restorable; restore tested with forced errors.
- [ ] No canvas taller than one page (+ overlap); memory stays bounded on `huge.html`.
- [ ] Warnings are explicit and linked to locations; nothing fails silently.
- [ ] Keyboard access + visible focus everywhere; dark mode.
- [ ] Update `docs/project/PROGRESS.md` and `docs/project/DECISIONS.md` as you go.

## Ideas parked (not planned)

- Mobile browsers (explicitly out of scope).
- Cloud upload/sharing, FTP, OneNote, email.
- Video/GIF recording.
- OCR for canvas/image-only pages: done with PP-OCRv6 small on onnxruntime-web instead of Tesseract.js (more accurate, Chinese included); model downloaded on request. See docs/spec/OCR.md.
