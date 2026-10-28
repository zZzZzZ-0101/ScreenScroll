# Reference prototype (Python, read-only)

`split_tall_pdf.py` is the throwaway prototype that motivated this project. It takes a very tall single-page PDF (e.g. FireShot Lite output) and writes A4-proportioned pages:

1. Renders the page at 40 dpi greyscale (`pdftoppm`) for analysis.
2. Trims blank left/right margins (columns with no pixel darker than 200/255, padded 12 pt).
3. Walks down the page; for each target A4 height, searches the window [70%, 100%] of the target for the row with the least "ink" (dark pixels), preferring lower rows on ties, and cuts there.
4. Writes each slice as a cropped view of the original page (`pypdf` mediabox/cropbox), which is lossless: nothing is re-encoded.

Result on a real capture (a 595 × 5144 pt answer scheme made of 13 stacked image tiles): 14 pages, no line of text cut, and text roughly twice as large as a naive 7-page split, thanks to the margin trim.

Known weaknesses that the real project fixes (see `docs/PAGINATION.md`):
- "Ink" means "darker than 200". It fails on dark mode and coloured backgrounds → use row uniformity against the row's own dominant colour.
- Greedy, page by page → use the DP for globally good breaks.
- No notion of paragraphs/sections/headings → DOM hints, or gap-height grading.
- No forced-cut handling for content taller than a page.
- Depends on poppler (`pdftoppm`) → the extension uses pdf.js / canvas.

Run: `python3 split_tall_pdf.py input.pdf output.pdf` (needs `pypdf`, `Pillow`, poppler's `pdftoppm`).
