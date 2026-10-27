# Kickoff prompt

Paste this as your first message to Claude Code after putting these files in the repo root:

---

Read `CLAUDE.md`, `README.md`, `TODO.md` and everything in `docs/`. Then:

1. Summarise in ≤10 lines what you're building and the hard constraints, so I can confirm you've understood.
2. List any spec points you think are wrong or risky (especially platform facts marked "verify"), with what you propose instead.
3. Start **M0** and continue through **M1** and **M2** without stopping, unless you hit something only I can do. Follow the verification rules: run the tests and look at rendered outputs before ticking items.
4. At the end of each milestone, update `docs/PROGRESS.md`, commit, tag, and give me a short report: what works, what's verified, known issues, and what you need from me (e.g. "load the extension and try these 3 sites").

---

## Later sessions

> Continue from `docs/PROGRESS.md`. Next milestone is M_. Same rules.

## If something breaks on a real site

> On <URL>, capture <describe the problem: header repeated / blank images / cut through text on page N / ...>. Reproduce it with a new fixture page in `packages/fixtures/pages/`, fix it, add an e2e test, and update PROGRESS.
