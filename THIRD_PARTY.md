# Third-party code

No third-party source code is vendored (copied) into this repository.

Runtime dependencies are installed from npm and bundled at build time. All are permissively licensed:

| Package | Licence | Used in |
|---|---|---|
| react, react-dom | MIT | extension UI |
| tailwindcss | MIT | extension styles (build-time, emits CSS) |
| pdf-lib (+ @pdf-lib/standard-fonts, @pdf-lib/upng) | MIT | PDF assembly in the Studio |
| idb | ISC | IndexedDB wrapper |
| fflate | MIT | zip of page images |
| lucide-react | ISC | icons in the popup and Studio (tree-shaken; only the icons used are bundled) |

Dev-only (tests, never bundled): @napi-rs/canvas (MIT), pdfjs-dist (Apache-2.0), vitest, Playwright.

Update this table when a runtime dependency is added.

## Test assets

`packages/fixtures/pages/media/clip.webm` is generated locally with FFmpeg's `testsrc` source (`ffmpeg -f lavfi -i testsrc=size=320x180:rate=15:duration=4 -c:v libvpx -b:v 150k -an clip.webm`). It contains no third-party content.
