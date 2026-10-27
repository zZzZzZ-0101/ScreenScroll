"""Split a very tall single-page PDF into A4-proportioned pages,
cutting at blank horizontal bands so no text line is sliced in half.
Lossless: pages are cropped views of the original, nothing is re-encoded."""
import sys, subprocess, tempfile, os, copy
from pypdf import PdfReader, PdfWriter
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
reader = PdfReader(src)
writer = PdfWriter()
DPI = 40
for pno, page in enumerate(reader.pages):
    x0, y0, x1, y1 = map(float, page.mediabox)
    W, H = x1 - x0, y1 - y0
    if H <= W * 297 / 210 * 1.05:
        writer.add_page(page); continue
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(["pdftoppm", "-gray", "-r", str(DPI), "-f", str(pno+1),
                        "-l", str(pno+1), "-png", src, os.path.join(td, "p")], check=True)
        img = Image.open(os.path.join(td, sorted(os.listdir(td))[0])).convert("L")
    w, h = img.size
    px = img.load()
    scale = h / H                          # pixels per point
    # trim blank side margins so the text fills the page width
    cols = [c for c in range(w) if any(px[c, r] < 200 for r in range(0, h, 3))]
    pad = 12 * scale
    left = max(0, cols[0] - pad) / scale; right = min(w, cols[-1] + pad) / scale
    x0, x1 = x0 + left, x0 + right
    W = x1 - x0
    target = W * 297 / 210
    def ink(row):                          # count dark pixels in a row
        return sum(1 for x in range(0, w, 2) if px[x, row] < 200)
    rows = [ink(r) for r in range(h)]
    cuts, top = [0.0], 0.0                 # in points from the top
    while H - top > target:
        lo, hi = top + target * 0.7, top + target
        best = min(range(int(lo*scale), int(hi*scale)), key=lambda r: (rows[r], -r))
        cut = best / scale
        cuts.append(cut); top = cut
    cuts.append(H)
    for a, b in zip(cuts, cuts[1:]):
        p = copy.copy(page)
        box = [x0, y1 - b, x1, y1 - a]     # PDF y-axis points up
        p.mediabox.lower_left = box[:2]; p.mediabox.upper_right = box[2:]
        p.cropbox.lower_left = box[:2];  p.cropbox.upper_right = box[2:]
        writer.add_page(p)
with open(dst, "wb") as f:
    writer.write(f)
print(f"{len(writer.pages)} pages written to {dst}")
