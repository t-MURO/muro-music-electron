const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const electron = require("electron");

const result = spawnSync(electron, [path.join(__dirname, "renderer-smoke.mjs")], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: "inherit",
});

for (const entry of fs.readdirSync(os.tmpdir())) {
  if (!entry.startsWith("muro-renderer-smoke-")) continue;
  fs.rmSync(path.join(os.tmpdir(), entry), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
