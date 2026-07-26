const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

const platformTriple = () => {
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
};

const keyFinderRoots = () => [
  process.env.NEO_KEYFINDER_ROOT,
  path.resolve(projectRoot, "../neo-keyfinder"),
  path.resolve(projectRoot, "../neo-key-finder/neo-keyfinder"),
].filter(Boolean).map((candidate) => path.resolve(candidate));

const findKeyFinderRoot = () => keyFinderRoots().find((candidate) =>
  fs.existsSync(path.join(candidate, "src-tauri", "binaries"))
);

const stagePackagedResources = () => {
  const keyFinderRoot = findKeyFinderRoot();
  if (!keyFinderRoot) {
    throw new Error([
      "Neo KeyFinder binaries were not found.",
      "Set NEO_KEYFINDER_ROOT or place its checkout in a supported adjacent directory.",
      ...keyFinderRoots().map((candidate) => `  - ${candidate}`),
    ].join(os.EOL));
  }

  const extension = process.platform === "win32" ? ".exe" : "";
  const fileName = `keyfinder-native-${platformTriple()}${extension}`;
  const sourcePath = path.join(keyFinderRoot, "src-tauri", "binaries", fileName);
  const destinationDir = path.join(projectRoot, "build", "keyfinder");
  const destinationPath = path.join(destinationDir, fileName);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Neo KeyFinder did not produce ${sourcePath}`);
  }

  fs.mkdirSync(destinationDir, { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  if (process.platform !== "win32") fs.chmodSync(destinationPath, 0o755);
  if (fs.statSync(destinationPath).size < 1_024) {
    throw new Error(`Staged Neo KeyFinder binary is unexpectedly small: ${destinationPath}`);
  }
  console.log(`Restaged Neo KeyFinder for packaging: ${destinationPath}`);
};

module.exports = async () => {
  stagePackagedResources();
};

if (require.main === module) {
  stagePackagedResources();
}
