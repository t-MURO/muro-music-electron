const { spawnSync } = require("node:child_process");
const path = require("node:path");
const electron = require("electron");

const result = spawnSync(electron, [path.join(__dirname, "renderer-smoke.mjs")], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
