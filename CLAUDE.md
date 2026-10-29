# CLAUDE.md — instructions for the coding agent

You are building **ScreenScroll**: an offline, ad-free desktop browser extension (Chrome/Edge first) that captures web pages and exports smart multi-page PDFs whose page breaks never cut through text, plus a FireShot-Pro-level feature set. Read `README.md` first, then `docs/product/ROADMAP.md`. The `docs/` folder is the spec.

## Hard constraints (never violate)

1. **Offline & private**: no network requests at runtime, no analytics/telemetry, no remote code, no CDNs. All dependencies are bundled. The offline guard test must stay green.
2. **No ads, nags, accounts or upsells.**
3. **Desktop only.** Don't spend effort on mobile.
4. **Never cut through text** except in documented forced-cut cases, which must carry an overlap and a warning.
5. **Never allocate a canvas taller than one output page** (+ overlap). Stream page composition from stored frames.
6. **Every page mutation during capture is logged and restored**, including on errors, cancel and tab close.
7. **Never fail silently.** Truncation, unreadable iframes, forced cuts and blocked pages all produce explicit warnings.
8. **Licences**: this repo is MIT. Do not copy code from GPL/AGPL projects (e.g. OpenCapture). Study ideas only. Record any third-party code you vendor in `THIRD_PARTY.md`.
9. **Private fixtures** in `fixtures/private/` are git-ignored. Never commit or print their contents.

## How to work

- Follow `docs/product/ROADMAP.md` milestone by milestone, top to bottom. Don't start a milestone before the previous one's exit criteria are met, unless the user says otherwise.
- At the start of each session: read `docs/project/PROGRESS.md` and the unchecked items in `docs/product/ROADMAP.md`.
- Make small, reviewable commits with messages like `m1: sticky header handling`. Tag each finished milestone (`m1`, `m2`, …).
- Tick TODO items only when implemented **and verified**. Record manual-check results and known issues in `docs/project/PROGRESS.md`. Record any deviation from the spec, and why, in `docs/project/DECISIONS.md` (append-only, dated).
- If the spec is ambiguous, pick the option that best serves the principles in `README.md`, write it in `DECISIONS.md` and continue. Ask the user only for things you can't do yourself (see below).
- Prefer simple, readable code. Pure logic goes in `packages/core` with unit tests. Extension glue stays thin.

## Verification rules

- Run `pnpm test` (unit) and `pnpm e2e` (Playwright) before claiming anything works.
- For anything visual (capture results, page breaks, PDFs), **render the output to images and look at them**. Use the debug overlay (PAGINATION §9). Check at least one fixture with sticky headers, one with an inner scroller and one with a tall image each milestone.
- Platform facts in the docs marked "verify" (e.g. the `captureVisibleTab` rate limit, pdf-lib low-level font APIs) must be checked against current documentation or by experiment before you build on them. Note the result in `DECISIONS.md`.

## Commands (create these in M0)

```
pnpm install
pnpm dev          # WXT dev mode, loads extension in Chrome with HMR
pnpm build        # production build → packages/extension/.output/chrome-mv3
pnpm dist         # build → extension/ (the folder users load; commit it with every extension change)
pnpm zip          # installable zip
pnpm test         # vitest (core + extension unit tests)
pnpm e2e          # playwright with the extension loaded + local fixture server
pnpm fixtures     # serve packages/fixtures/pages on localhost:5177 (+ :5178 for cross-origin)
```

## Things only the user can do (ask when you reach them, batch the asks)

- Load the unpacked extension in their own Chrome (`chrome://extensions` → Developer mode → Load unpacked) and try it on real sites.
- Grant "Allow access to file URLs" if needed for local testing.
- Decide whether to publish to the Chrome Web Store (needs a developer account), or keep it unpacked/sideloaded.
- Provide private fixtures (their own long screenshots) in `fixtures/private/`.

## Style

- TypeScript strict, no `any` in `core`. Named exports. Small modules.
- UI copy is short and plain. No exclamation marks, no marketing.
- Comments explain *why*, not *what*.
