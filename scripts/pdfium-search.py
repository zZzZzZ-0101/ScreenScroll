"""Search a PDF with PDFium, the engine of Chrome's PDF viewer (dev check, not shipped).

Usage: python3 scripts/pdfium-search.py file.pdf "phrase" ["phrase" ...]
Prints JSON: {phrase: [[page, highlight_height_pt], ...]}. Needs `pip install pypdfium2`.
"""
import json
import sys

import pypdfium2 as pdfium

pdf = pdfium.PdfDocument(sys.argv[1])
result = {}
for phrase in sys.argv[2:]:
    hits = []
    for i in range(len(pdf)):
        text = pdf[i].get_textpage()
        search = text.search(phrase)
        while (hit := search.get_next()) is not None:
            start, count = hit
            boxes = [text.get_charbox(k) for k in range(start, start + count)]
            hits.append([i + 1, round(max(b[3] for b in boxes) - min(b[1] for b in boxes), 1)])
    result[phrase] = hits
print(json.dumps(result, ensure_ascii=False))
