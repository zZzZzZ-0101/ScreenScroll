/**
 * PDF_OUTPUT §1 auto format: photos compress far better as JPEG, while text and UI stay
 * crisp and small as PNG. Counts distinct colours (4 bits per channel) on a sample.
 */
export function chooseImageFormat(
  rgba: Uint8Array | Uint8ClampedArray,
  maxSamples = 20_000,
): 'png' | 'jpeg' {
  const pixels = rgba.length >> 2;
  const step = Math.max(1, Math.floor(pixels / maxSamples));
  const seen = new Set<number>();
  for (let i = 0; i < pixels; i += step) {
    const j = i << 2;
    seen.add(((rgba[j]! >> 4) << 8) | ((rgba[j + 1]! >> 4) << 4) | (rgba[j + 2]! >> 4));
  }
  // Text, UI and flat graphics use a few hundred buckets at most; photos fill thousands.
  return seen.size > 1200 ? 'jpeg' : 'png';
}
