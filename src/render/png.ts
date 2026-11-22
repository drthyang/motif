/** Rasterise the figure's SVG text to a PNG, in the browser. The PNG is made from the same SVG that is shown and exported. */

/** Most browsers refuse canvases above roughly this many pixels per side. */
export const MAX_PNG_SIDE = 16000;

export async function svgToPng(svg: string, pixelWidth: number): Promise<Blob> {
  const size = /width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  if (!size) throw new Error("The SVG has no size.");
  const width = Math.round(pixelWidth);
  const height = Math.round((pixelWidth * Number(size[2])) / Number(size[1]));
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
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the PNG."))), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
