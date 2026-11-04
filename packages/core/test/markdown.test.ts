import { describe, expect, it } from 'vitest';
import { textToMarkdown } from '../src/markdown.js';
import type { TextRun } from '../src/hints.js';

const run = (text: string, x: number, y: number, h = 16, order?: number): TextRun => ({
  text,
  rect: { x, y, width: text.length * 8, height: h },
  fontSizePx: h,
  ...(order === undefined ? {} : { order }),
});

describe('text as Markdown', () => {
  it('headings, paragraphs at a gap, lines joined, bullets as list items', () => {
    let o = 0;
    const md = textToMarkdown(
      [
        run('Annual report', 10, 10, 28, o++),
        run('The first line of a paragraph', 10, 60, 16, o++),
        run('goes on here.', 10, 80, 16, o++),
        run('A second paragraph.', 10, 130, 16, o++),
        run('• one item', 10, 170, 16, o++),
        run('• another', 10, 190, 16, o++),
        run('# not a heading', 10, 240, 16, o),
      ],
      [{ level: 1, text: 'Annual report', y: 10 }],
    );
    expect(md).toBe(
      [
        '# Annual report',
        'The first line of a paragraph goes on here.',
        'A second paragraph.',
        '- one item',
        '- another',
        '\\# not a heading',
      ].join('\n\n') + '\n',
    );
  });
  it('recognised text (no DOM order) goes by position; Chinese joins without spaces', () => {
    const md = textToMarkdown([run('第二行', 10, 40), run('标题', 10, 10), run('继续', 60, 40)]);
    expect(md).toBe('标题\n\n第二行继续\n');
  });
  it('document pages are separated by a rule', () => {
    const md = textToMarkdown(
      [run('Page one text', 10, 50, 16, 0), run('Page two text', 10, 1050, 16, 1)],
      [],
      [
        { y0: 0, y1: 1000 },
        { y0: 1000, y1: 2000 },
      ],
    );
    expect(md).toBe('Page one text\n\n---\n\nPage two text\n');
  });
  it('a link and the full stop after it join; words with a space between keep it', () => {
    const md = textToMarkdown([
      { text: 'See ', rect: { x: 0, y: 0, width: 32, height: 16 }, fontSizePx: 16, order: 0 },
      {
        text: 'the reference',
        rect: { x: 32, y: 0, width: 100, height: 16 },
        fontSizePx: 16,
        order: 1,
      },
      { text: '.', rect: { x: 132, y: 0, width: 4, height: 16 }, fontSizePx: 16, order: 2 },
    ]);
    expect(md).toBe('See the reference.\n');
  });
});
