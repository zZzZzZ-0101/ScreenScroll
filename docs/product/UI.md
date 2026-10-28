# UI & interaction design

Design stance: **a quiet, fast tool**. No splash screens, no tips carousel, no upsell, no ads. One click captures. Everything advanced is one step away, never in the way.

## Visual language

- Neutral surfaces with one accent colour, e.g. deep teal `#0E7C7B`. Light and dark themes follow the system, with a manual override.
- System font stack (`Segoe UI` on Windows), 13–14 px UI text, 8 px spacing grid, 6 px radius, subtle 1 px borders instead of heavy shadows.
- Icons: Lucide (MIT), bundled.
- Every action shows its keyboard shortcut in a tooltip/menu.
- Motion: 120–160 ms ease-out, and only for state changes (panels, toasts). Respect `prefers-reduced-motion`.
- Accessibility: all controls are keyboard reachable, visible focus rings, contrast ≥ 4.5:1, ARIA labels on icon buttons.

## 1. The panel (toolbar icon)

The icon opens a small panel with everything needed before a capture, nothing else (2026-10-28: an earlier version without a panel was too bare; see DECISIONS).

![Panel](../screenshots/panel.png)

- **Capture full page** (Alt+Shift+P), the main button.
- Five tiles: **Visible** (Alt+Shift+V), **Area** (Alt+Shift+S), **Line to line**, **Element** (Alt+Shift+E), **Panel** (pick a scrolling panel: mail list, document viewer). Each has a tooltip saying what it does.
- **Timer** Off / 3 / 5 / 10 s · **After capture** Review / Save PDF · **Paper**.
- **Last capture** (reopens it in the Studio) and **Saved captures** with their count and size.
- Keyboard icon: opens the browser's shortcut settings.
- On a page that can't be captured the reason is shown first and the buttons are disabled. Captures started from menus or keys on such a page put a red "!" on the icon with the reason in its tooltip.
- Right-click on the page: full page, visible, selection, line to line, element, scroll area.

## 2. In-page capture overlay

- A thin progress bar at the top of the viewport, plus a small pill: "Capturing 7/23 · Esc to cancel". It's hidden during frame grabs. Toggle the overlay's visibility right before each `captureVisibleTab`, so the overlay never appears in the output.
- Selection mode: dim the page, draw a crosshair rectangle with size readout, and show handles after release. Auto-scroll when dragging near the top/bottom edge. Press Enter to capture, Esc to cancel.
- **Line to line**: a guide line follows the pointer across whatever scrolls under it. Click the first line, scroll freely (wheel, keys, scrollbar), click the last line; the band between is shaded and its height shown. Enter = to the end, Backspace = choose the start again, Esc = cancel. Clicks never reach the page.
- Element mode: outline the hovered element with its tag, size and selector. ↑ selects the parent, ↓ the child. Click or Enter captures.

## 3. Studio (main window, extension tab)

Distilled (2026-10-28): three modes named by what you do, one primary button, and a side panel that shows only what matters for the current mode. Advanced settings are one click away under "More options". Overview of every screen: [screenshots/overview.png](../screenshots/overview.png).

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Page title                     [Pages | Breaks | Mark up]   ⚠ 2 notes [⤓ Save PDF ▾]│
│ example.com · 26 Oct · 7 pages                                             │
├──────┬────────────────────────────────────────────────────┬────────────────┤
│ 1 ▢  │                                                    │ Paper     A4 ▾ │
│ 2 ▢  │      page previews, exactly as saved               │ Orientation ▯ ▭│
│ 3 ▢  │                                                    │ Page breaks    │
│      │                                                    │ Fewer ━●━ Cleaner│
│      │                                                    │ 7 pages · 1.4 MB│
│      │                                                    │ › More options │
└──────┴────────────────────────────────────────────────────┴────────────────┘
```

- **Pages** (default): true page previews. Panel: Paper, Orientation, the "Fewer pages ↔ Cleaner breaks" slider, page count and size. **More options** (closed by default, remembered): margins, crop sides, image quality, searchable text / links / bookmarks, header and footer, file name.
- **Breaks**: the whole capture as one strip with the break lines. Drag to move (snaps; Alt = free), double-click to add, hover × to remove; a magnifier shows the cut. Break colour shows its kind; the tooltip says it in words ("Break between paragraphs"). Panel: three one-line instructions, the slider, **Reset breaks**.
- **Mark up**: the capture at full width with one toolbar row: Select · Arrow, Rectangle, Ellipse, Line · Pen, Highlighter, Text, Step number · Blur, Pixelate · Crop; six colours plus a picker; one size control (S/M/L) for both lines and text; Undo, Redo, Delete. A sentence under the toolbar says what the current tool does. Blur/pixelate also remove the text and links underneath from the PDF. Single-key shortcuts (V C A R O L P H T N B X), Ctrl+Z / Ctrl+Y.
- **Save PDF ▾**: the button saves the PDF (Ctrl+S); the arrow lists every other output: one long page PDF, PNG/JPEG/WebP pages (zip), one long image, Copy this page (Ctrl+Shift+C), Print (Ctrl+P).
- **Notes** chip (warnings) opens the list; "Page N: …" entries jump to the page.
- Left rail: page thumbnails (hidden in Mark up, which needs the width).
- Studio keyboard: ←/→ page, Ctrl+S, Ctrl+Shift+C, Ctrl+P; in Mark up the tool keys, Delete, Esc.
- If the browser refuses the file name (some systems can't store every title), the file is saved under a plain ASCII name and the toast says so.

## 4. Saved captures (history)

![Saved captures](../screenshots/saved-captures.png)

- Everything kept on this computer: thumbnail, title, site, date and size per capture; space used and space free.
- Search by title or address; **Open** reopens the Studio; delete one or several, with **Undo** for 6 seconds instead of a confirmation dialog.
- **Keep captures**: until deleted / 1 / 7 / 30 / 90 days; older captures are deleted when the page opens and after each new capture.
- Still to come (ROADMAP M5): full-text search of captured text, merge into one PDF.

## 5. Merge queue

A side sheet in the Studio and History: an ordered list of captures, drag to reorder, per-item page range, then one export.

## 6. Options page

Sections: Capture (delays, lazy-load behaviour, fixed-element rules, capture width, max screens, format), Pages (default paper, margins, crop, break style), PDF (text layer, links, header/footer templates, watermark), Files (filename template, sub-folder, ask where to save), Shortcuts (link to the browser shortcut page), History (retention), Privacy statement ("ScreenScroll never sends data anywhere"), Reset.

## 7. Empty, error & first-run states

- First run: nothing opens. The icon's tooltip says "click to capture the full page, right-click for more". No welcome page, no tour.
- Blocked page: a red "!" on the toolbar icon; its tooltip gives the reason and the alternative (CAPTURE §13).
- Failure mid-capture: restore the page, keep the frames captured so far, and offer "Open what was captured" or "Retry".
