# Smart pagination

Input: one captured region, (W × H) in CSS px, plus frames, `DomHints` and page settings.
Output: an ordered list of page slices `[y0, y1)` in document coordinates. Each slice has a horizontal crop `[x0, x1)`, an optional top overlap, and diagnostics (break kind, cost, forced?).

## 1. Page geometry

- Paper presets: A4 (210×297 mm), A3, A5, Letter (8.5×11 in), Legal (8.5×14 in), Tabloid, Custom. Portrait/landscape. Margins: default 10 mm all round. Header/footer bands are reserved when enabled.
- Printable box: `pw × ph` (pt). Content crop width `cw` (CSS px, §6).
- Scale: `s = pw / cw` (pt per CSS px). **Target slice height** `T = ph / s` (CSS px).
- Option "Fit to page" (default) vs "Fixed scale %" (e.g. 100% = 0.75 pt per CSS px, matching print).
- Readability guard: the median text height (from hints) times `s` should be ≥ 7 pt. If not, show a suggestion: "Text will be small (≈5.6 pt). Try: crop margins / landscape / capture at 1000 px width."

## 2. Building the cost function along y

Every y in `[0, H]` gets a **cut badness** `b(y)` ∈ [0, ∞]:

1. **From DOM hints (primary)**
   - Inside any `forbidden` interval → ∞, unless that interval is taller than `0.9·T`. Then the element must be split; see §5.
   - At a `Boundary`: section 0, paragraph 1, listItem 1.5, tableRow 2.5, line (between two lines of the same paragraph) 4.
   - Inside a `keepWithNext` interval → +40.
   - Widow/orphan: a cut leaving < 2 lines of a paragraph on either side → +6.
   - Elsewhere in empty space (between line boxes, no boundary) → 3.
2. **From pixels (validation + opaque regions)**
   - For every candidate y from step 1, check the actual captured row (§4). If it's not "safe", nudge within ±4 CSS px to the nearest safe row. If there's none, the candidate gets +20 and is flagged.
   - Inside `opaque` regions, and when hints are missing entirely (imported images/PDFs), candidates come **only** from pixel gaps (§4), graded by gap height: gap ≥ 3× median line gap → section-like 0.5; ≥ 1.5× → paragraph-like 1.5; else line-like 4.

Candidates are the y values with finite badness. Usually there are a few hundred to a few thousand per page.

## 3. Optimal break selection (dynamic programming)

Like Knuth–Plass, but for pages. With candidates `c_0 = 0 < c_1 < … < c_n = H`:

```
dp[0] = 0
dp[j] = min over i<j with (c_j − c_i) ≤ T·(1+ε):
          dp[i] + α·fill(c_j − c_i) + β·b(c_j)      // fill = 0 for the last page
fill(h) = ((T − h)/T)^2 · 100        // underfull pages cost quadratically
```

- Defaults: `ε = 0` (hard limit; never shrink content). α = 1, β = 1.
- "Fewer pages ↔ better breaks" slider maps to α/β (α high = pack pages fully; β high = prefer clean section breaks).
- `fill` is not applied to the final page.
- Window: for each j, only consider i with `c_j − c_i ∈ [0.35·T, T]`. Pages below 35% are allowed only when unavoidable, at +50 cost.
- Back-track to get the breaks. Complexity: O(n·k), where k is the candidates per window. That's trivial.
- **User edits are constraints**: a pinned break is a mandatory candidate with b = 0, and a removed break is excluded. Re-run the DP between pinned breaks only.

## 4. Pixel analysis (fallback + validation)

Ideas from SmartStitch's pixel comparison, songflower/splith.py and Web-page-Screenshot-Segmentation:

- Work on a grey (or per-channel max) image at analysis width ≈ 800 px. Keep the scale factor.
- Ignore `g` px at the left and right edges (default 6 px at analysis scale), to drop scrollbars and frame borders.
- **Row uniformity**: a row is **safe** if `max_x |p(x) − mode(row)| ≤ τ` (τ default 12/255; tolerant of JPEG noise). Compare with the row's own dominant colour, not white. That handles dark mode, coloured bands and grey cards.
- **Rule-only rows** (tables, card borders): if the non-uniform pixels are ≤ 1.5% of the width, and those columns are the same as in the rows above and below (vertical lines), the row is "rule-safe". Treat it as a tableRow boundary when it sits between two horizontal rules, or else as a line-level cut.
- **Gaps** = maximal runs of safe rows. Cut at the **centre** of the gap, so both pages keep half the whitespace.
- **Line gap estimate**: the median height of gaps between "short ink runs" (runs < 3× median run height ≈ text lines).
- **Multi-column layouts**: a row is safe only if it's safe across the whole crop width. That's automatic with the definition above.
- **Least-damage row** (for forced cuts, §5): minimise the count of "edge" pixels (|vertical gradient| > τ) in the row, ±0.5 line height.

## 5. Elements taller than a page (forced cuts)

When a forbidden interval is taller than `0.9·T` (a huge image, a long `<pre>`, or an opaque canvas):

- Inside it, use pixel gaps if any exist (e.g. code blocks have line gaps). That isn't a "forced" cut.
- Otherwise use the least-damage row, and **repeat an overlap** of `max(24 px, 1.5 × line height)` at the top of the next page. Draw a subtle "⋯ continued" marker, which can be turned off.
- Add a warning: "Page 7: an element taller than one page was split."

## 6. Horizontal crop (content width)

- Compute the column ink profile over the whole region, with pixels or with hints (the union of text/element rects).
- Content bounds `[x0, x1]` = the first and last columns with ink, padded 12 CSS px. If the empty side margins are ≥ 15% of the width combined, crop to the content bounds (setting: Auto / Off / Manual handles in the Studio).
- Don't crop away fixed-position-free sidebars that contain content. The "ink" test already includes them. Manual crop in the Studio covers the rest.
- Effect: the reference prototype doubled the text size on the real capture this way.

## 7. Table header repetition (stretch, M6)

If a break falls inside a table with a `thead` (or a detected first row with a heavier background), draw the header row's pixels at the top of the next page, marked so it's clear it's a repetition. The header height comes out of the next page's T budget.

Built (2026-10-31): `thead` only; header ≤ 25% of T; marked by a dashed grey rule under it; its text is not repeated in the text layer; not on the single long page. See DECISIONS.

## 8. Output of pagination

```ts
interface PageSlice {
  y0: Px; y1: Px;              // document coords, region-relative
  x0: Px; x1: Px;              // horizontal crop
  overlapTop: Px;              // repeated content from previous page (forced cut)
  breakKind: 'section'|'paragraph'|'listItem'|'tableRow'|'line'|'pixel'|'forced'|'end';
  cost: number;
  warnings: string[];
}
```

## 9. Determinism & debug

- The same inputs must give the same slices. Tests rely on this.
- A **debug overlay** export draws the long thumbnail with forbidden intervals (red tint), candidates (ticks coloured by kind), chosen breaks (thick lines) and forced cuts (dashed). It also exports a JSON of the slices. This is essential for tuning; build it in M2, before tuning anything.
