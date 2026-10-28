import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/lib/settings';

describe('stored settings', () => {
  it.each([undefined, null, 'garbage', 42, [], [1, 2], {}])('%j falls back to defaults', (v) => {
    expect(normalizeSettings(v)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and drops broken ones one by one', () => {
    const s = normalizeSettings({
      page: {
        paper: 'Letter',
        orientation: 'sideways',
        marginsMm: { top: -5, right: 20, bottom: 'x', left: 1e9 },
      },
      crop: 'off',
      breakStyle: 7,
      imageMode: 'gif',
      filenameTemplate: 12,
      afterCapture: 'pdf',
      pdf: {
        textLayer: 'yes',
        links: false,
        header: { left: '{title}', center: 3 },
        footer: 'nope',
      },
    });
    expect(s.page.paper).toBe('Letter');
    expect(s.page.orientation).toBe('portrait');
    expect(s.page.marginsMm).toEqual({ top: 10, right: 20, bottom: 10, left: 10 });
    expect(s.crop).toBe('off');
    expect(s.breakStyle).toBe(1);
    expect(s.imageMode).toBe('auto');
    expect(s.filenameTemplate).toBe(DEFAULT_SETTINGS.filenameTemplate);
    expect(s.afterCapture).toBe('pdf');
    expect(s.pdf.textLayer).toBe(true);
    expect(s.pdf.links).toBe(false);
    expect(s.pdf.header).toEqual({ left: '{title}', center: '', right: '' });
    expect(s.pdf.footer).toEqual(DEFAULT_SETTINGS.pdf.footer);
  });

  it('rejects unknown papers and NaN', () => {
    expect(normalizeSettings({ page: { paper: 'A99' } }).page.paper).toBe('A4');
    expect(normalizeSettings({ page: { paper: { w: 0, h: 5 } } }).page.paper).toBe('A4');
    expect(normalizeSettings({ page: { paper: { w: 200, h: 300 } } }).page.paper).toEqual({
      w: 200,
      h: 300,
    });
    expect(normalizeSettings({ breakStyle: Number.NaN }).breakStyle).toBe(0.5);
  });

  it('is idempotent', () => {
    const once = normalizeSettings({ crop: 'off', pdf: { outline: false } });
    expect(normalizeSettings(once)).toEqual(once);
  });
});
