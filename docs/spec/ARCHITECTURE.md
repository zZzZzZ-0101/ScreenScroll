# Architecture

## Stack (decided — change only with a written reason in `docs/project/DECISIONS.md`)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language for capture, algorithm, UI |
| Extension framework | **WXT** (Vite-based, MV3, Chrome + Firefox targets) | Hot reload, cross-browser manifests. If it gets in the way, fall back to plain Vite + a hand-written manifest |
| Manifest | MV3 | Required by Chrome |
| UI | React + Tailwind | Agent-friendly, fast to build |
| Annotation canvas | Konva (react-konva) | Shapes, transforms, hit-testing, export to image |
| PDF writing | **pdf-lib** + `@pdf-lib/fontkit` | MIT, runs in the browser, supports images, link annotations, custom fonts |
| PDF/image reading (import) | pdf.js (`pdfjs-dist`) | Render imported PDFs for pixel-mode pagination |
| Storage | IndexedDB via `idb` | Frames, projects, history (blobs are too big for `chrome.storage`) |
| Zip export | `fflate` | Small, fast |
| Reader mode | `@mozilla/readability` | Apache-2.0 |
| Tests | Vitest (unit), Playwright (e2e with the extension loaded) | |
| Package manager | pnpm | |

All dependencies are bundled. **No CDN, no remote code** (MV3 forbids remote code anyway). No `fetch` to external hosts anywhere. A lint rule plus a unit test enforce this (see TESTING).

Licence for this repo: **MIT** (keeps the option of publishing). Never copy code from AGPL/GPL projects (e.g. OpenCapture). Ideas only.

## Process model (MV3)

```
┌────────────┐  click / hotkey  ┌──────────────────────┐
│ Icon/menus │ ───────────────▶ │ Background SW        │
└────────────┘                  │ (orchestrator)       │
                                │ - captureVisibleTab  │
       inject content script ◀──│ - rate limiting      │
                                │ - writes frames → IDB│
┌──────────────────────────┐    └─────────┬────────────┘
│ Content script (page)    │◀── messages ─┘
│ - find scroller          │
│ - prepare page (sticky,  │      frames + hints + text map in IndexedDB
│   lazy, animations)      │                  │
│ - scroll step by step    │                  ▼
│ - collect DOM hints      │    ┌───────────────────────────────┐
│   (line boxes, blocks,   │    │ Studio (extension tab page)   │
│   links, text runs)      │    │ - paginate (core)             │
│ - restore everything     │    │ - preview, drag breaks        │
└──────────────────────────┘    │ - annotate (Konva)            │
                                │ - export PDF/PNG/… (pdf-lib)  │
                                └───────────────────────────────┘
```

- The **service worker** must stay thin. It can be killed at any time. It orchestrates capture and persists every frame to IndexedDB as soon as it arrives, so a SW restart loses at most one frame. Heavy work never happens in the SW.
- The **Studio** is an extension page (`studio.html?capture=<id>`) opened in a new tab after capture. All composition, pagination, editing and export happen there, in a Web Worker where possible.
- The **content script** is injected on demand with `scripting.executeScript` (no persistent content scripts, no broad host permissions).

## Packages (monorepo)

```
packages/
  core/            # pure TS, no browser-extension APIs — unit-testable in Node
    geometry.ts    # rects, intervals, coordinate transforms
    hints.ts       # DomHints types + merging
    pixel.ts       # row analysis on ImageData-like buffers
    paginate.ts    # optimal break selection (DP)
    layout.ts      # paper sizes, margins, scaling
    pdf/           # pdf-lib assembly, text layer, links, header/footer
  extension/src/
    entrypoints/   # what the browser loads (thin): background.ts, capture.ts, studio/
    studio/        # Studio UI: App.tsx, components/, engine/ (session, compose, export)
    content/       # in-page helpers used by capture.ts: pickers, scroll targets, DOM hints
    shared/        # IndexedDB, settings, messages, PNG helpers
  fixtures/        # local HTML test pages + synthetic image generator
tests/e2e/         # Playwright, extension loaded
docs/reference/    # Python prototype (read-only)
```

`core` has **no DOM or extension dependency**. Its inputs are plain data: frame bitmaps, or pixel buffers via an interface, plus a `DomHints` object. That keeps it testable and reusable for the image/PDF import feature.

## Key data types (sketch)

```ts
type Px = number;              // CSS px in document coordinates unless noted

interface CaptureSession {
  id: string;
  url: string; title: string; capturedAt: string;
  docWidth: Px; docHeight: Px;        // of the captured region
  dpr: number;                        // device pixels per CSS px actually observed
  frames: FrameRef[];                 // stored in IDB
  hints: DomHints;
  textRuns: TextRun[];                // for the invisible text layer
  links: LinkRect[];
  warnings: Warning[];
}

interface FrameRef { blobKey: string; docY: Px; heightPx: number; cropTopPx: number; }

interface DomHints {
  forbidden: Interval[];      // never cut inside: text line boxes, images, svg, canvas, video, form controls
  blockEnds: Boundary[];      // good cut positions with a quality class
  keepWithNext: Interval[];   // headings + following block start
  opaque: Rect[];             // regions DOM can't describe (canvas, cross-origin iframe, big images) → pixel analysis
  tables: TableInfo[];        // row boundaries, header row height (for header repetition)
}

interface Boundary { y: Px; kind: 'section'|'paragraph'|'listItem'|'tableRow'|'line'; }
interface TextRun { text: string; rect: Rect; fontSizePx: number; }
interface LinkRect { href: string; rect: Rect; }
```

## Memory & performance rules

- **Never allocate a canvas taller than one output page** (plus overlap). Build pages by drawing only the frames that intersect them.
- Store frames as **PNG blobs** in IndexedDB, keyed by session, and decode lazily with `createImageBitmap`. Close bitmaps after use.
- Thumbnails for the Studio's long view: build a **downscaled strip** (width ≤ 320 px) progressively, as a column of small canvases.
- Pixel analysis runs at a reduced width (~800 px), in a Worker.
- Target: a 30-screen page (~30k CSS px tall) at DPR 1.25 captures in < 25 s and exports in < 10 s on a mid-range laptop.

## Permissions (minimal)

`activeTab`, `scripting`, `storage`, `unlimitedStorage` (history), `downloads`, `clipboardWrite`, `contextMenus`. Hotkeys use the `commands` manifest key (not a permission). Add `tabs` only if the all-tabs/URL-list features need it (M5). **No `<all_urls>` host permission by default.** For batch URL capture we may need optional host permissions, requested at runtime.
