# UI & interaction design

Design stance: **a quiet, fast tool**. No splash screens, no tips carousel, no upsell, no ads. One click captures. Everything advanced is one step away, never in the way.

## Visual language

- Neutral surfaces with one accent colour, e.g. deep teal `#0E7C7B`. Light and dark themes follow the system, with a manual override.
- System font stack (`Segoe UI` on Windows), 13–14 px UI text, 8 px spacing grid, 6 px radius, subtle 1 px borders instead of heavy shadows.
- Icons: Lucide (MIT), bundled.
- Every action shows its keyboard shortcut in a tooltip/menu.
- Motion: 120–160 ms ease-out, and only for state changes (panels, toasts). Respect `prefers-reduced-motion`.
- Accessibility: all controls are keyboard reachable, visible focus rings, contrast ≥ 4.5:1, ARIA labels on icon buttons.

## 1. Popup (toolbar button)

```
┌───────────────────────────────────┐
│  ScrollPress               ⚙  🕘 │
├───────────────────────────────────┤
│ [■ Capture full page    Alt+Shift+P]│  ← big primary button
│                                   │
│  ▭ Visible area         Alt+Shift+V│
│  ⬚ Select area          Alt+Shift+S│
│  ◎ Pick element         Alt+Shift+E│
│  ☰ Clean (reader) capture          │
│  ⧉ All tabs / URL list…            │
│  ⏱ Delay: [Off ▾]                  │
├───────────────────────────────────┤
│ After capture: (•) Open Studio     │
│   ( ) Save PDF directly  ( ) Copy  │
│ Paper: A4 ▾  Width: Auto ▾         │
└───────────────────────────────────┘
```

- "After capture" lets power users skip the Studio: Save PDF directly applies the smart breaks automatically and downloads.
- Shortcut defaults are suggestions. Chrome limits the number of suggested commands, so check for conflicts and let users change them at `chrome://extensions/shortcuts` (link in Options).
- Context menu (right-click page): Capture full page / visible / element under cursor / selection.

## 2. In-page capture overlay

- A thin progress bar at the top of the viewport, plus a small pill: "Capturing 7/23 · Esc to cancel". It's hidden during frame grabs. Toggle the overlay's visibility right before each `captureVisibleTab`, so the overlay never appears in the output.
- Selection mode: dim the page, draw a crosshair rectangle with size readout, and show handles after release. Auto-scroll when dragging near the top/bottom edge. Press Enter to capture, Esc to cancel.
- Element mode: outline the hovered element with its tag, size and selector. ↑ selects the parent, ↓ the child. Click or Enter captures.

## 3. Studio (main window, extension tab)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ◀ History   "Page title"  example.com · 26 Oct 22:41    ⚠ 2 warnings   ⤓ Export│
├──────────┬──────────────────────────────────────────────────┬──────────────┤
│ Pages    │                                                  │ [Pages][Annotate][Export]
│ ┌──┐ 1   │   Canvas                                         │              │
│ │  │     │   View: (•) Pages  ( ) Long strip                │ Paper  A4 ▾  │
│ └──┘     │                                                  │ Orient ▯ ▭   │
│ ┌──┐ 2   │   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ (break)  ⠿   │ Margins 10mm │
│ │  │     │                                                  │ Crop sides Auto▾│
│ └──┘     │                                                  │ Break style  │
│  …       │                                                  │ Fewer pages ━●━ Cleaner breaks│
│          │   🔍 magnifier on hover over a break line          │ [Re-run smart breaks]│
│          │                                                  │ Header/footer…│
└──────────┴──────────────────────────────────────────────────┴──────────────┘
```

- **Long strip view**: the whole capture as a continuous column with the break lines drawn across it.
  - Drag a break line up/down. It snaps to good candidates, and holding Alt disables snapping. A live magnifier (2–3×) shows the row being cut.
  - Double-click empty space → add a break. Hover a break → ✕ removes it. Pinned breaks show a pin icon.
  - Break colour by kind: section green, paragraph teal, line amber, forced red dashed.
- **Pages view**: true page previews with margins, header/footer, exactly as exported.
- **Left rail**: page thumbnails with numbers. Click to scroll there. Drag to reorder only in merge mode.
- **Warnings chip** opens a list. Each warning links to its location: "Page 7: tall image split", "iframe content not readable", "Page kept loading — stopped at 200 screens".
- **Annotate tab**: tools in a vertical toolbar, each with a single-key shortcut: Select V, Crop C, Arrow A, Rect R, Ellipse O, Line L, Pen P, Highlighter H, Text T, Step number N, Blur B, Pixelate X. Colour, stroke and font size controls. "Auto-redact" button: lists detected emails/phones/card numbers (from DOM text), with checkboxes, then blurs them. Undo/redo with Ctrl+Z / Ctrl+Y. Annotations live in document coordinates, so they survive re-pagination.
- **Export tab**: format (PDF / PNG / JPEG / WebP / ZIP of pages / long image); PDF options (text layer ✓, links ✓, outline ✓, header/footer ✓, single long page); estimated file size; filename template preview; buttons Save (Ctrl+S), Copy image (Ctrl+Shift+C), Print (Ctrl+P), Add to merge queue.
- Studio keyboard: ←/→ page, +/- zoom, 0 fit, B add break at cursor, Del remove the selected break.

## 4. History

- A grid of cards: thumbnail, title, domain, date and page count. Search box with **full-text search** over captured page text (stored per session) plus title/URL.
- Multi-select → Merge into one PDF / Export / Delete. A storage meter, with "Keep last N days / max N GB" settings.

## 5. Merge queue

A side sheet in the Studio and History: an ordered list of captures, drag to reorder, per-item page range, then one export.

## 6. Options page

Sections: Capture (delays, lazy-load behaviour, fixed-element rules, capture width, max screens, format), Pages (default paper, margins, crop, break style), PDF (text layer, links, header/footer templates, watermark), Files (filename template, sub-folder, ask where to save), Shortcuts (link to the browser shortcut page), History (retention), Privacy statement ("ScrollPress never sends data anywhere"), Reset.

## 7. Empty, error & first-run states

- First run: a single small page. "Click the toolbar icon or press Alt+Shift+P on any page." Pin-the-extension hint. No tour.
- Blocked page: a popup message with the reason and the alternative (CAPTURE §13).
- Failure mid-capture: restore the page, keep the frames captured so far, and offer "Open what was captured" or "Retry".
