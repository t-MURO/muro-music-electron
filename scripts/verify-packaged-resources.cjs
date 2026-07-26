const fs = require("node:fs");
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

const expectedResources = () => {
  const extension = process.platform === "win32" ? ".exe" : "";
  return [
    path.join("keyfinder", `keyfinder-native-${platformTriple()}${extension}`),
    path.join("fpcalc", `fpcalc${extension}`),
  ];
};

const verifyResourceRoot = (resourceRoot, stage) => {
  const missing = [];
  for (const relativePath of expectedResources()) {
    const filePath = path.join(resourceRoot, relativePath);
    let metadata;
    try {
      metadata = fs.statSync(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        missing.push(relativePath);
        continue;
      }
      throw error;
    }
    if (!metadata.isFile() || metadata.size < 1_024) missing.push(relativePath);
  }
  if (missing.length > 0) {
    throw new Error(
      `${stage} is missing required native resources: ${missing.join(", ")}`,
    );
  }
  console.log(
    `Verified ${stage} native resources: ${expectedResources().join(", ")}`,
  );
};

const verifyPackagedResources = async (context) => {
  const resourceRoot = context.packager.getResourcesDir(context.appOutDir);
  verifyResourceRoot(resourceRoot, "packaged application");
};

module.exports = verifyPackagedResources;

if (require.main === module) {
  verifyResourceRoot(path.join(projectRoot, "build"), "staged build");
}
