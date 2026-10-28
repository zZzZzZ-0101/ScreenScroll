import { describe, expect, it } from 'vitest';
import { isPlaceholderSrc } from '../src/lazy.js';

describe('isPlaceholderSrc', () => {
  it.each([
    '',
    null,
    undefined,
    '#',
    'about:blank',
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    '/static/img/blank.gif',
    'https://cdn.example.org/assets/placeholder.png?v=2',
    '/img/lazy-loading.svg',
    'spacer.gif',
  ])('treats %s as a placeholder', (src) => {
    expect(isPlaceholderSrc(src)).toBe(true);
  });

  it.each([
    'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg',
    '/images/photo-1234.jpg',
    '/img/lazyriver-trip.jpg',
    `data:image/png;base64,${'A'.repeat(600)}`,
  ])('keeps real image %s', (src) => {
    expect(isPlaceholderSrc(src)).toBe(false);
  });
});
