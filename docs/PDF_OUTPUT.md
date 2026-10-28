# PDF output

## 1. Page assembly

For each `PageSlice`:
1. Create a page canvas of `(x1−x0)·dpr × (y1−y0 + overlapTop)·dpr` device px. This is the only large canvas; it's at most one page.
2. Draw every frame that intersects `[y0 − overlapTop, y1)`, using only each frame's *new* rows (the overlap rule from CAPTURE §9).
3. Draw annotations (Konva layer flattened at the same scale) and the repeated table header, if any.
4. Encode: PNG by default. Setting "Smaller file (JPEG 90)". Auto heuristic: if the slice has many unique colours (photos), use JPEG 90; otherwise PNG. Show the estimated size in the export panel.
5. `pdfDoc.addPage([paperW, paperH])`, then `drawImage` at the margin offset with scale `s`, top-aligned.

Never upscale beyond the capture resolution. Embed the image at native pixels; the PDF scale handles the size.

## 2. Invisible text layer (searchable, selectable, AI-readable)

Source: `TextRun[]` from the DOM (CAPTURE §11). This works for every language, because we know the real text.

- Transform each run's rect into page coordinates (same `s`, offset and slice clipping). Drop runs outside the slice. Runs straddling a cut can't exist, because cuts never intersect line boxes; for forced cuts, assign the run to the page holding most of its height.
- Draw the text with **text rendering mode 3 (invisible)**, sized so the text width matches the rect width (`Tz` horizontal scaling, or a computed font size).
- **Font problem**: CJK and other scripts need glyph coverage, and embedding a full CJK font is 10–20 MB. Use the **"glyphless font" approach** (as in Tesseract's PDF renderer). Embed a tiny Type0/CIDFontType2 font with `Identity-H` encoding whose glyphs are empty, plus a `ToUnicode` CMap mapping CIDs to Unicode code points. Text is invisible anyway, so glyph shapes don't matter. Copy/search work through the ToUnicode map. pdf-lib exposes low-level object creation (`PDFDict`, `PDFStream`, `context.obj`), so build the font objects manually. Writing raw content-stream operators (`BT /F1 12 Tf 3 Tr … TJ ET`) is fine.
  - Fallback if the glyphless font takes too long: embed a **subset** of Noto Sans / Noto Sans SC via fontkit (`subset: true`), and draw with opacity 0. That costs more KB, but it's simpler.
  - Acceptance: in Chrome's PDF viewer and Acrobat Reader, Ctrl+F finds an English word and a Chinese phrase, selecting text highlights roughly the right area, and copy-paste gives correct text.
- Reading order: sort runs by (block order from the DOM walk, then y, then x). Within a line, keep the DOM order.

## 3. Links

For each `LinkRect` within the slice, add a `/Link` annotation with a `/URI` action at the transformed rect. In-page anchors (`#id`) map to `/GoTo` the page containing that element's y, if captured. Setting: on by default.

## 4. Headers, footers, watermark

- Template tokens: `{title} {url} {domain} {date} {time} {page} {pages}`. Defaults: header empty; footer `{domain} · {date}` on the left and `{page}/{pages}` on the right, 8 pt grey.
- These are drawn as real text (standard Helvetica for Latin). If the title has non-Latin characters, use the subset Noto font so it renders visibly.
- Watermark (M6): text, size, opacity, angle, centred on every page.

## 5. Document metadata & outline

- Title = page title, Subject = URL, Producer = "ScreenScroll", CreationDate = capture time. Keywords: none.
- **Outline (bookmarks)** from `h1–h3` hints: each heading → `/GoTo` its page. That's a nice touch for long articles (M4 stretch).

## 6. Variants

- **Single long page**: one PDF page of height H·s, if H·s ≤ 14,000 pt. Otherwise refuse with a message that suggests multi-page. Acrobat's maximum page dimension is 200 in = 14,400 pt.
- **Images**: PNG/JPEG/WebP per page (zip via fflate) or one long image. The long image is capped at a safe size (e.g. 16,384 px tall per part, split into parts beyond that, with a warning).
- **Merge**: several sessions → one PDF, in the user's order, each optionally starting with a small header line, all with consistent paper settings.

## 7. File naming

Template default: `{title}_{yyyy}-{mm}-{dd}_{HHmm}.pdf`. Sanitise for Windows (`<>:"/\|?*`, trailing dots/spaces, reserved names like `CON`), cap at 150 chars, keep Unicode (Chinese titles must work).
