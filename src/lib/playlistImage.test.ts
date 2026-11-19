import { describe, expect, it } from "vitest";
import { checkPickedImage, checkStoredImage, imageExtension, MAX_PICKED_BYTES, MAX_STORED_BYTES, sniffImageType, targetSize } from "./playlistImage";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const webp = new Uint8Array([...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WEBP"), 0]);
const gif = new Uint8Array([...Buffer.from("GIF89a"), 0, 0]);
const svg = new Uint8Array(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"));

describe("sniffImageType", () => {
  it("reads the real type from the first bytes", () => {
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(webp)).toBe("image/webp");
  });
  it("refuses anything else, including a GIF, an SVG and an empty file", () => {
    expect(sniffImageType(gif)).toBeNull();
    expect(sniffImageType(svg)).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("checkPickedImage", () => {
  it("accepts JPG, PNG and WebP within the size", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) expect(checkPickedImage({ type, size: 1000 })).toEqual({ ok: true, type });
  });
  it("refuses other types, an empty file and one that is too large, with a plain message", () => {
    expect(checkPickedImage({ type: "image/gif", size: 10 })).toEqual({ ok: false, error: "Choose a JPG, PNG or WebP picture." });
    expect(checkPickedImage({ type: "image/svg+xml", size: 10 }).ok).toBe(false);
    expect(checkPickedImage({ type: "image/png", size: 0 }).ok).toBe(false);
    expect(checkPickedImage({ type: "image/png", size: MAX_PICKED_BYTES + 1 })).toEqual({ ok: false, error: "That picture is too large. Choose one under 10 MB." });
  });
});

describe("checkStoredImage (the server's check)", () => {
  it("accepts bytes that really are an allowed picture of the declared type", () => {
    expect(checkStoredImage(jpeg, "image/jpeg")).toEqual({ ok: true, type: "image/jpeg" });
    expect(checkStoredImage(webp, "image/webp")).toEqual({ ok: true, type: "image/webp" });
  });
  it("does not trust a declared type: a script called a picture, or a PNG sent as JPEG, is refused", () => {
    expect(checkStoredImage(svg, "image/png").ok).toBe(false);
    expect(checkStoredImage(png, "image/jpeg")).toEqual({ ok: false, error: "The file isn't the type it says it is." });
  });
  it("refuses an empty or oversized file", () => {
    expect(checkStoredImage(new Uint8Array(), "image/png").ok).toBe(false);
    expect(checkStoredImage(new Uint8Array(MAX_STORED_BYTES + 1).fill(0xff), "image/jpeg").ok).toBe(false);
  });
});

describe("targetSize", () => {
  it("leaves a small picture alone and scales a large one so the longer side is 800, keeping its shape", () => {
    expect(targetSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(targetSize(4000, 3000)).toEqual({ width: 800, height: 600 });
    expect(targetSize(3000, 4000)).toEqual({ width: 600, height: 800 });
  });
  it("never gives a zero size", () => {
    expect(targetSize(0, 0)).toEqual({ width: 1, height: 1 });
    expect(targetSize(10000, 1).height).toBe(1);
  });
});

describe("imageExtension", () => {
  it("names the file by its type", () => {
    expect(imageExtension("image/jpeg")).toBe("jpg");
    expect(imageExtension("image/png")).toBe("png");
    expect(imageExtension("image/webp")).toBe("webp");
  });
});
