import {
  PDFHexString,
  PDFName,
  PDFNull,
  type PDFDict,
  type PDFDocument,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import type { Heading } from '../hints.js';
import type { PageLayout } from '../layout.js';
import type { PageSlice } from '../paginate.js';
import { locate } from './locate.js';

interface Node {
  heading: Heading;
  ref: PDFRef;
  children: Node[];
}

/**
 * PDF_OUTPUT §5: bookmarks from h1–h3, nested by level (an h3 under the nearest h2 or h1
 * before it), each jumping to the page showing the heading. Returns the number of items.
 */
export function addOutline(
  doc: PDFDocument,
  pages: readonly PDFPage[],
  slices: readonly PageSlice[],
  layout: PageLayout,
  headings: readonly Heading[],
): number {
  const ctx = doc.context;
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const h of [...headings].sort((a, b) => a.y - b.y)) {
    if (!locate(slices, layout, h.y)) continue;
    const node: Node = { heading: h, ref: ctx.nextRef(), children: [] };
    while (stack.length && stack.at(-1)!.heading.level >= h.level) stack.pop();
    (stack.at(-1)?.children ?? roots).push(node);
    stack.push(node);
  }
  if (!roots.length) return 0;

  const rootRef = ctx.nextRef();
  let count = 0;
  const write = (nodes: Node[], parent: PDFRef): number => {
    let total = 0;
    nodes.forEach((n, i) => {
      const dest = locate(slices, layout, n.heading.y)!;
      const descendants = write(n.children, n.ref);
      const dict: Record<string, unknown> = {
        Title: PDFHexString.fromText(n.heading.text),
        Parent: parent,
        Dest: [pages[dest.page]!.ref, PDFName.of('XYZ'), PDFNull, dest.top, PDFNull],
      };
      if (i > 0) dict.Prev = nodes[i - 1]!.ref;
      if (i < nodes.length - 1) dict.Next = nodes[i + 1]!.ref;
      if (n.children.length) {
        dict.First = n.children[0]!.ref;
        dict.Last = n.children.at(-1)!.ref;
        dict.Count = descendants; // positive: shown open
      }
      ctx.assign(n.ref, ctx.obj(dict as never) as unknown as PDFDict);
      total += 1 + descendants;
      count++;
    });
    return total;
  };
  const total = write(roots, rootRef);
  ctx.assign(
    rootRef,
    ctx.obj({ Type: 'Outlines', First: roots[0]!.ref, Last: roots.at(-1)!.ref, Count: total }),
  );
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  return count;
}
