const { spawnSync } = require("node:child_process");
const path = require("node:path");
const electron = require("electron");

const result = spawnSync(electron, [path.join(__dirname, "backend-smoke.mjs")], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
