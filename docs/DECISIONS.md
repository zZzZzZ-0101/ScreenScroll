# Decisions (append-only)

Format: `YYYY-MM-DD — decision — reason — alternatives considered`

- 2026-10-26 — Scroll-and-stitch via `captureVisibleTab`, not CDP — works on Chrome/Edge/Firefox with only `activeTab`; no debugger infobar — CDP `captureBeyondViewport` kept as an experimental M6 toggle.
- 2026-10-26 — DOM hints first, pixel analysis as fallback/validation — the extension owns the DOM, so it knows where text lines are; pixels cover canvas/iframes/images of text — pure pixel splitting (as in webtoon tools).
- 2026-10-26 — Globally optimal breaks via DP (Knuth–Plass style) — greedy breaking produces cascades of bad breaks — greedy (reference prototype).
- 2026-10-26 — Desktop only — user requirement — mobile PWA / Firefox Android dropped.
- 2026-10-26 — MIT licence; ideas only from AGPL OpenCapture — keep freedom to publish — AGPL.
