// Regenerates the PWA app icons in public/icons/ from scratch (no image
// libraries — just a hand-rolled PNG encoder over Node's built-in zlib).
// Re-run with `node scripts/generate-icons.mjs` after changing the design
// or brand colors below.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

// Brand colors, matching src/app/globals.css.
const TEAL = [45, 212, 191];
const PURPLE = [147, 51, 234];
const PINK = [236, 72, 153];
const INK = [33, 21, 49]; // --foreground / --border
const PAPER = [255, 255, 255];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

/** Diagonal three-stop gradient matching the .retro-heading CSS gradient. */
function backgroundColor(u, v) {
  const t = Math.max(0, Math.min(1, (u + v) / 2));
  return t < 0.5 ? lerpColor(TEAL, PURPLE, t * 2) : lerpColor(PURPLE, PINK, (t - 0.5) * 2);
}

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const cornerRadius = size * 0.22; // squircle-ish rounded square, safe for maskable masks
  const discRadius = size * 0.34;
  const labelRadius = size * 0.1;
  const spindleRadius = size * 0.025;
  const grooveWidths = [0.86, 0.7, 0.54].map((f) => discRadius * f);
  const armWidth = size * 0.045;

  function setPixel(x, y, [r, g, b], a = 255) {
    const i = (y * size + x) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  }

  function insideRoundedSquare(x, y) {
    const dx = Math.max(0, Math.abs(x - cx + 0.5) - (cx - cornerRadius));
    const dy = Math.max(0, Math.abs(y - cy + 0.5) - (cy - cornerRadius));
    return dx * dx + dy * dy <= cornerRadius * cornerRadius;
  }

  // Tonearm: a short bar angled in from the top-right toward the disc edge,
  // with a small pivot circle — drawn before the disc so the disc's edge
  // ring reads cleanly on top of it.
  const armPivot = [cx + discRadius * 1.05, cy - discRadius * 1.05];
  const armTip = [cx + discRadius * 0.18, cy - discRadius * 0.28];
  const armDx = armTip[0] - armPivot[0];
  const armDy = armTip[1] - armPivot[1];
  const armLenSq = armDx * armDx + armDy * armDy;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRoundedSquare(x, y)) {
        setPixel(x, y, PAPER, 0);
        continue;
      }
      const u = x / size;
      const v = y / size;
      const bg = backgroundColor(u, v);

      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Tonearm (drawn first, sits "under" the disc's outer ring).
      const px = x - armPivot[0];
      const py = y - armPivot[1];
      const t = Math.max(0, Math.min(1, (px * armDx + py * armDy) / armLenSq));
      const projX = armPivot[0] + t * armDx;
      const projY = armPivot[1] + t * armDy;
      const armDist = Math.hypot(x - projX, y - projY);
      const pivotDist = Math.hypot(x - armPivot[0], y - armPivot[1]);
      if (armDist <= armWidth / 2 || pivotDist <= armWidth * 0.9) {
        setPixel(x, y, INK);
        continue;
      }

      if (dist <= discRadius) {
        if (dist >= discRadius - size * 0.012) {
          setPixel(x, y, INK); // outer edge ring
        } else if (grooveWidths.some((gr) => Math.abs(dist - gr) < size * 0.004)) {
          setPixel(x, y, lerpColor(INK, PAPER, 0.35)); // groove lines
        } else if (dist <= labelRadius) {
          setPixel(x, y, dist <= spindleRadius ? PAPER : bg); // center label
        } else {
          setPixel(x, y, PAPER); // disc body
        }
      } else {
        setPixel(x, y, bg);
      }
    }
  }
  return pixels;
}

function crc32(bytes) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(pixels, size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type: None
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sizes = [
  { size: 192, name: "icon-192.png" },
  { size: 512, name: "icon-512.png" },
  { size: 180, name: "icon-180.png" }, // apple-touch-icon
];

for (const { size, name } of sizes) {
  const pixels = drawIcon(size);
  const png = encodePng(pixels, size);
  writeFileSync(join(outDir, name), png);
  console.log(`wrote ${name} (${png.length} bytes)`);
}
