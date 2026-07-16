const {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} = require("node:fs");
const { homedir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const keyfinderCandidates = [
  process.env.NEO_KEYFINDER_ROOT,
  path.resolve(projectRoot, "../neo-keyfinder"),
  path.resolve(projectRoot, "../neo-key-finder/neo-keyfinder"),
].filter(Boolean).map((candidate) => path.resolve(candidate));
const keyfinderRoot = keyfinderCandidates.find((candidate) =>
  existsSync(path.join(candidate, "package.json")) &&
  existsSync(path.join(candidate, "scripts", "build-native.mjs"))
);
const release = process.argv.includes("--release");
const commandShell = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";

if (!keyfinderRoot) {
  console.error([
    "Neo KeyFinder was not found.",
    "Set NEO_KEYFINDER_ROOT to its checkout, or place it in one of:",
    ...keyfinderCandidates.map((candidate) => `  - ${candidate}`),
  ].join("\n"));
  process.exit(1);
}

const platformTriple = () => {
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
};

const stageNativeBinary = () => {
  const extension = process.platform === "win32" ? ".exe" : "";
  const filename = `keyfinder-native-${platformTriple()}${extension}`;
  const source = path.join(keyfinderRoot, "src-tauri", "binaries", filename);
  if (!existsSync(source)) {
    console.error(`The KeyFinder build did not produce ${source}`);
    process.exit(1);
  }

  const stagingRoot = path.join(projectRoot, "build", "keyfinder");
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });
  const destination = path.join(stagingRoot, filename);
  copyFileSync(source, destination);
  if (process.platform !== "win32") chmodSync(destination, 0o755);
  console.log(`Staged KeyFinder engine: ${destination}`);
};

const findVcpkgRoot = () => {
  const candidates = [
    process.env.VCPKG_ROOT,
    path.join(homedir(), ".local", "share", "vcpkg-neo-keyfinder"),
    path.join(homedir(), ".local", "share", "vcpkg"),
    path.join(homedir(), "vcpkg"),
    path.join(keyfinderRoot, "native", ".dependencies", "vcpkg"),
  ].filter(Boolean);
  return candidates.find((candidate) =>
    existsSync(path.join(candidate, "scripts", "buildsystems", "vcpkg.cmake"))
  );
};

const runNativeBuild = (env = process.env) => {
  const command = `npm run native:build${release ? " -- --release" : ""}`;
  const result = process.platform === "win32"
    ? spawnSync(commandShell, ["/d", "/c", command], {
        cwd: keyfinderRoot,
        env,
        stdio: "inherit",
        windowsVerbatimArguments: true,
      })
    : spawnSync("npm", ["run", "native:build", ...(release ? ["--", "--release"] : [])], {
        cwd: keyfinderRoot,
        env,
        stdio: "inherit",
      });
  if (result.error) console.error(`Could not start KeyFinder build: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
  stageNativeBinary();
};

if (process.platform !== "win32") {
  const env = { ...process.env };
  if (release && !env.VCPKG_ROOT) {
    const vcpkgRoot = findVcpkgRoot();
    if (vcpkgRoot) env.VCPKG_ROOT = vcpkgRoot;
  }
  runNativeBuild(env);
  process.exit(0);
}

const programFiles = process.env.ProgramFiles || "C:\\Program Files";
const vcvars = ["Community", "BuildTools", "Professional", "Enterprise"]
  .map((edition) => path.join(
    programFiles,
    "Microsoft Visual Studio",
    "2022",
    edition,
    "VC",
    "Auxiliary",
    "Build",
    "vcvars64.bat",
  ))
  .find(existsSync);

if (!vcvars) {
  console.error("Visual Studio 2022 with Desktop development with C++ is required.");
  process.exit(1);
}

const initialized = spawnSync(
  commandShell,
  ["/d", "/c", `call "${vcvars}" >nul && set`],
  { cwd: keyfinderRoot, encoding: "utf8", windowsVerbatimArguments: true },
);
if (initialized.status !== 0) {
  process.stderr.write(initialized.stderr || "Could not initialize Visual Studio.\n");
  process.exit(initialized.status || 1);
}

const env = {};
for (const line of initialized.stdout.split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator > 0) env[line.slice(0, separator)] = line.slice(separator + 1);
}

const portableSdkRoot = path.join(
  keyfinderRoot,
  "native",
  ".dependencies",
  "windows-sdk",
  "microsoft.windows.sdk.cpp",
  "c",
);
const portableSdkLibRoot = path.join(
  keyfinderRoot,
  "native",
  ".dependencies",
  "windows-sdk",
  "microsoft.windows.sdk.cpp.x64",
  "c",
);
const sdkVersions = existsSync(path.join(portableSdkRoot, "Include"))
  ? readdirSync(path.join(portableSdkRoot, "Include"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  : [];
const sdkVersion = sdkVersions[0];

if (sdkVersion) {
  const sdkBin = path.join(portableSdkRoot, "bin", sdkVersion, "x64");
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
  const currentPath = pathKey ? env[pathKey] : process.env.PATH;
  if (pathKey) delete env[pathKey];
  env.PATH = [sdkBin, path.join(sdkBin, "ucrt"), currentPath]
    .filter(Boolean)
    .join(";");
  env.INCLUDE = ["ucrt", "shared", "um", "winrt", "cppwinrt"]
    .map((folder) => path.join(portableSdkRoot, "Include", sdkVersion, folder))
    .concat(env.INCLUDE || "")
    .filter(Boolean)
    .join(";");
  env.LIB = [
    path.join(portableSdkLibRoot, "ucrt", "x64"),
    path.join(portableSdkLibRoot, "um", "x64"),
    env.LIB || "",
  ].filter(Boolean).join(";");
  env.WindowsSdkDir = `${portableSdkRoot}\\`;
  env.WindowsSDKVersion = `${sdkVersion}\\`;
  env.UniversalCRTSdkDir = `${portableSdkRoot}\\`;
  env.UCRTVersion = sdkVersion;
}

const ninjaToolsRoot = path.join(
  keyfinderRoot,
  "native",
  ".dependencies",
  "vcpkg",
  "downloads",
  "tools",
);
const ninjaDirectory = existsSync(ninjaToolsRoot)
  ? readdirSync(ninjaToolsRoot, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.startsWith("ninja-"))
  : undefined;
const ninjaPath = ninjaDirectory
  ? path.join(ninjaToolsRoot, ninjaDirectory.name, "ninja.exe")
  : undefined;

if (ninjaPath && existsSync(ninjaPath)) {
  env.CMAKE_GENERATOR = "Ninja";
  const localBin = path.join(keyfinderRoot, "native", ".dependencies", "local-bin");
  env.PATH = [path.dirname(ninjaPath), existsSync(localBin) ? localBin : undefined, env.PATH]
    .filter(Boolean)
    .join(";");
  if (!release) {
    const debugBuildRoot = path.join(keyfinderRoot, "native", "build");
    const cachePath = path.join(debugBuildRoot, "CMakeCache.txt");
    if (existsSync(cachePath) && !readFileSync(cachePath, "utf8").includes("CMAKE_GENERATOR:INTERNAL=Ninja")) {
      rmSync(cachePath, { force: true });
      rmSync(path.join(debugBuildRoot, "CMakeFiles"), { recursive: true, force: true });
    }
  }
}

const localVcpkg = path.join(keyfinderRoot, "native", ".dependencies", "vcpkg");
const vcpkgRoot = process.env.VCPKG_ROOT || localVcpkg;
env.RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-msvc";
if (existsSync(path.join(vcpkgRoot, "vcpkg.exe"))) {
  env.VCPKG_ROOT = vcpkgRoot;
  env.VCPKG_TARGET_TRIPLET = "x64-windows-static";
  env._CL_ = "/DNOMINMAX";
  env.PYTHONUTF8 = "1";
} else if (release) {
    console.error("A bootstrapped vcpkg clone is required for release builds.");
    process.exit(1);
}

runNativeBuild(env);
