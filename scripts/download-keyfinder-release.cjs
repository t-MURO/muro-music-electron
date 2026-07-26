const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const repository = "t-MURO/neo-keyfinder";
const version = process.env.NEO_KEYFINDER_VERSION || "v0.1.2";

const platformTriple = () => {
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
};

const extension = process.platform === "win32" ? ".exe" : "";
const fileName = `keyfinder-native-${platformTriple()}${extension}`;
const releaseRoot = `https://github.com/${repository}/releases/download/${encodeURIComponent(version)}`;
const checksumManifestPath = path.join(
  __dirname,
  "keyfinder-checksums",
  `${version}.sha256`,
);
const destinationDir = path.join(projectRoot, "build", "keyfinder");
const destination = path.join(destinationDir, fileName);

const headers = {
  "User-Agent": "Muro-Music-release-builder",
  Accept: "application/octet-stream",
};
if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;

const download = async (name) => {
  const response = await fetch(`${releaseRoot}/${encodeURIComponent(name)}`, {
    headers,
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(
      `Could not download Neo KeyFinder ${version}/${name}: HTTP ${response.status}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
};

const sha256 = (contents) =>
  crypto.createHash("sha256").update(contents).digest("hex");

const main = async () => {
  if (!fs.existsSync(checksumManifestPath)) {
    throw new Error(
      `No trusted checksum manifest is pinned for Neo KeyFinder ${version}: ${checksumManifestPath}`,
    );
  }
  const checksumManifest = fs.readFileSync(checksumManifestPath, "utf8");
  const checksumLine = checksumManifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.endsWith(`  ${fileName}`) || line.endsWith(` *${fileName}`));
  if (!checksumLine) {
    throw new Error(`Trusted checksum manifest does not contain ${fileName}`);
  }
  const expectedChecksum = checksumLine.split(/\s+/)[0].toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedChecksum)) {
    throw new Error(`Trusted checksum for ${fileName} is invalid`);
  }

  if (fs.existsSync(destination)) {
    const existingChecksum = sha256(fs.readFileSync(destination));
    if (existingChecksum === expectedChecksum) {
      if (process.platform !== "win32") fs.chmodSync(destination, 0o755);
      console.log(`Using verified Neo KeyFinder ${version}: ${destination}`);
      return;
    }
  }

  const binary = await download(fileName);
  const actualChecksum = sha256(binary);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `Checksum mismatch for ${fileName}: expected ${expectedChecksum}, received ${actualChecksum}`,
    );
  }
  if (binary.length < 1_024) {
    throw new Error(`Downloaded Neo KeyFinder binary is unexpectedly small: ${fileName}`);
  }

  fs.mkdirSync(destinationDir, { recursive: true });
  fs.writeFileSync(destination, binary);
  if (process.platform !== "win32") fs.chmodSync(destination, 0o755);
  console.log(`Downloaded and verified Neo KeyFinder ${version}: ${destination}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
