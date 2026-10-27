# Third-party code

No third-party source code is vendored (copied) into this repository.

Runtime dependencies are installed from npm and bundled at build time. All are permissively licensed:

| Package | Licence | Used in |
|---|---|---|
| react, react-dom | MIT | extension UI |
| tailwindcss | MIT | extension styles (build-time, emits CSS) |

Update this table when a runtime dependency is added.

## Test assets

`packages/fixtures/pages/media/clip.webm` is generated locally with FFmpeg's `testsrc` source (`ffmpeg -f lavfi -i testsrc=size=320x180:rate=15:duration=4 -c:v libvpx -b:v 150k -an clip.webm`). It contains no third-party content.
