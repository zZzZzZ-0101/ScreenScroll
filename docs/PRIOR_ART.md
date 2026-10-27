# Prior art — what others do, what works, what doesn't

Research done 26 Oct 2026. Vendor comparison pages are written by competitors. Their claims are marked as such and should be treated as leads, not facts. Re-verify anything load-bearing against the current product before relying on it.

---

## 1. FireShot (the tool we are replacing)

**Sources:** [feature comparison](https://getfireshot.com/features.php), [support: multipage PDF](https://getfireshot.com/sup/save-screenshot-to-multipage-pdf/1560), [support: split into standard pages](https://getfireshot.com/sup/split-long-screenshots-into-standard-page-sizes-pagination-of-capture/3388), [competitor summary (fullpagescreenshotting.com)](https://fullpagescreenshotting.com/blog/fireshot-alternative), [competitor summary (opencapture.app)](https://opencapture.app/vs/fireshot.html), [competitor summary (capture-full-page.com)](https://www.capture-full-page.com/blog/fireshot-alternative), [toolradar](https://toolradar.com/tools/fireshot).

### Full feature list (from FireShot's own comparison page)

- **Capturing:** full page, visible, selection, all open tabs, list of URLs, page elements & scrolling areas, "advanced entire page captures (handling floating elements)", browser window, all tabs to PDF in one click, frames / iframes / scrolling DIVs, very long pages directly to PDF "with no size limits and memory issues".
- **PDF:** single-page PDF, multipage PDF, direct (clickable) links, text features (search, select, copy), custom page size, customisable headers & footers, all tabs into one PDF.
- **Editing:** unlimited shapes / numbers / annotations, styles, unlimited undo/redo, resizing, multi-editor GUI, watermarks, headers & footers, re-editing annotations saved in PNGs, editing images & photos.
- **Uploading:** Twitter, Flickr, EasyCaptures, ImageShack, FTP, HTTP with custom requests.
- **Saving/sharing:** PDF/JPEG/PNG/GIF/BMP, clipboard, email, export to third-party editors, drag captures into Gmail/Dropbox/OneDrive/Drive, print, OneNote.
- **Loading:** import from clipboard, import JPEG/PNG/GIF/BMP, re-open annotated PNGs, "projects".
- **Misc:** FireShot API, history.

### What's free vs paid (verified points only)

- **Multipage PDF is Pro-only.** The admin says: "The multi-page PDF feature is available only for the Pro users." This is the exact feature this project exists to provide.
- **Lite shows advertisements**, captures only the *visible part* when doing all-tabs or URL-list capture, and keeps history for one week only. Headers/footers are "limited".
- Third-party summaries say the following are Pro-only: the editor (possibly Windows-only), advanced floating-element handling, scrolling DIVs, and searchable text + links in PDFs. They quote Pro at **$39.95/yr or $99.95 lifetime**.

### What users complain about (from FireShot's own support threads)

- The multipage-PDF prompt **sometimes never appears**, or a remembered choice can't be changed. The setting is hidden behind "reset hidden dialogs" or holding SHIFT. → *Lesson: make page splitting a visible, always-available control, not a one-time dialog.*
- **Page breaks cut through text or graphics** (2015 thread). → *Lesson: this is the core problem to solve.*
- Captures came out as **one page with unreadable text** (2019). → *Lesson: default output must be readable at 100% zoom.*
- After an update, a user got a single long PDF again and **couldn't find the option**. → *Lesson: discoverability; settings shown in context.*
- Users needed **Letter size for courts/USPTO** filings and found page-size control hard to reach. → *Lesson: paper size is a first-class control in the export panel.*
- Batch mode saves **one PDF per URL**. Users asked to **combine batch output into one PDF**, and the thread left that unanswered. → *Lesson: "merge into one PDF" is a real unmet need.*
- A user wanted **custom break points** on a 48-page capture and **Acrobat truncated very long single-page PDFs**. → *Lesson: let the user drag/add/remove breaks; never produce a page longer than PDF viewers handle (Acrobat's documented max page size is 200 × 200 in = 14,400 pt; stay far below it).*
- A competitor claims FireShot doesn't detect inner scroll panels in web apps. That's unverified, but it's a known hard case for every tool.

### What FireShot does well (keep these)

- A simple, intuitive popup and a single click to capture.
- Local saving, which suits privacy.
- Breadth: lots of export targets and capture modes.
- Searchable PDF text and working links (in Pro). That's what makes its PDFs "real" documents, and we must match it for free.

---

## 2. GoFullPage (most popular full-page capture extension)

**Source:** [fullpagescreenshotting.com summary](https://fullpagescreenshotting.com/blog/fireshot-alternative).

- Free: unlimited capture to image or PDF, no ads. Works on Chrome, Edge, Firefox.
- Premium (~$12/yr per that source) adds editing, annotation and **"smart page breaks"**. That confirms smart pagination is the feature vendors charge for.
- Technique (well known): scroll-and-stitch using `captureVisibleTab`.

---

## 3. OpenCapture (open source, closest relative)

**Source:** [opencapture.app/vs/fireshot](https://opencapture.app/vs/fireshot.html). Repo: `github.com/Open-Capture/OpenCapture` (per that page).

- AGPL-3.0-or-later core. Chrome/Edge/Firefox. Visible/area/full-page capture, PNG + PDF, free editor (crop, draw, text, blur, unlimited undo). No account, no uploads. Local history of the last 50 items. Optional paid watermark module.
- It admits it lacks: multipage PDF, batch capture of tabs/URL lists, upload destinations, an API.
- **Licence caution:** AGPL. Read it for ideas. Do **not** copy code into this project unless we also adopt AGPL.

---

## 4. "Capture Full Page", "Full Page Screenshot" & similar (vendor write-ups with useful technical detail)

**Sources:** [capture-full-page.com](https://www.capture-full-page.com/blog/fireshot-alternative), [sticky header article](https://fullpage-screenshot.ai.studio/articles/sticky-header-repeats-in-screenshot), [auto-scrolling feature](https://fullpage-screenshot.ai.studio/features/automatic-scrolling), [DevTools limits](https://fullpage-screenshot.ai.studio/articles/devtools-full-page-screenshot-limits), [SuperchargeBrowser](https://www.superchargebrowser.com/features/full-page-screenshot.md).

Techniques worth copying (ideas, not code):

- **Sticky/fixed elements.** Keep them in frame 1, then hide `position: fixed` elements for later frames. Convert `position: sticky` to `relative`, with top/right/bottom/left cleared, so they sit in their natural place instead of leaving a gap. **Skip any fixed element covering more than ~80% of the viewport, or one that contains the scroller.** Hiding it would blank the capture. Watch for body padding reserved for a fixed header. **Log every style change and restore all of them, including on cancel/error.**
- **Animations.** Inject a stylesheet that sets animation/transition durations to ~1 ms and iteration count to 1, so content lands in its final state.
- **Scroll lock.** Temporarily unlock `overflow: hidden` on html/body (modals set it) and restore it afterwards.
- **Inner scroll containers.** If the document doesn't overflow, find the largest element whose `scrollHeight > clientHeight` and that is visible, scroll that instead, and crop each frame to its bounds. Typical cases are Gmail, Notion, Slack and Google Drive's preview.
- **Lazy loading.** Wait for lazy images to load and decode before each frame. Warn when content keeps growing (infinite scroll) or a modal is open.
- **Too-tall output.** One giant PNG hits canvas/image limits and is unusable. Split automatically. Chrome DevTools' "Capture full size screenshot" **silently truncates** past the limit, ignores sticky headers, doesn't trigger lazy images and captures only the document, not inner panels.
- **Privacy extras.** One-click blur of emails / phone numbers / card numbers, and auto-numbered steps for tutorials.
- **Blocked pages.** `chrome://`, `edge://`, `about:` and the Chrome Web Store can't be captured. Show a clear message.
- A weakness common to these tools: **image-only PDFs** with no selectable text. → *We beat this with a DOM-sourced invisible text layer.*

---

## 5. Splitting algorithms in the wild (for the pixel fallback)

- **SmartStitch** (MechTechnology, webtoon/manga tool; inherited by [stitchtoon](https://pypi.org/project/stitchtoon/1.1.0/), MIT). Its "pixel comparison" detector has these parameters: sensitivity 0–100 (default 90, i.e. 10% tolerance), scan-line step (default 5 px), ignorable border pixels (default 5 px) and a rough target slice height. The idea is that **a row is a safe cut if its pixels are nearly uniform**, compared with each other rather than with "white". That works on coloured and dark backgrounds. Ignoring the border pixels avoids scrollbars and edge noise.
- **[Web-page-Screenshot-Segmentation](https://pypi.org/project/Web-page-Screenshot-Segmentation/1.0.2/)** (MIT, OpenCV). Finds "low variation regions", then a split line inside them. It has thresholds for region height, variation, colour difference and colour-variation, plus a **minimum distance between split lines**, and a debug mode that **draws the split lines**. Its known bug is that paths containing Chinese characters break it. → *Lesson: test non-ASCII file names.*
- **[songflower/splith.py](https://a3nm.net/git/songflower/file/splith.py.html)** (sheet-music splitter). Ranks rows by whiteness, groups contiguous blank rows into gaps, **prefers the tallest gaps** within a tolerance, enforces a max height via coverage, absorbs tiny content fragments, and **trims blank left/right margins** of each piece. It also has a debug image.
- **[ComicCompiler/comicom](https://pypi.org/project/comicom/1.0.1/).** Breaks pages where edges are "solid white (or some other specified colour)".
- **PosteRazor** (from an [XnView forum thread](https://newsgroup.xnview.com/viewtopic.php?p=115529)). Users wanted **draggable page separators** and a **magnifier** to check whether a cut hits text. → *Lesson: break preview + drag-to-adjust + zoom.*
- **Typesetting.** The [Knuth–Plass algorithm](https://en.wikipedia.org/wiki/Knuth%E2%80%93Plass_line-breaking_algorithm) chooses line breaks by minimising total "badness" with dynamic programming, instead of greedily. Applied to page breaks, this stops one bad early break from forcing many bad later ones.
- **Our own prototype** (`reference/split_tall_pdf.py`) cut a real 14-page capture at blank bands with no sliced text, and **trimming side margins doubled text size**. That's proof the basic approach works, and it shows the importance of the content-width problem (see PAGINATION §6).

---

## 6. Platform facts

- `tabs.captureVisibleTab` returns a data URL. It needs `activeTab` or `<all_urls>`. Firefox ≤125 required `<all_urls>`, and Chrome can capture `file://` only with file access granted ([MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/Tabs/captureVisibleTab)).
- Chrome rate-limits it with `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`. Exceeding it throws "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota". One developer reported 400 ms spacing was enough ([zenn.dev](https://zenn.dev/dotdotdot/articles/ace476415edd41)). **Plan for ~2 calls/s: space calls ≥ 550 ms and retry with backoff on the quota error.** Check the current constant in Chrome's `tabs` reference during M1.
- Canvas size limits vary by browser and change over time. **Never allocate a full-length canvas.** Compose each output page from the frames that overlap it.

---

## 7. Summary: lessons turned into requirements

| # | Lesson | Where it's handled |
|---|---|---|
| L1 | Smart page breaks are the feature vendors paywall; they must be excellent and free | PAGINATION, TODO M2 |
| L2 | Fixed-height cuts slice text — users notice and hate it | PAGINATION |
| L3 | Users want to drag/add/remove breaks and zoom in to check | UI §Studio |
| L4 | Splitting must be a visible control, not a one-time hidden dialog | UI |
| L5 | Paper size (A4/Letter/Legal/custom) must be easy to set | UI, PDF_OUTPUT |
| L6 | Default output must be readable at 100% zoom → content-width control | PAGINATION §6, CAPTURE §8 |
| L7 | Image-only PDFs are a common weakness → text layer + links | PDF_OUTPUT |
| L8 | Sticky headers repeating is the #1 visual bug of scroll-stitching | CAPTURE §4 |
| L9 | Inner scroll panels (Gmail/Notion/Drive) defeat most tools | CAPTURE §3 |
| L10 | Lazy images come out blank unless pre-loaded and awaited | CAPTURE §5 |
| L11 | Silent truncation is unacceptable → warn loudly | CAPTURE §9, UI warnings |
| L12 | Combine several captures/tabs into one PDF | TODO M5 |
| L13 | Every style change must be restored, even on cancel/error | CAPTURE §10 |
| L14 | Ads, sign-up prompts and upgrade nags are why people leave | Principles |
| L15 | Test Unicode/CJK file names and page text | TESTING |
