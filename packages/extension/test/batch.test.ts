import { describe, expect, it } from 'vitest';
import { parseUrls } from '../src/shared/batch';

describe('batch addresses', () => {
  it('one per line or space; adds https://; keeps web and file addresses only; no repeats', () => {
    const { urls, rejected } = parseUrls(
      'https://a.example/x\n  example.org/page  \nhttp://b.example\nhttps://a.example/x\nchrome://settings\njavascript:alert(1)\nfile:///tmp/a.html',
    );
    expect(urls).toEqual([
      'https://a.example/x',
      'https://example.org/page',
      'http://b.example/',
      'file:///tmp/a.html',
    ]);
    expect(rejected).toEqual(['chrome://settings', 'javascript:alert(1)']);
  });
});
