/**
 * M8 "what changed": the difference between two captures' text, paragraph by paragraph,
 * with the words that changed inside a paragraph that was edited rather than replaced.
 * Longest common subsequence: exact and simple; inputs are capped so it stays quick.
 */
export type DiffOp<T> =
  { kind: 'same'; a: T; b: T } | { kind: 'add'; b: T } | { kind: 'del'; a: T };

const MAX = 4000;

export function diffSeq<T>(
  a: readonly T[],
  b: readonly T[],
  eq: (x: T, y: T) => boolean = Object.is,
): DiffOp<T>[] {
  // Common head and tail first: most edits are local, and it keeps the table small.
  let start = 0;
  while (start < a.length && start < b.length && eq(a[start]!, b[start]!)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && eq(a[endA - 1]!, b[endB - 1]!)) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, Math.min(endA, start + MAX));
  const midB = b.slice(start, Math.min(endB, start + MAX));
  const n = midA.length;
  const m = midB.length;
  // lcs[i][j]: common length of midA[i..] and midB[j..], one flat array.
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * (m + 1) + j] = eq(midA[i]!, midB[j]!)
        ? lcs[(i + 1) * (m + 1) + j + 1]! + 1
        : Math.max(lcs[(i + 1) * (m + 1) + j]!, lcs[i * (m + 1) + j + 1]!);
  const ops: DiffOp<T>[] = [];
  for (let k = 0; k < start; k++) ops.push({ kind: 'same', a: a[k]!, b: b[k]! });
  let i = 0;
  let j = 0;
  // On a tie the removal comes first, so an edit reads "old, then new".
  while (i < n || j < m) {
    if (i < n && j < m && eq(midA[i]!, midB[j]!)) {
      ops.push({ kind: 'same', a: midA[i++]!, b: midB[j++]! });
    } else if (j < m && (i >= n || lcs[i * (m + 1) + j + 1]! > lcs[(i + 1) * (m + 1) + j]!)) {
      ops.push({ kind: 'add', b: midB[j++]! });
    } else {
      ops.push({ kind: 'del', a: midA[i++]! });
    }
  }
  // Past the cap (very long texts): the rest is shown as replaced.
  for (let k = start + n; k < endA; k++) ops.push({ kind: 'del', a: a[k]! });
  for (let k = start + m; k < endB; k++) ops.push({ kind: 'add', b: b[k]! });
  for (let k = endA; k < a.length; k++)
    ops.push({ kind: 'same', a: a[k]!, b: b[endB + k - endA]! });
  return ops;
}

export type TextChange =
  | { kind: 'same'; text: string }
  | { kind: 'add'; text: string }
  | { kind: 'del'; text: string }
  /** An edited paragraph: its words, each kept, added or removed. */
  | { kind: 'edit'; words: Array<{ kind: 'same' | 'add' | 'del'; text: string }> };

/**
 * Paragraph diff of two texts (paragraphs = blank-line separated, as Markdown). A removed
 * paragraph followed by an added one that shares at least half its words is an edit, shown
 * word by word.
 */
export function diffText(before: string, after: string): TextChange[] {
  const paras = (s: string) =>
    s
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  const ops = diffSeq(paras(before), paras(after));
  const out: TextChange[] = [];
  const shared = (a: string, b: string) => {
    const wa = a.split(' ');
    const wb = b.split(' ');
    const words = diffSeq(wa, wb);
    const kept = words.filter((w) => w.kind === 'same').length;
    return kept >= 0.5 * Math.max(wa.length, wb.length) ? words : null;
  };
  for (let k = 0; k < ops.length;) {
    const op = ops[k]!;
    if (op.kind === 'same') {
      out.push({ kind: 'same', text: op.a });
      k++;
      continue;
    }
    // A run of changes: pair each removed paragraph with the first added one that keeps
    // at least half its words (an edit); the rest are plain removals and additions.
    const dels: string[] = [];
    const adds: string[] = [];
    for (; k < ops.length && ops[k]!.kind !== 'same'; k++) {
      const o = ops[k]!;
      if (o.kind === 'del') dels.push(o.a);
      else if (o.kind === 'add') adds.push(o.b);
    }
    const used = new Set<number>();
    for (const d of dels) {
      const m = adds.findIndex((a, n) => !used.has(n) && shared(d, a));
      if (m < 0) {
        out.push({ kind: 'del', text: d });
        continue;
      }
      used.add(m);
      out.push({
        kind: 'edit',
        words: shared(d, adds[m]!)!.map((w) =>
          w.kind === 'same'
            ? { kind: 'same' as const, text: w.a }
            : w.kind === 'add'
              ? { kind: 'add' as const, text: w.b }
              : { kind: 'del' as const, text: w.a },
        ),
      });
    }
    adds.forEach((a, n) => !used.has(n) && out.push({ kind: 'add', text: a }));
  }
  return out;
}
