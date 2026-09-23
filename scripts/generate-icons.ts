/**
 * scripts/generate-icons.ts
 * Pure TypeScript PNG generator using Node's native zlib and fs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

interface DrawPixelFunc {
  (x: number, y: number, width: number, height: number): [number, number, number, number];
}

function createPng(width: number, height: number, draw: DrawPixelFunc): Buffer {
  const rowSize = width * 4 + 1; // 1 filter byte + RGBA pixels
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type 0 (None)

    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = draw(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 4;
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      const byte = buf[i]!;
      crc ^= byte;
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeChunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);

    const crcPayload = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcPayload), 0);

    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  // PNG Header
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth: 8
  ihdrData[9] = 6; // Color type: RGBA (6)
  ihdrData[10] = 0; // Compression method
  ihdrData[11] = 0; // Filter method
  ihdrData[12] = 0; // Interlace method
  const ihdr = writeChunk('IHDR', ihdrData);

  // IDAT (Deflate compressed)
  const compressed = zlib.deflateSync(rawData);
  const idat = writeChunk('IDAT', compressed);

  // IEND
  const iend = writeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdr, idat, iend]);
}

function drawIconPixel(x: number, y: number, w: number, h: number): [number, number, number, number] {
  // Normalize coords from -1 to 1
  const nx = (x / (w - 1)) * 2 - 1;
  const ny = (y / (h - 1)) * 2 - 1;

  // Rounded rectangle container with primary blue #2563eb (37, 99, 235)
  const cornerRadius = 0.35;
  const dx = Math.max(0, Math.abs(nx) - (1 - cornerRadius));
  const dy = Math.max(0, Math.abs(ny) - (1 - cornerRadius));
  const d = Math.sqrt(dx * dx + dy * dy);

  if (d > cornerRadius) {
    return [0, 0, 0, 0]; // Transparent outside rounded corner
  }

  // Draw Microphone Glyph in crisp white (255, 255, 255)
  let inMic = false;

  // Microphone capsule body
  if (Math.abs(nx) <= 0.22) {
    if (ny >= -0.35 && ny <= 0.05) {
      inMic = true;
    } else if (ny < -0.35) {
      const topCap = Math.sqrt(nx * nx + (ny - -0.35) * (ny - -0.35));
      if (topCap <= 0.22) inMic = true;
    } else if (ny > 0.05) {
      const bottomCap = Math.sqrt(nx * nx + (ny - 0.05) * (ny - 0.05));
      if (bottomCap <= 0.22) inMic = true;
    }
  }

  // Arc cup around capsule
  const cupDist = Math.sqrt(nx * nx + ny * ny);
  if (cupDist >= 0.30 && cupDist <= 0.42 && ny >= -0.05 && ny <= 0.35) {
    inMic = true;
  }

  // Stem
  if (Math.abs(nx) <= 0.07 && ny >= 0.35 && ny <= 0.60) {
    inMic = true;
  }

  // Base
  if (Math.abs(nx) <= 0.30 && ny >= 0.55 && ny <= 0.65) {
    inMic = true;
  }

  if (inMic) {
    return [255, 255, 255, 255];
  }

  // Accessible Pilot Navy/Blue: #2563eb
  return [37, 99, 235, 255];
}

// Generate icons in public/icons
const targetDir = path.resolve('public', 'icons');
fs.mkdirSync(targetDir, { recursive: true });

const sizes = [16, 48, 128];
for (const size of sizes) {
  const pngBuffer = createPng(size, size, drawIconPixel);
  const filePath = path.join(targetDir, `icon${size}.png`);
  fs.writeFileSync(filePath, pngBuffer);
  console.log(`Generated ${filePath} (${pngBuffer.length} bytes) in pure TypeScript.`);
}
