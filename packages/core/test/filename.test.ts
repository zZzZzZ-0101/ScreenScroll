import { describe, expect, it } from 'vitest';
import { buildFilename, DEFAULT_FILENAME_TEMPLATE, sanitizeFilename } from '../src/filename.js';

const date = new Date(2026, 9, 26, 22, 41); // local time

describe('buildFilename', () => {
  it('fills the default template', () => {
    expect(
      buildFilename(
        DEFAULT_FILENAME_TEMPLATE,
        { title: 'My Page', url: 'https://www.example.org/a', date },
        'pdf',
      ),
    ).toBe('My Page_2026-10-26_2241.pdf');
  });

  it('keeps Chinese titles', () => {
    expect(
      buildFilename(
        '{title}',
        { title: '如何评价 NJC 答案？', url: 'https://zhihu.com/q/1', date },
        'pdf',
      ),
    ).toBe('如何评价 NJC 答案？.pdf');
  });

  it('falls back to the domain when there is no title', () => {
    expect(
      buildFilename('{title}', { title: '  ', url: 'https://www.example.org/', date }, 'pdf'),
    ).toBe('example.org.pdf');
  });

  it('leaves unknown tokens as typed', () => {
    expect(buildFilename('{nope}-{domain}', { title: 't', url: 'https://a.b/', date }, 'png')).toBe(
      '{nope}-a.b.png',
    );
  });
});

describe('sanitizeFilename', () => {
  it.each([
    ['a<b>c:d"e/f\\g|h?i*j', 'a_b_c_d_e_f_g_h_i_j'],
    ['trailing dots...', 'trailing dots'],
    ['tabs\tand\nnewlines', 'tabs and newlines'],
    ['CON', '_CON'],
    ['lpt1.txt', '_lpt1.txt'],
    ['Console', 'Console'],
    ['', 'capture'],
    ['...', 'capture'],
  ])('%j → %j', (input, out) => {
    expect(sanitizeFilename(input)).toBe(out);
  });

  it('caps at 150 code points without splitting surrogate pairs', () => {
    const long = '😀'.repeat(200);
    const s = sanitizeFilename(long);
    expect(Array.from(s)).toHaveLength(150);
    expect(s).toBe('😀'.repeat(150));
  });
});
