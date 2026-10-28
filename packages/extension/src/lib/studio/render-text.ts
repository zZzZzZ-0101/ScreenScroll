import type { TextRenderer } from '@scrollpress/core/pdf';

/** Fonts that cover most scripts on Windows, macOS and Linux desktops. */
const FONT_STACK =
  'system-ui, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", "Noto Sans", sans-serif';
const SCALE = 4; // px per pt: crisp when zoomed in

/** Renders header/footer text with the browser's own fonts (any script) for the PDF. */
export const renderBandText: TextRenderer = async (text, sizePt) => {
  const font = `${sizePt * SCALE}px ${FONT_STACK}`;
  const probe = new OffscreenCanvas(1, 1).getContext('2d')!;
  probe.font = font;
  const width = Math.ceil(probe.measureText(text).width) + 2;
  const height = Math.ceil(sizePt * SCALE * 1.25);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.fillStyle = '#737373';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 1, height * 0.8);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return {
    png: new Uint8Array(await blob.arrayBuffer()),
    widthPt: width / SCALE,
    heightPt: height / SCALE,
  };
};
