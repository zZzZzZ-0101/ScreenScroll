# Capture engine

Goal: produce a set of frames that together show the captured region exactly once, with no repeated headers, no blank lazy images and no seams. Collect DOM hints as we go.

## 1. Strategy: scroll-and-stitch with `captureVisibleTab`

- This works in Chrome, Edge and Firefox, and needs only `activeTab`.
- Alternative considered: the Chrome DevTools Protocol (`chrome.debugger` + `Page.captureScreenshot` with `captureBeyondViewport`). It needs no stitching, but it shows a yellow "is debugging this browser" bar, needs the `debugger` permission, doesn't exist on Firefox, and per the prior art doesn't trigger lazy loading or handle inner scrollers. **Not in v1.** It may come back later as an "experimental engine" toggle (TODO M6).

## 2. Session flow

1. The user triggers capture (toolbar icon click, context menu or hotkey).
2. The SW injects the content script. The content script **analyses** the page: it picks the scroll target (§3), the region (full / selection / element) and the viewport rect in device pixels.
3. **Prepare** (§4–§6). Every mutation is recorded in an undo log.
4. **Preload pass** (§5). Scroll through quickly to trigger lazy content, then return to the top.
5. **Capture loop.** For each step: scroll to `y`, wait for "settled" (§7), then collect DOM hints for the visible slice (§11) — **per frame, not once**, because virtualised lists recycle DOM nodes. Then ask the SW to `captureVisibleTab` (§9 rate limit), and store the frame plus the actual scroll offset.
6. **Restore** (§10), including on error, cancel (Esc) or tab close.
7. Open the Studio with the session id.

## 3. Choosing what scrolls

- If `document.scrollingElement.scrollHeight > innerHeight + 2`, scroll the document.
- Otherwise, find candidate elements: visible, `overflow-y` of `auto|scroll|overlay`, `scrollHeight > clientHeight + 2`. Pick the one with the **largest visible area**, as long as it covers ≥ 30% of the viewport. Examples: Gmail, Notion, Slack, Drive preview.
- When both exist, prefer the inner scroller if it's large (≥ 50% of the viewport) and the document only overflows by a little (< 1 viewport).
- For an inner scroller, the frame's **crop rect = the scroller's client rect** (excluding its scrollbar). The page chrome around it (sidebars, top bar) is not repeated.
- There's also a manual override: "Pick scroll area" mode, where hovering highlights candidate scrollers and a click picks one.
- Nested scrollers: use only the chosen one. Treat other scrollers inside the region as normal content. If one of them clips content, emit a warning.

## 4. Fixed & sticky elements

Prior-art technique, refined:

- Before frame 1, enumerate elements with computed `position: fixed` or `sticky` that are visible and intersect the viewport.
- **Skip (leave alone)** any element that covers > 80% of the viewport, contains the scroll target, or *is* the scroll target or one of its ancestors.
- **Sticky** → set `position: relative; top/right/bottom/left: auto` from the start, so it appears once in its natural place.
- **Fixed**:
  - **Top-anchored** (header bars): visible in frame 1, then `visibility: hidden` for frames 2..n. With an inner scroller, fixed headers sit outside the crop rect anyway.
  - **Bottom-anchored** (cookie bars, chat bubbles, "open in app"): by default, hide them in **all** frames. Setting: "keep bottom bars on last frame".
  - **Mid-viewport overlays** (modals, newsletter pop-ups): don't hide them automatically. Show a warning and an "Overlay killer" button that hides them and retakes the capture.
- Body padding reserved for a fixed header stays (it matches frame 1). Don't touch it.
- Also neutralise `position: fixed` backgrounds (`background-attachment: fixed`) to `scroll`. Otherwise they repeat.

## 5. Lazy content

- Preload pass: scroll the target in steps of 0.9 × viewport height with ~120 ms between steps, up to a cap (default 60 s or 200 screens), then scroll back to the top.
- Before capture, set `loading="eager"` on `img[loading=lazy]` and copy common `data-src`/`data-srcset` patterns to `src`/`srcset` only if `src` is empty or a placeholder. This is a setting, on by default.
- Before each frame: wait for every `<img>` intersecting the viewport to be `complete`, then `await img.decode()`, with a 1.5 s timeout per frame. Wait for fonts once: `document.fonts.ready`.
- **Growth detection**: if `scrollHeight` grows during capture (infinite scroll), keep going up to the cap, then stop and add a warning: "Page kept loading more content; captured the first N screens."

## 6. Freezing motion

Inject a stylesheet for the capture:
```css
*, *::before, *::after {
  animation-duration: 1ms !important; animation-iteration-count: 1 !important;
  transition-duration: 1ms !important; caret-color: transparent !important;
  scroll-behavior: auto !important;
}
```
Also pause `<video>` elements, and remember and restore their play state.

## 7. "Settled" detection per step

After `scrollTo`: wait two `requestAnimationFrame`s, then ensure lazy images are loaded (§5), then a minimum dwell (default 150 ms, setting). If the measured scroll offset differs from the request (clamped at the bottom, or scroll-snap), use the **measured** offset.

## 8. Content width (readability control)

Problem: a 1920 px-wide page scaled onto A4 shrinks text to unreadable sizes (lesson L6).
Options, in order of preference:

1. **Crop to content columns** after capture, when the page has wide empty side margins. This is automatic and handled in pagination §6.
2. **"Capture at width W"** (setting: Off / 1000 / 1200 / custom). Before capture, the SW calls `chrome.windows.update(windowId, { width })` so the layout reflows narrower, waits for resize + settle, captures, then restores the original window bounds. Warn that the window will briefly resize. Not available when the window is maximised/fullscreen unless it can be un-maximised first. Restore the state too.
3. Reader mode (§12) for articles.

## 9. Rate limiting & frame capture

- Chrome limits `captureVisibleTab` per second. Space calls ≥ 550 ms (configurable). On the quota error, back off 600 ms and retry, up to 5 times.
- Format: PNG by default (lossless; text stays crisp). Setting: JPEG quality 92 for speed/size.
- Compute **actual DPR** from `frameImage.width / viewportCssWidth`, not `window.devicePixelRatio` alone, because browser zoom changes it.
- Each frame stores: `docY` (measured scroll offset of the crop top), the crop rect in device px, and image dimensions.
- Last frame: the scroll is clamped, so the frame overlaps the previous one. Keep `docY` exact, and the compositor uses only the new part.
- **Seam safety net**: if the measured offsets are unreliable (canvas apps, virtual scrollers that ignore `scrollTo`), fall back to **image registration**. Find the vertical shift between consecutive frames by matching row hashes, with normalised cross-correlation on a downscaled grey column profile. If the confidence is low, emit a warning.
- **Hard cap**: default 300 screens or 200,000 CSS px. Past that, stop with a warning (never silently truncate — L11).

## 10. Restore (must be bulletproof)

- Every mutation goes through `mutate(el, prop, value)`, which records the old inline value. Restore replays the log in reverse.
- Restore runs on success, error, Esc and `pagehide`. Restore the scroll position of both document and scroller, the window size (if changed), video play state and the injected stylesheet.
- Restore is idempotent.

## 11. DOM hints collection (per frame)

For the visible slice, in document coordinates (`rect.top + scrollOffset`, relative to the region top):

- **Text line boxes**: walk text nodes with a `TreeWalker`, skipping invisible ones (`display:none`, `visibility:hidden`, `opacity:0`, zero-size, clipped by `overflow:hidden` ancestors). For each node use a `Range` and `getClientRects()`, which gives one rect per line fragment. Union per line → forbidden intervals `[top - 1, bottom + 1]`. Batch reads; never interleave reads with writes.
- **Atomic elements** (forbidden, unless taller than a page): `img, svg, canvas, video, picture, iframe, input, textarea, select, button, math`, elements with `break-inside: avoid`, and table rows `tr`.
- **Good boundaries**: the bottom of blocks `p, li, blockquote, pre, figure, table, tr, section, article, hr, h1–h6`, and the top of `h1–h3` → kind `section`.
- **Keep-with-next**: `h1–h6` together with the first line of the next block.
- **Opaque regions**: `canvas`, cross-origin `iframe`, `img` whose natural height is > 0.5 × page height (probably an image of text, like the Drive preview pages), and `embed/object`. These need pixel analysis.
- **Tables**: row boundaries, plus the `thead` height for header repetition.
- **Text runs for the text layer**: for each line fragment: text, rect, computed font size. Words can be approximated by distributing the text across the rect width proportionally. Exact word boxes (one `Range` per word) are a stretch goal for long pages.
- **Links**: `a[href]` → `getClientRects()` → `LinkRect` (absolute URLs).
- Deduplicate hints across overlapping frames by element identity (`WeakMap` → id) plus position.
- Performance budget: ≤ 50 ms per frame on a text-heavy page. If exceeded, sample (skip text runs, keep line boxes).

## 12. Reader mode ("Clean capture")

- Clone the document, run `@mozilla/readability`, and render the result in an extension page with a print-like stylesheet: max-width ~ 720 px, readable fonts, images constrained. Then capture **that page**, with perfect DOM hints and no sticky/lazy issues.
- Keep the source URL/title for headers.
- Bonus: an option to export this as a real text PDF via the browser print dialog (`window.print()` on the reader page).

## 13. Blocked pages & errors

- `chrome://`, `edge://`, `about:`, `view-source:`, Chrome Web Store, other extensions' pages and the built-in PDF viewer: show a clear message. For the PDF viewer, suggest "Open the PDF file in ScreenScroll Studio (import)".
- `file://` needs "Allow access to file URLs". Detect and explain.
- Cross-origin iframes: content is captured as pixels, hints are opaque. Add a warning chip.

## 14. Capture modes summary

| Mode | Region | Notes |
|---|---|---|
| Full page | whole scroll target | default |
| Visible | current viewport | single frame, hints still collected |
| Selection | user-drawn rect; auto-scrolls when dragging past top/bottom edge | stitch only the selected band |
| Element | hovered DOM element (↑/↓ keys move to parent/child) | if the element itself scrolls, capture its full content |
| Delayed | any of the above after N seconds | to capture hover menus/tooltips |
| All tabs / URL list (M5) | full page per tab | sequential, progress UI, optional host permission |
