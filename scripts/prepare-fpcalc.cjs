const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const VERSION = "1.6.0";
const RELEASE_ROOT = `https://github.com/acoustid/chromaprint/releases/download/v${VERSION}`;
const ASSETS = {
  "win32-x64": {
    name: `chromaprint-fpcalc-${VERSION}-windows-x86_64.zip`,
    sha256: "30179d3d0dc4cc92f1a0995c1a2e523fb4867724c2ee6a6ceae474f8e4d6937a",
  },
  "darwin-x64": {
    name: `chromaprint-fpcalc-${VERSION}-macos-x86_64.tar.gz`,
    sha256: "5898f2442220f4d82920b9eb11c35fc30d379b1ce9cb8b9f869f3365d2236e99",
  },
  "darwin-arm64": {
    name: `chromaprint-fpcalc-${VERSION}-macos-arm64.tar.gz`,
    sha256: "2c6c837f57ab5ad330710dc296af4de62a51d3c14aa2309fe1afce2ab699bd35",
  },
  "linux-x64": {
    name: `chromaprint-fpcalc-${VERSION}-linux-x86_64.tar.gz`,
    sha256: "946dc3eade645eb835c8d163c6bb354e092239988bff190b9c42589e8d5cf00a",
  },
  "linux-arm64": {
    name: `chromaprint-fpcalc-${VERSION}-linux-arm64.tar.gz`,
    sha256: "c8667f556f77d8ebbe08b75a968c0592bd2a67aaa696eff91715feb5083b1cd4",
  },
};

const projectRoot = path.resolve(__dirname, "..");
const stagingRoot = path.join(projectRoot, "build", "fpcalc");
const executableName = process.platform === "win32" ? "fpcalc.exe" : "fpcalc";
const destination = path.join(stagingRoot, executableName);
const versionFile = path.join(stagingRoot, ".version");
const asset = ASSETS[`${process.platform}-${process.arch}`];

const findFile = (root, name) => {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(candidate, name);
      if (nested) return nested;
    } else if (entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()) {
      return candidate;
    }
  }
  return null;
};

const main = async () => {
  if (!asset) {
    throw new Error(`AcoustID fingerprinting is not available for ${process.platform}-${process.arch}`);
  }
  if (
    fs.existsSync(destination)
    && fs.existsSync(versionFile)
    && fs.readFileSync(versionFile, "utf8").trim() === VERSION
  ) {
    console.log(`Chromaprint fpcalc ${VERSION} is already staged.`);
    return;
  }

  const temporaryRoot = path.join(stagingRoot, ".download");
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const archivePath = path.join(temporaryRoot, asset.name);
  console.log(`Downloading Chromaprint ${VERSION} for ${process.platform}-${process.arch}...`);
  const response = await fetch(`${RELEASE_ROOT}/${asset.name}`, {
    headers: { "User-Agent": "MuroMusicElectron/0.1.0" },
  });
  if (!response.ok) throw new Error(`Chromaprint download failed (${response.status})`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actualHash = crypto.createHash("sha256").update(archive).digest("hex");
  if (actualHash !== asset.sha256) throw new Error("Chromaprint download checksum mismatch");
  fs.writeFileSync(archivePath, archive);

  const extractRoot = path.join(temporaryRoot, "extracted");
  fs.mkdirSync(extractRoot, { recursive: true });
  const extracted = spawnSync("tar", ["-xf", archivePath, "-C", extractRoot], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (extracted.error || extracted.status !== 0) {
    throw extracted.error ?? new Error(`Could not extract ${asset.name}`);
  }
  const source = findFile(extractRoot, executableName);
  if (!source) throw new Error(`${executableName} was not found in the Chromaprint archive`);
  fs.copyFileSync(source, destination);
  if (process.platform !== "win32") fs.chmodSync(destination, 0o755);
  fs.writeFileSync(versionFile, `${VERSION}\n`, "utf8");
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  console.log(`Staged Chromaprint fpcalc: ${destination}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
