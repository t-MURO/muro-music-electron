import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(
  root,
  process.argv[2] ?? "assets/branding/muro-music-logo.svg",
);
const iconDirectory = path.join(root, "build", "icons");
const rendererAsset = path.join(root, "src", "assets", "app-logo.png");

// A vector source is rasterized at each target size rather than downscaled from
// one bitmap, so the small icons stay crisp. `density` is what sharp uses to
// decide the SVG's raster resolution, and it is ignored for bitmap sources.
const isVectorSource = path.extname(source).toLowerCase() === ".svg";

const renderPng = (size) =>
  sharp(source, isVectorSource ? { density: Math.max(72, size * 2) } : {})
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toBuffer();

/**
 * Minimal ICNS container.
 *
 * `iconutil` only exists on macOS, so building the container here is what lets
 * the Mac icon be regenerated from Windows or Linux. The format is a magic
 * word, the total length, then one record per size: a four-character type, the
 * record length including its own 8-byte header, and the payload. Every type
 * below accepts a PNG payload.
 */
const ICNS_ENTRIES = [
  ["icp4", 16],
  ["icp5", 32],
  ["ic11", 32],   // 16pt @2x
  ["ic12", 64],   // 32pt @2x
  ["ic07", 128],
  ["ic13", 256],  // 128pt @2x
  ["ic08", 256],
  ["ic14", 512],  // 256pt @2x
  ["ic09", 512],
  ["ic10", 1024], // 512pt @2x
];

const writeIcns = async (destination) => {
  const records = await Promise.all(
    ICNS_ENTRIES.map(async ([type, size]) => {
      const png = await renderPng(size);
      const header = Buffer.alloc(8);
      header.write(type, 0, 4, "ascii");
      header.writeUInt32BE(png.length + 8, 4);
      return Buffer.concat([header, png]);
    }),
  );

  const body = Buffer.concat(records);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(body.length + 8, 4);
  writeFileSync(destination, Buffer.concat([header, body]));
};

const writeIco = async (destination) => {
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(renderPng));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;
  images.forEach((image, index) => {
    const entryOffset = index * 16;
    const size = sizes[index];
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset);
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(image.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    offset += image.length;
  });

  writeFileSync(destination, Buffer.concat([header, directory, ...images]));
};

mkdirSync(iconDirectory, { recursive: true });
mkdirSync(path.dirname(rendererAsset), { recursive: true });

writeFileSync(path.join(iconDirectory, "icon.png"), await renderPng(512));
writeFileSync(rendererAsset, await renderPng(256));
await writeIcns(path.join(iconDirectory, "icon.icns"));
await writeIco(path.join(iconDirectory, "icon.ico"));

console.log(`Generated application icons from ${path.relative(root, source)}`);
