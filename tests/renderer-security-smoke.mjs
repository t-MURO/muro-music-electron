import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createTrustedRendererUrlCheck } from "../electron/rendererSecurity.mjs";

const productionPath = path.resolve("/Applications/Muro/dist/index.html");
const productionCheck = createTrustedRendererUrlCheck({
  productionRendererPath: productionPath,
});
assert.equal(productionCheck(pathToFileURL(productionPath).toString()), true);
assert.equal(productionCheck(`${pathToFileURL(productionPath)}#/settings`), true);
assert.equal(
  productionCheck(pathToFileURL(path.resolve(productionPath, "../other.html")).toString()),
  false,
);
assert.equal(productionCheck("https://example.com"), false);
assert.equal(productionCheck("not a URL"), false);

const developmentCheck = createTrustedRendererUrlCheck({
  developmentUrl: "http://localhost:5173/",
  productionRendererPath: productionPath,
});
assert.equal(developmentCheck("http://localhost:5173/#/settings"), true);
assert.equal(developmentCheck("http://localhost:5173/another-path"), true);
assert.equal(developmentCheck("http://127.0.0.1:5173/"), false);
assert.equal(developmentCheck("https://localhost:5173/"), false);

console.log("Renderer security smoke test passed.");
