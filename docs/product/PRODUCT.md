# Product definition

## User & situation

- One primary user: a student/power user on a **Windows desktop** (Chrome as the main browser, Edge also possible). Firefox is a nice-to-have.
- Typical jobs:
  - Capture an answer scheme / article / Google Drive preview / long forum thread, and send it as a PDF that a person **or an AI model** can read page by page.
  - Capture part of a page and annotate it (arrows, highlights, blur).
  - Archive pages for later, searchable.
- Pain today: FireShot Lite shows ads, multipage PDF is paywalled, and output is a single giant page that's unreadable without zoom and that AI tools can't parse.

## Goals

1. **G1 — Smart multi-page PDF from any page, one click.** It must be correct on the hard cases: sticky headers, lazy images, inner scroll panels and long tables.
2. **G2 — Never slice through text.** Break quality should look like a typeset document.
3. **G3 — Readable by default.** Legible at 100% on A4, with a selectable/searchable text layer and clickable links.
4. **G4 — Cover ~80–90% of FireShot (Lite + Pro) day-to-day features**, for free, with no ads.
5. **G5 — Better than FireShot** where it's weak: draggable break editing, merging captures into one PDF, auto-redaction, full-text history search, clean "reader" capture, and content-width control.
6. **G6 — 100% offline and private.**

## Non-goals

- Mobile browsers.
- Cloud upload, sharing links, accounts, FTP/HTTP upload, Twitter/Flickr/ImageShack, OneNote export, email sending (a "Save then open mail client" link is enough, or nothing).
- Screen/video recording.
- GIF/BMP export (PNG/JPEG/WebP/PDF cover real needs).
- A public API.

## Feature parity table vs FireShot

Legend: ✅ planned, 🟡 partial / later milestone, ❌ deliberately skipped. M# = milestone in `docs/product/ROADMAP.md`.

| FireShot feature | FireShot tier (verified where possible) | ScreenScroll | M# |
|---|---|---|---|
| Capture full page | Lite | ✅ with sticky/lazy/animation handling | M1 |
| Capture visible area | Lite | ✅ | M1 |
| Capture selection | Lite | ✅ + auto-scroll while dragging past the viewport edge | M4 |
| Capture page element | Pro (per competitors) | ✅ hover-highlight + click; arrow keys climb the DOM tree | M4 |
| Scrolling DIVs / frames | Pro (per competitors) | ✅ auto-detected inner scroller; manual "pick the scroller" mode | M1 / M4 |
| Advanced floating-element handling | Pro (per competitors) | ✅ | M1 |
| Browser window | ? | 🟡 via `getDisplayMedia` picker | M6 |
| All open tabs | Lite = visible part only | ✅ full-page for each tab | M5 |
| List of URLs | Lite = visible part only | ✅ full-page, sequential, with a progress list | M5 |
| All tabs → one PDF | Pro | ✅ "merge into one PDF" for any set of captures | M5 |
| Very long pages without memory issues | Pro claim | ✅ streaming page composition, no giant canvas | M1–M2 |
| Single-page PDF | Lite | ✅ (option "one long page", capped at a safe height) | M2 |
| **Multipage PDF** | **Pro only (verified)** | ✅ **smart breaks, the core feature** | M2 |
| Direct links in PDF | Pro (per competitors) | ✅ from the DOM | M3 |
| Searchable/selectable text in PDF | Pro (per competitors) | ✅ invisible text layer from the DOM | M3 |
| Custom page size | ? | ✅ A4/A3/A5/Letter/Legal/Tabloid/custom, portrait/landscape, margins | M2 |
| Headers & footers | Lite = limited | ✅ templates: title, URL, date/time, page X of N | M3 |
| Watermark | Pro / limited | ✅ text watermark, opacity, angle | M6 |
| Editor: shapes, arrows, text, numbers | Pro (per competitors) | ✅ | M4 |
| Unlimited undo/redo | Pro | ✅ | M4 |
| Re-editable annotations | Pro | ✅ project saved in history (IndexedDB) | M4 |
| Crop / resize | Pro | ✅ | M4 |
| Blur / pixelate | ? | ✅ + **auto-redact** emails/phones/card numbers from the DOM | M4 / M6 |
| Save PNG / JPEG / PDF | Lite | ✅ + WebP | M2 |
| GIF / BMP | Lite | ❌ | — |
| Copy to clipboard | Lite | ✅ (PNG) | M2 |
| Print | ? | ✅ (open PDF → browser print) | M2 |
| Import from clipboard / image file | Pro? | ✅ open images & tall screenshots/PDFs in the Studio and paginate them (pixel mode) | M6 |
| History | Lite = 1 week | ✅ unlimited (size-capped), **full-text search** | M5 |
| Uploads / FTP / OneNote / email | Pro | ❌ (offline principle) | — |
| Ads | Lite shows ads | ❌ never | — |

Beyond FireShot (new):

- **Draggable / add / remove page breaks** with a magnifier preview and a "break sensitivity" slider.
- **Content-width control**: capture at a narrower layout width (e.g. 1000 CSS px) so text stays large on A4.
- **Clean capture (reader mode)**: strips nav, sidebars and ads using Mozilla Readability, then captures.
- **Overlay killer**: hide cookie banners / chat bubbles / "subscribe" modals with one click.
- **Warnings panel**: forced cuts, unreadable iframes, truncated infinite scroll, blocked page. Never silent.
- **Keep-together rules**: headings stay with the next paragraph; images/figures and table rows are never split unless taller than a page.
- **Repeat table header rows** on the next page when a table is split (stretch).
- **Merge queue**: collect captures from several pages/tabs → reorder → one PDF.
- **Filename templates** and an optional sub-folder in Downloads.
- **Full keyboard flow**.
