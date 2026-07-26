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
  const extension = process.platform === "win32" ? ".exe" : "";
  const fileName = `keyfinder-native-${platformTriple()}${extension}`;
  const destinationDir = path.join(projectRoot, "build", "keyfinder");
  const destinationPath = path.join(destinationDir, fileName);
  const keyFinderRoot = findKeyFinderRoot();
  const sourcePath = keyFinderRoot
    ? path.join(keyFinderRoot, "src-tauri", "binaries", fileName)
    : undefined;
  const hasStagedRelease =
    Boolean(process.env.NEO_KEYFINDER_VERSION) &&
    fs.existsSync(destinationPath) &&
    fs.statSync(destinationPath).isFile();

  if (hasStagedRelease) {
    console.log(`Using staged Neo KeyFinder release for packaging: ${destinationPath}`);
  } else if (sourcePath && fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()) {
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    console.log(`Restaged Neo KeyFinder for packaging: ${destinationPath}`);
  } else if (!fs.existsSync(destinationPath) || !fs.statSync(destinationPath).isFile()) {
    throw new Error([
      "Neo KeyFinder binaries were not found.",
      "Run npm run keyfinder:download, set NEO_KEYFINDER_ROOT, or place its checkout in a supported adjacent directory.",
      ...keyFinderRoots().map((candidate) => `  - ${candidate}`),
    ].join(os.EOL));
  } else {
    console.log(`Using staged Neo KeyFinder for packaging: ${destinationPath}`);
  }

  if (process.platform !== "win32") fs.chmodSync(destinationPath, 0o755);
  if (fs.statSync(destinationPath).size < 1_024) {
    throw new Error(`Staged Neo KeyFinder binary is unexpectedly small: ${destinationPath}`);
  }
};

module.exports = async () => {
  stagePackagedResources();
};

if (require.main === module) {
  stagePackagedResources();
}
