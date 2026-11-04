import { describe, expect, it } from 'vitest';
import { diffSeq, diffText } from '../src/diff.js';

describe('what changed between two captures', () => {
  it('sequence diff: kept, added, removed, in order', () => {
    const ops = diffSeq(['a', 'b', 'c', 'd'], ['a', 'c', 'x', 'd']);
    expect(ops.map((o) => `${o.kind}:${o.kind === 'add' ? o.b : o.a}`)).toEqual([
      'same:a',
      'del:b',
      'same:c',
      'add:x',
      'same:d',
    ]);
  });
  it('paragraphs added and removed; an edited paragraph shows its words', () => {
    const before = 'Title\n\nPrice is 10 dollars today.\n\nOld note.\n\nEnd.';
    const after = 'Title\n\nPrice is 12 dollars today.\n\nEnd.\n\nNew footer.';
    const d = diffText(before, after);
    expect(d[0]).toEqual({ kind: 'same', text: 'Title' });
    expect(d[1]).toEqual({
      kind: 'edit',
      words: [
        { kind: 'same', text: 'Price' },
        { kind: 'same', text: 'is' },
        { kind: 'del', text: '10' },
        { kind: 'add', text: '12' },
        { kind: 'same', text: 'dollars' },
        { kind: 'same', text: 'today.' },
      ],
    });
    expect(d.slice(2)).toEqual([
      { kind: 'del', text: 'Old note.' },
      { kind: 'same', text: 'End.' },
      { kind: 'add', text: 'New footer.' },
    ]);
  });
  it('identical texts: nothing but kept paragraphs', () => {
    expect(diffText('A\n\nB', 'A\n\nB').every((c) => c.kind === 'same')).toBe(true);
  });
});
