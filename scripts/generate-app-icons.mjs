import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(
  root,
  process.argv[2] ?? "assets/branding/muro-music-logo.png",
);
const iconDirectory = path.join(root, "build", "icons");
const rendererAsset = path.join(root, "src", "assets", "app-logo.png");
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "muro-icons-"));
const iconsetDirectory = path.join(temporaryDirectory, "MuroMusic.iconset");

const renderPng = (size) =>
  sharp(source)
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toBuffer();

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
mkdirSync(iconsetDirectory, { recursive: true });

try {
  writeFileSync(path.join(iconDirectory, "icon.png"), await renderPng(512));
  writeFileSync(rendererAsset, await renderPng(256));

  const iconsetSizes = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];
  await Promise.all(iconsetSizes.map(async ([name, size]) => {
    writeFileSync(path.join(iconsetDirectory, name), await renderPng(size));
  }));

  if (process.platform === "darwin") {
    execFileSync("iconutil", [
      "--convert",
      "icns",
      iconsetDirectory,
      "--output",
      path.join(iconDirectory, "icon.icns"),
    ]);
  }
  await writeIco(path.join(iconDirectory, "icon.ico"));
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Generated application icons from ${path.relative(root, source)}`);
