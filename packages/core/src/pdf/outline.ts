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

/** One bookmark: where it jumps (page and pt from the bottom) and what nests under it. */
export interface OutlineItem {
  title: string;
  page: PDFRef;
  top: number;
  children: OutlineItem[];
}

/**
 * PDF_OUTPUT §5: bookmarks from h1–h3, nested by level (an h3 under the nearest h2 or h1
 * before it), each jumping to the page showing the heading.
 */
export function outlineItems(
  pages: readonly PDFPage[],
  slices: readonly PageSlice[],
  layout: PageLayout,
  headings: readonly Heading[],
): OutlineItem[] {
  const roots: OutlineItem[] = [];
  const stack: Array<{ level: number; item: OutlineItem }> = [];
  for (const h of [...headings].sort((a, b) => a.y - b.y)) {
    const dest = locate(slices, layout, h.y);
    if (!dest) continue;
    const item: OutlineItem = {
      title: h.text,
      page: pages[dest.page]!.ref,
      top: dest.top,
      children: [],
    };
    while (stack.length && stack.at(-1)!.level >= h.level) stack.pop();
    (stack.at(-1)?.item.children ?? roots).push(item);
    stack.push({ level: h.level, item });
  }
  return roots;
}

/** Writes the document outline and opens the bookmarks panel. Returns the number of items. */
export function writeOutline(doc: PDFDocument, roots: readonly OutlineItem[]): number {
  if (!roots.length) return 0;
  const ctx = doc.context;
  const refOf = new Map<OutlineItem, PDFRef>();
  const assign = (items: readonly OutlineItem[]) => {
    for (const n of items) {
      refOf.set(n, ctx.nextRef());
      assign(n.children);
    }
  };
  assign(roots);
  const rootRef = ctx.nextRef();
  const write = (items: readonly OutlineItem[], parent: PDFRef): number => {
    let total = 0;
    items.forEach((n, i) => {
      const descendants = write(n.children, refOf.get(n)!);
      const dict: Record<string, unknown> = {
        Title: PDFHexString.fromText(n.title),
        Parent: parent,
        Dest: [n.page, PDFName.of('XYZ'), PDFNull, n.top, PDFNull],
      };
      if (i > 0) dict.Prev = refOf.get(items[i - 1]!);
      if (i < items.length - 1) dict.Next = refOf.get(items[i + 1]!);
      if (n.children.length) {
        dict.First = refOf.get(n.children[0]!);
        dict.Last = refOf.get(n.children.at(-1)!);
        dict.Count = descendants; // positive: shown open
      }
      ctx.assign(refOf.get(n)!, ctx.obj(dict as never) as unknown as PDFDict);
      total += 1 + descendants;
    });
    return total;
  };
  const total = write(roots, rootRef);
  ctx.assign(
    rootRef,
    ctx.obj({
      Type: 'Outlines',
      First: refOf.get(roots[0]!)!,
      Last: refOf.get(roots.at(-1)!)!,
      Count: total,
    }),
  );
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  return refOf.size;
}

export function addOutline(
  doc: PDFDocument,
  pages: readonly PDFPage[],
  slices: readonly PageSlice[],
  layout: PageLayout,
  headings: readonly Heading[],
): number {
  return writeOutline(doc, outlineItems(pages, slices, layout, headings));
}
