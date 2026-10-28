# Testing

Nothing counts as done until it has been run. For visual features, also **look at** the output: open the debug overlay or the exported PDF pages as images and inspect them.

## 1. Unit tests (Vitest, `packages/core`)

- **Synthetic image generator** (`packages/fixtures/synth.ts`, using `@napi-rs/canvas` in Node). It renders long images with **known ground-truth glyph boxes**:
  - plain paragraphs (Latin + Chinese), headings, lists
  - dark mode, coloured background bands, grey cards with borders
  - tables with vertical and horizontal rules, zebra rows
  - a code block taller than one page (with line gaps)
  - a photo taller than one page (no gaps → forced cut)
  - two-column layout with misaligned line baselines
  - JPEG re-encoded at quality 60 (noise)
  - a scrollbar strip on the right edge
- **Invariants checked for every fixture and paper setting:**
  1. No non-forced cut intersects a ground-truth glyph box.
  2. Every page slice ≤ T (+ overlap for forced cuts).
  3. Slices tile `[0, H]` exactly (no gaps, no overlap except declared `overlapTop`).
  4. Deterministic: the same input gives the same output.
  5. Forced cuts happen only where the generator placed an unbreakable tall element.
- Unit tests for `layout.ts` (paper maths), `geometry.ts`, filename sanitising (Windows reserved names, Chinese titles), and the DP (hand-made candidate lists with known optimal answers).
- **Offline guard test**: grep the built bundle for `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` and `http(s)://` literals outside an allowlist (e.g. the `xmlns` SVG namespace). Fail on hits.

## 2. Fixture web pages (`packages/fixtures/pages/*.html`, served locally)

Each page has a `data-expect` JSON describing expectations:

| Page | Tests |
|---|---|
| `article.html` | long text, headings, figures; breaks at paragraph/section; outline |
| `sticky-header.html` | sticky + fixed header, fixed bottom cookie bar; header appears once; bar absent |
| `lazy-images.html` | `loading=lazy` + `data-src` images; none blank |
| `inner-scroll.html` | app layout (sidebar + top bar + scrolling main panel); only the panel captured, no repeats |
| `virtual-list.html` | 5,000-row virtualised list; correct stitching, hints per frame |
| `long-table.html` | 300-row table with `thead`; breaks between rows; header repetition (M6) |
| `tall-image.html` | image 3× page height; forced cut + overlap + warning |
| `canvas-chart.html` | canvas region; pixel fallback inside it |
| `iframe-xorigin.html` | cross-origin iframe (second local port); warning, pixels captured |
| `dark-mode.html` | dark background; pixel validation still finds safe rows |
| `cjk.html` | Chinese/Japanese text; text layer search works |
| `infinite.html` | keeps appending content; stops at cap with warning |
| `modal.html` | modal overlay open; warning + overlay killer |
| `animations.html` | CSS animations/transitions; output stable |
| `huge.html` | 150,000 px tall; memory stays bounded; completes |
| `wide-margins.html` | 700 px content column in a 1920 px page; auto side-crop |

## 3. End-to-end (Playwright, Chromium with the extension loaded)

- Launch a persistent context with `--disable-extensions-except` / `--load-extension` pointing at the built extension (headed, or headless mode if it supports extensions in the installed version).
- For each fixture: trigger capture through the extension's test hook (a dev-only message handler, stripped from production builds), wait for the session, export a PDF, then:
  - parse it with pdf.js in Node: page count, page sizes, extracted text contains the expected strings (text layer), link annotations exist;
  - rasterise the pages and check the "no cut through text" invariant against DOM ground truth. The fixture page can dump its own line boxes via `page.evaluate`.
- Save the debug overlays as test artifacts for human review.

## 4. Manual checklist on real sites (before calling a milestone done)

Wikipedia article · a long news article · GitHub README and a long issue thread · Google Drive PDF preview (inner scroller, image pages) · Gmail thread · Notion page · Reddit thread · a Chinese site (e.g. Zhihu answer) · a docs site with sticky sidebar (MDN) · a page with a cookie banner · a dark-themed site.
For each, record: capture OK? header repeated? blank images? cut through text? text searchable? links work? time taken? Track this in `docs/PROGRESS.md`.

## 5. Private real-world fixtures

`fixtures/private/` (git-ignored) holds the user's own long screenshots/PDFs, e.g. the NJC answer-scheme capture. They're used only for local runs of the import/pixel mode. Never commit them; they may be copyrighted.
