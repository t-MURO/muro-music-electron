const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const electron = require("electron");

const appRoot = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const port = Number(process.env.MURO_RENDERER_DEV_SMOKE_PORT || 5187);
const devUrl = `http://${host}:${port}`;
const viteEntry = path.join(appRoot, "node_modules", "vite", "bin", "vite.js");
let viteProcess;

const cleanupTemporaryDirectories = () => {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (!entry.startsWith("muro-renderer-smoke-")) continue;
    fs.rmSync(path.join(os.tmpdir(), entry), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
};

const waitForRenderer = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (viteProcess.exitCode !== null) {
      throw new Error(`Vite exited before the dev renderer became ready (${viteProcess.exitCode})`);
    }
    try {
      const response = await fetch(devUrl, { signal: AbortSignal.timeout(750) });
      if (response.ok) return;
    } catch {
      // Keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Dev renderer did not become ready at ${devUrl}`);
};

const run = async () => {
  viteProcess = spawn(
    process.execPath,
    [viteEntry, "--host", host, "--port", String(port), "--strictPort"],
    { cwd: appRoot, env: process.env, stdio: "inherit" },
  );
  await waitForRenderer();

  const result = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(__dirname, "renderer-smoke.mjs")], {
      cwd: appRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        MURO_RENDERER_SMOKE_URL: devUrl,
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = result;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (viteProcess && viteProcess.exitCode === null) viteProcess.kill();
  cleanupTemporaryDirectories();
});
