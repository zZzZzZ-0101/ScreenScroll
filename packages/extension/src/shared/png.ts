/** Decodes a `data:` URL to a Blob without fetch() (the offline guard bans it). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'application/octet-stream';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Width/height from a PNG's IHDR chunk, so the service worker never decodes images. */
export async function pngSize(blob: Blob): Promise<{ width: number; height: number }> {
  const head = new DataView(await blob.slice(0, 24).arrayBuffer());
  return { width: head.getUint32(16), height: head.getUint32(20) };
}
