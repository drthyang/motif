// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/** Rasterise the figure's SVG text to a PNG, in the browser. The PNG is made from the same SVG that is shown and exported. */

/** Most browsers refuse canvases above roughly this many pixels per side. */
export const MAX_PNG_SIDE = 16000;

/**
 * The PNG is `pixelWidth` wide and, if `pixelHeight` is not given, as high as the SVG's shape (its viewBox)
 * makes it. With `dpi` the file records that resolution (a pHYs chunk), so that programs which read it
 * place the image at its size on paper.
 */
export async function svgToPng(svg: string, pixelWidth: number, pixelHeight?: number, dpi?: number): Promise<Blob> {
  const size = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!size) throw new Error("The SVG has no size.");
  const width = Math.round(pixelWidth);
  const height = Math.round(pixelHeight ?? (pixelWidth * Number(size[2])) / Number(size[1]));
  if (!(width >= 1) || width > MAX_PNG_SIDE || height > MAX_PNG_SIDE) {
    throw new Error(`The PNG must be between 1 and ${MAX_PNG_SIDE} px on each side.`);
  }
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The browser could not draw the SVG."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser gave no drawing surface for the PNG.");
    context.drawImage(image, 0, 0, width, height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the PNG."))), "image/png");
    });
    return dpi ? new Blob([withResolution(new Uint8Array(await png.arrayBuffer()), dpi)], { type: "image/png" }) : png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The PNG with a pHYs chunk stating `dpi` (as pixels per metre), put right after the header chunk. The
 * browser's own encoder writes none; an existing one is replaced.
 */
export function withResolution(png: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Uint8Array[] = [png.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (type !== "pHYs") chunks.push(png.subarray(at, end));
    if (type === "IHDR") chunks.push(physChunk(dpi));
    at = end;
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let k = 0;
  for (const c of chunks) {
    out.set(c, k);
    k += c.length;
  }
  return out;
}

function physChunk(dpi: number): Uint8Array {
  const perMetre = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  chunk[16] = 1; // unit: metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** The CRC-32 of the PNG specification. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
