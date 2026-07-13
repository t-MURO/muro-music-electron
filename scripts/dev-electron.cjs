const { spawn } = require("node:child_process");
const path = require("node:path");
const electron = require("electron");

const projectRoot = path.resolve(__dirname, "..");
const host = process.env.MURO_DEV_HOST || "127.0.0.1";
const port = Number(process.env.MURO_DEV_PORT || 5173);
const devUrl = `http://${host}:${port}`;

let rendererProcess = null;
let electronProcess = null;
let shuttingDown = false;

const stopProcess = (child) => {
  if (child && child.exitCode === null && !child.killed) child.kill();
};

const shutdown = (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopProcess(electronProcess);
  stopProcess(rendererProcess);
  process.exitCode = exitCode;
};

const isReachable = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch {
    return false;
  }
};

const waitForRenderer = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (rendererProcess?.exitCode !== null) {
      throw new Error(`Renderer exited before it became ready (code ${rendererProcess.exitCode})`);
    }
    if (await isReachable(devUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Renderer did not become ready at ${devUrl} within 30 seconds`);
};

const startRenderer = () => {
  const viteEntry = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  rendererProcess = spawn(
    process.execPath,
    [viteEntry, "--host", host, "--port", String(port), "--strictPort"],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    }
  );
  rendererProcess.on("error", (error) => {
    console.error("Failed to start the renderer:", error);
    shutdown(1);
  });
  rendererProcess.on("exit", (code) => {
    if (!shuttingDown && electronProcess) {
      console.error(`Renderer exited unexpectedly (code ${code ?? 1})`);
      shutdown(code ?? 1);
    }
  });
};

const startElectron = () => {
  electronProcess = spawn(electron, ["."], {
    cwd: projectRoot,
    env: { ...process.env, MURO_DEV_URL: devUrl },
    stdio: "inherit",
  });
  electronProcess.on("error", (error) => {
    console.error("Failed to start Electron:", error);
    shutdown(1);
  });
  electronProcess.on("exit", (code) => shutdown(code ?? 1));
};

const run = async () => {
  if (await isReachable(devUrl)) {
    console.log(`Using the existing renderer at ${devUrl}`);
  } else {
    startRenderer();
    await waitForRenderer();
    console.log(`Renderer ready at ${devUrl}`);
  }
  startElectron();
};

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
process.on("exit", () => {
  stopProcess(electronProcess);
  stopProcess(rendererProcess);
});

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});
