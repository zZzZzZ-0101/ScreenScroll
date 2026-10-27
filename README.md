# ScrollPress

> Working name — rename freely (search-and-replace `ScrollPress` / `scrollpress`).

A free, ad-free, fully offline browser extension for **desktop Chrome / Edge (and later Firefox)** that captures any web page — including pages that scroll inside an inner panel — and turns it into **clean, standard-size, multi-page PDFs whose page breaks never slice through a line of text**. It also does everything people normally buy FireShot Pro for: area/element capture, an annotation editor, searchable text and clickable links in the PDF, headers/footers, batch capture, and a local history.

一个免费、无广告、完全离线的桌面浏览器插件：整页截图（包括页面内部滚动区域），自动按 A4/Letter 等标准纸张分页，**分页处绝不切断文字**，PDF 里文字可搜索、可复制、链接可点击；同时覆盖 FireShot Pro 的大部分功能（区域/元素截图、标注编辑器、页眉页脚、批量截图、本地历史），再加上它没有的功能。

## Why this exists

The capture tool I was using (FireShot Lite) shows ads, keeps the multi-page-PDF feature behind the Pro paywall, and outputs one giant single-page PDF that nobody — human or AI — can read without zooming. Every other free tool either cuts pages at fixed heights (slicing through text), or doesn't paginate at all.

The key insight: **an extension that takes the screenshot itself can read the page's DOM**, so it knows exactly where every line of text, table row and image is. It can choose page breaks the way a typesetter would, instead of guessing from pixels afterwards. Pixel analysis is kept as a fallback for content the DOM can't describe (canvas, images of text, cross-origin iframes, PDF viewers).

## Principles (non-negotiable)

1. **Offline & private.** No network requests at runtime, no analytics, no accounts, no remote code. Everything is processed on the machine.
2. **No ads, no nags, no paywall.**
3. **Never cut through text** unless physically impossible (an element taller than a page) — and then say so, and repeat a small overlap so nothing is lost.
4. **Readable output by default.** Pages should be legible at 100% on A4. Text layer + links on by default.
5. **Desktop first.** Mobile is explicitly out of scope.

## Repository map

| Path | What it is |
|---|---|
| `CLAUDE.md` | Instructions for the coding agent (read first) |
| `TODO.md` | The master checklist — every feature, fix and lesson, grouped by milestone |
| `KICKOFF_PROMPT.md` | The message to paste into Claude Code to start work |
| `docs/PRODUCT.md` | Goals, users, scope, feature parity table vs FireShot |
| `docs/PRIOR_ART.md` | Research: how FireShot, GoFullPage, OpenCapture & co. work, what they do well and badly, user complaints |
| `docs/ARCHITECTURE.md` | Tech stack, modules, data flow, memory/perf constraints |
| `docs/CAPTURE.md` | The capture engine: scroll-and-stitch, sticky/fixed elements, lazy loading, inner scroll containers |
| `docs/PAGINATION.md` | The smart page-break algorithm (DOM hints + pixel analysis + optimal breaking) |
| `docs/PDF_OUTPUT.md` | PDF assembly: page geometry, invisible text layer, links, headers/footers |
| `docs/UI.md` | Screens, interactions, keyboard shortcuts, visual design |
| `docs/TESTING.md` | Fixture pages, automated tests, manual checklist |
| `reference/` | A working Python prototype of whitespace-aware splitting, tested on a real capture |

## Status

Specification only. Implementation starts from `KICKOFF_PROMPT.md`.
