# TODO — master checklist

Work top to bottom. Each milestone ends with: tests green, the manual checks listed for that milestone done, `docs/PROGRESS.md` updated, and a commit/tag (`m1`, `m2`, …).
Time estimates are rough agent hours. **M0–M2 (~9–10 h) already replaces the paid feature.** M3–M4 bring it to FireShot-Pro level. M5–M6 make it better than FireShot.

Legend: `[ ]` todo · `(L#)` = lesson from `docs/PRIOR_ART.md` §7 · `→ DOC` = spec location.

---

## M0 — Scaffold (~1 h)

- [x] pnpm monorepo: `packages/core`, `packages/extension` (WXT, React, Tailwind), `packages/fixtures`. TS strict, ESLint, Prettier. → ARCHITECTURE
- [ ] `pnpm dev` loads the unpacked extension in Chrome with hot reload (builds and serves; desktop launch not yet verified — see PROGRESS). `pnpm build` produces `packages/extension/.output/chrome-mv3` (see DECISIONS). `pnpm zip` produces an installable zip.
- [x] Vitest in `core`. Playwright set up with the extension loaded (a smoke test opens the popup).
- [x] Offline guard test (bundle grep). → TESTING §1
- [x] Minimal manifest: `activeTab`, `scripting`, `storage`, `unlimitedStorage`, `downloads`, `clipboardWrite`, `contextMenus`; `commands` key for hotkeys. Icons (simple teal page-with-scissors glyph; SVG → PNG sizes).
- [x] `docs/DECISIONS.md` (append-only decision log) and `docs/PROGRESS.md` (status + manual-check results) created.
- [x] Port the reference Python prototype's whitespace logic to `core/pixel.ts` as a first test target.

## M1 — Capture engine: full page & visible (~4 h)

- [ ] Popup with "Capture full page" + "Visible area". Hotkeys via `commands`. Context menu entries. → UI §1
- [ ] Content-script injection on demand. Blocked-page detection with clear messages. → CAPTURE §13
- [x] Scroll-target detection (document vs largest inner scroller), with crop rect for inner scrollers (L9). → CAPTURE §3
- [ ] Mutation log + bulletproof restore (success, error, Esc, pagehide) (L13). → CAPTURE §10
- [ ] Freeze animations/transitions; pause videos. → CAPTURE §6
- [ ] Sticky → relative; fixed top → hide after frame 1; fixed bottom → hide always; skip >80%-viewport fixed elements; `background-attachment: fixed` → scroll (L8). → CAPTURE §4
- [ ] Unlock `overflow:hidden` scroll locks during capture, then restore.
- [ ] Preload pass for lazy content; eager-ify lazy images; per-frame image `decode()` wait; `document.fonts.ready` (L10). → CAPTURE §5
- [x] Capture loop with measured offsets, ≥550 ms pacing, quota-error backoff. Actual DPR from the image width. → CAPTURE §9
- [ ] Frames streamed to IndexedDB as PNG blobs. SW restart-safe.
- [ ] In-page progress pill, hidden during each grab; Esc cancels. → UI §2
- [ ] Growth detection + hard cap + loud warnings, never silent truncation (L11).
- [ ] Per-frame DOM hints: line boxes, atomic elements, boundaries, keep-with-next, opaque regions, tables, links, text runs. Deduplicated. ≤50 ms/frame budget. → CAPTURE §11
- [ ] Seam safety net: image registration when offsets are unreliable. → CAPTURE §9
- [ ] Fixture pages: article, sticky-header, lazy-images, inner-scroll, virtual-list, infinite, modal, animations, huge. E2E passes. → TESTING §2–3
- [ ] Manual: Wikipedia, Gmail, Notion, Drive preview, MDN. Record in PROGRESS.

## M2 — Smart pagination, Studio v1, export (~4–5 h) ← replaces the paid feature

- [ ] `core/layout.ts`: paper presets, orientation, margins, scale, T. → PAGINATION §1
- [ ] `core/pixel.ts`: row uniformity vs the row's own mode, edge-ignore, rule-only rows, gaps, line-gap estimate, least-damage row. → PAGINATION §4
- [ ] `core/paginate.ts`: badness from hints + pixel validation + DP with window, slider mapping α/β, pinned/removed breaks as constraints (L1, L2). → PAGINATION §2–3
- [ ] Forced cuts for over-tall elements, with overlap + "continued" marker + warning. → PAGINATION §5
- [ ] Auto side-crop to the content columns (L6). → PAGINATION §6
- [ ] Readability guard: estimated text pt size with suggestions. → PAGINATION §1
- [ ] **Debug overlay export** (PNG + JSON). Build it before tuning anything. → PAGINATION §9
- [ ] Synthetic generator + invariants test suite (all 5 invariants green). → TESTING §1
- [ ] Studio v1: long-strip view with draggable/addable/removable breaks, snapping, magnifier, colour by kind (L3); pages view; thumbnails rail; warnings chip; break-style slider + "re-run". → UI §3
- [ ] Paper size / orientation / margins controls always visible in the Pages tab (L4, L5).
- [ ] Page composition without a giant canvas. PNG/JPEG auto choice with size estimate. → PDF_OUTPUT §1
- [ ] Export: multi-page PDF (default), single long page (capped), PNG/JPEG/WebP per page (zip), long image (split if huge), copy to clipboard, print. → PDF_OUTPUT §6
- [ ] Filename template + Windows sanitising + Unicode titles (L15). → PDF_OUTPUT §7
- [ ] "After capture → Save PDF directly" fast path.
- [ ] Manual: the 11-site checklist; check PDF pages at 100% zoom on A4 for legibility.

## M3 — Real-document PDF: text layer, links, headers (~3 h)

- [ ] Invisible text layer from `TextRun`s: glyphless Identity-H font + ToUnicode (or the Noto subset fallback). Ctrl+F works for English **and Chinese** in Chrome's viewer and Acrobat (L7). → PDF_OUTPUT §2
- [ ] Reading order sorting; runs assigned to the correct page at cuts.
- [ ] Link annotations (URI + in-document GoTo). → PDF_OUTPUT §3
- [ ] Header/footer templates with tokens; non-Latin titles render visibly. → PDF_OUTPUT §4
- [ ] PDF metadata; outline/bookmarks from h1–h3. → PDF_OUTPUT §5
- [ ] E2E: extracted text contains expected strings; links present; outline present.

## M4 — More capture modes & annotation editor (~4–5 h)

- [ ] Selection capture with auto-scroll past the edges, size readout, handles. → UI §2, CAPTURE §14
- [ ] Element capture: hover outline, ↑/↓ parent/child, captures full content if the element scrolls.
- [ ] Manual "Pick scroll area" mode (L9 fallback).
- [ ] Delayed capture (3/5/10 s).
- [ ] Editor (Konva) in document coordinates: select, crop, arrow, rect, ellipse, line, pen, highlighter, text, step numbers, blur, pixelate; colours/stroke/font; unlimited undo/redo; shortcuts. → UI §3
- [ ] Annotations survive re-pagination; they're flattened into page images at export.
- [ ] Projects persisted (re-editable later from History).

## M5 — History, merge, batch (~3 h)

- [ ] History page: grid, full-text search (title/URL/captured text), retention settings, storage meter. → UI §4
- [ ] Merge queue: add any captures, reorder, page ranges → one PDF with consistent paper settings (L12). → UI §5
- [ ] All open tabs → full-page capture each (sequential, progress list, skip blocked tabs with reasons). Optional host permission requested at runtime.
- [ ] URL list → open each in a background tab, wait for load, capture full page, close. Then one PDF or one per URL.
- [ ] Options page complete. → UI §6

## M6 — Beyond FireShot (pick in order; ~4 h+)

- [ ] **Capture at width W** (temporary window resize + restore) for legible A4 (L6). → CAPTURE §8
- [ ] **Clean (reader) capture** via Readability + print-like stylesheet; optional "real text PDF via print". → CAPTURE §12
- [ ] **Overlay killer**: one click hides modals/cookie banners/chat bubbles, then recapture.
- [ ] **Auto-redact**: detect emails/phones/card numbers in DOM text → checklist → blur.
- [ ] Table header repetition across pages. → PAGINATION §7
- [ ] Watermark. → PDF_OUTPUT §4
- [ ] **Import**: open a tall PNG/JPEG/WebP or a tall single-page PDF (e.g. old FireShot output) in the Studio → pixel-mode pagination → export. Handle image-only PDFs by rendering at native image resolution via pdf.js.
- [ ] Firefox desktop build (`wxt build -b firefox`), smoke-tested on the fixtures.
- [ ] Experimental CDP capture engine toggle (`chrome.debugger`), compared against scroll-stitch on the fixtures.
- [ ] Browser-window capture via `getDisplayMedia`.

## Always / cross-cutting

- [ ] No network calls, no analytics, no remote code: offline guard test stays green.
- [ ] Every style mutation restorable; restore tested with forced errors.
- [ ] No canvas taller than one page (+ overlap); memory stays bounded on `huge.html`.
- [ ] Warnings are explicit and linked to locations; nothing fails silently.
- [ ] Keyboard access + visible focus everywhere; dark mode.
- [ ] Update `docs/PROGRESS.md` and `docs/DECISIONS.md` as you go.

## Ideas parked (not planned)

- Mobile browsers (explicitly out of scope).
- Cloud upload/sharing, FTP, OneNote, email.
- Video/GIF recording.
- OCR for canvas/image-only regions with Tesseract.js (offline WASM). Only if image-heavy pages (e.g. Drive previews) need searchable text.
