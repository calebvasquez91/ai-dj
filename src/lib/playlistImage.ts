// Pure rules for a playlist's picture: which file types are allowed, how big, what the real type of the bytes is (a file's name or declared
// type is not trusted), and how far the browser shrinks a picture before sending it. The server side is lib/playlistImageServer.ts.

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** The largest picture a person may choose (before it is shrunk). */
export const MAX_PICKED_BYTES = 10 * 1024 * 1024;
/** The largest the server accepts: the browser shrinks every picture well under this first. */
export const MAX_STORED_BYTES = 1.5 * 1024 * 1024;
/** The longest side of the stored picture, in pixels. */
export const MAX_IMAGE_SIDE = 800;

export function isImageType(value: unknown): value is ImageType {
  return typeof value === "string" && (IMAGE_TYPES as readonly string[]).includes(value);
}

export function imageExtension(type: ImageType): string {
  return type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
}

/** What the bytes really are, from their first bytes: JPEG, PNG or WebP, or null for anything else (a renamed script, a GIF, an SVG). */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png";
  // "RIFF" + 4 size bytes + "WEBP"
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export type ImageCheck = { ok: true; type: ImageType } | { ok: false; error: string };

/** Whether a chosen file is acceptable, from its declared type and size (the browser checks this before it shrinks the picture). */
export function checkPickedImage(file: { type: string; size: number }): ImageCheck {
  if (!isImageType(file.type)) return { ok: false, error: "Choose a JPG, PNG or WebP picture." };
  if (file.size > MAX_PICKED_BYTES) return { ok: false, error: "That picture is too large. Choose one under 10 MB." };
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  return { ok: true, type: file.type };
}

/** What the server accepts: the real type of the bytes must be an allowed one and match the declared one, within the size limit. */
export function checkStoredImage(bytes: Uint8Array, declaredType: string): ImageCheck {
  if (bytes.length === 0) return { ok: false, error: "That file is empty." };
  if (bytes.length > MAX_STORED_BYTES) return { ok: false, error: "That picture is too large." };
  const real = sniffImageType(bytes);
  if (!real) return { ok: false, error: "That isn't a JPG, PNG or WebP picture." };
  if (isImageType(declaredType) && declaredType !== real) return { ok: false, error: "The file isn't the type it says it is." };
  return { ok: true, type: real };
}

/** The size to draw a picture at: its own size when it already fits, else scaled down so the longer side is `max`, keeping its shape. */
export function targetSize(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
