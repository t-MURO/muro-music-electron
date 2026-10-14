import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AUTOMATIC_CHECK_MIN_INTERVAL_MS,
  RELEASES_API_URL,
  RELEASES_PAGE_URL,
  UPDATE_STATUS_EVENT,
  compareVersions,
  createUpdateService,
  downloadAsset,
  fetchLatestRelease,
  integrityError,
  isAllowedDownloadUrl,
  isAllowedReleasePageUrl,
  isNewerVersion,
  parseSha256Digest,
  parseVersion,
  selectInstallerAsset,
  selectLatestRelease,
} from "../electron/updateCheck.mjs";

// Everything here runs against mocked fetch responses; no request leaves the machine.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "muro-update-check-"));
const DOWNLOAD_BASE = "https://github.com/t-MURO/muro-music-electron/releases/download";
const PAGE_BASE = "https://github.com/t-MURO/muro-music-electron/releases/tag";
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const rawAsset = (tag, name, overrides = {}) => ({
  name,
  size: 1000,
  digest: `sha256:${"0".repeat(64)}`,
  state: "uploaded",
  browser_download_url: `${DOWNLOAD_BASE}/${tag}/${name}`,
  ...overrides,
});

const rawRelease = (tag, overrides = {}) => ({
  tag_name: tag,
  name: tag,
  draft: false,
  prerelease: true,
  published_at: "2026-08-06T05:53:18Z",
  html_url: `${PAGE_BASE}/${tag}`,
  assets: [],
  ...overrides,
});

// The asset list of the published v0.1.10 release.
const v0110Assets = [
  "latest-mac.yml",
  "latest.yml",
  "Muro-Music-0.1.10-arm64.dmg",
  "Muro-Music-0.1.10-arm64.dmg.blockmap",
  "Muro-Music-Setup-0.1.10.exe",
  "Muro-Music-Setup-0.1.10.exe.blockmap",
].map((name) => ({ name, size: 1000, digest: null, url: `${DOWNLOAD_BASE}/v0.1.10/${name}` }));

// --- Versions -------------------------------------------------------------------
{
  assert.deepEqual(parseVersion("v0.1.10"), { major: 0, minor: 1, patch: 10, prerelease: [] });
  assert.deepEqual(parseVersion("0.1.5"), { major: 0, minor: 1, patch: 5, prerelease: [] });
  assert.deepEqual(parseVersion("V1.2"), { major: 1, minor: 2, patch: 0, prerelease: [] });
  assert.deepEqual(parseVersion(" 2.0.0-rc.1+build.7 ").prerelease, ["rc", "1"]);
  for (const invalid of ["latest", "", "1.2.3.4", "v", "1.2.3-", "1.2.3-beta..1", null, 12]) {
    assert.equal(parseVersion(invalid), null, `${String(invalid)} is not a version`);
  }

  const ascending = [
    "0.1.5",
    "0.1.9",
    "v0.1.10",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
    "1.0.1",
    "1.10.0",
  ];
  for (let index = 1; index < ascending.length; index += 1) {
    assert.equal(compareVersions(ascending[index - 1], ascending[index]), -1, ascending[index]);
    assert.equal(compareVersions(ascending[index], ascending[index - 1]), 1, ascending[index]);
  }
  assert.equal(compareVersions("v1.2", "1.2.0"), 0);
  assert.equal(compareVersions("1.2.0+a", "1.2.0+b"), 0);
  assert.throws(() => compareVersions("nightly", "1.0.0"));
  assert.equal(isNewerVersion("v0.1.10", "0.1.9"), true);
  assert.equal(isNewerVersion("0.1.10", "0.1.10"), false);
  assert.equal(isNewerVersion("0.1.10-beta.1", "0.1.10"), false);
  assert.equal(isNewerVersion("nightly", "0.1.10"), false);
}

// --- URLs -----------------------------------------------------------------------
{
  assert.equal(isAllowedDownloadUrl(`${DOWNLOAD_BASE}/v0.1.10/Muro-Music-Setup-0.1.10.exe`), true);
  for (const url of [
    `http://github.com/t-MURO/muro-music-electron/releases/download/v1/a.exe`,
    `https://github.com/someone-else/muro-music-electron/releases/download/v1/a.exe`,
    `https://github.com/t-MURO/muro-music-electron/archive/v1.zip`,
    `https://github.com.evil.example/t-MURO/muro-music-electron/releases/download/v1/a.exe`,
    `https://user@github.com/t-MURO/muro-music-electron/releases/download/v1/a.exe`,
    `https://github.com:8443/t-MURO/muro-music-electron/releases/download/v1/a.exe`,
    "https://objects.githubusercontent.com/a.exe",
    "not a url",
    undefined,
  ]) {
    assert.equal(isAllowedDownloadUrl(url), false, String(url));
  }
  assert.equal(isAllowedReleasePageUrl(`${PAGE_BASE}/v0.1.10`), true);
  assert.equal(isAllowedReleasePageUrl("https://evil.example/releases/tag/v0.1.10"), false);
}

// --- Release selection ----------------------------------------------------------
{
  const latest = selectLatestRelease([
    rawRelease("v0.1.10", { assets: [rawAsset("v0.1.10", "Muro-Music-Setup-0.1.10.exe")] }),
    rawRelease("0.1.5"),
    rawRelease("v9.9.9", { draft: true }),
    rawRelease("nightly", { name: "Nightly build" }),
    rawRelease("v0.2.0-beta.1", {
      html_url: "https://evil.example/releases/tag/v0.2.0-beta.1",
      assets: [
        rawAsset("v0.2.0-beta.1", "Muro-Music-Setup-0.2.0-beta.1.exe"),
        rawAsset("v0.2.0-beta.1", "evil.exe", {
          browser_download_url: "https://evil.example/evil.exe",
        }),
        rawAsset("v0.2.0-beta.1", "uploading.exe", { state: "starter" }),
      ],
    }),
  ]);
  assert.equal(latest.version, "0.2.0-beta.1", "pre-releases count; drafts do not");
  assert.equal(latest.prerelease, true);
  assert.equal(latest.htmlUrl, RELEASES_PAGE_URL, "a foreign release page is not trusted");
  assert.deepEqual(
    latest.assets.map((asset) => asset.name),
    ["Muro-Music-Setup-0.2.0-beta.1.exe"],
  );
  assert.equal(selectLatestRelease([]), null);
  assert.equal(selectLatestRelease({ message: "Not Found" }), null);
  // A release whose tag is not a version falls back to its name.
  assert.equal(selectLatestRelease([rawRelease("release", { name: "v3.0.0" })]).version, "3.0.0");
}

// --- Installer assets -----------------------------------------------------------
{
  const pick = (assets, platform, arch) => selectInstallerAsset(assets, platform, arch)?.name;
  assert.equal(pick(v0110Assets, "win32", "x64"), "Muro-Music-Setup-0.1.10.exe");
  assert.equal(pick(v0110Assets, "win32", "arm64"), "Muro-Music-Setup-0.1.10.exe");
  assert.equal(pick(v0110Assets, "win32", "ia32"), undefined);
  assert.equal(pick(v0110Assets, "darwin", "arm64"), "Muro-Music-0.1.10-arm64.dmg");
  assert.equal(pick(v0110Assets, "darwin", "x64"), undefined, "no Intel DMG is published");
  assert.equal(pick(v0110Assets, "linux", "x64"), undefined, "no AppImage is published");
  assert.equal(pick(v0110Assets, "freebsd", "x64"), undefined);

  const future = [
    "Muro-Music-0.2.0.dmg",
    "Muro-Music-0.2.0-universal.dmg",
    "Muro-Music-0.2.0-arm64.dmg",
    "Muro-Music-0.2.0.AppImage",
    "Muro-Music-0.2.0-arm64.AppImage",
    "Muro-Music-0.2.0.AppImage.blockmap",
    "Muro-Music-0.2.0-portable.exe",
    "Muro-Music-Setup-0.2.0.exe",
    "Muro-Music-Setup-0.2.0-arm64.exe",
  ].map((name) => ({ name, size: 1, digest: null, url: `${DOWNLOAD_BASE}/v0.2.0/${name}` }));
  assert.equal(pick(future, "darwin", "arm64"), "Muro-Music-0.2.0-arm64.dmg");
  assert.equal(pick(future, "darwin", "x64"), "Muro-Music-0.2.0.dmg");
  assert.equal(
    pick(
      future.filter((asset) => !asset.name.endsWith("0.2.0.dmg")),
      "darwin",
      "x64",
    ),
    "Muro-Music-0.2.0-universal.dmg",
  );
  assert.equal(pick(future, "linux", "x64"), "Muro-Music-0.2.0.AppImage");
  assert.equal(pick(future, "linux", "arm64"), "Muro-Music-0.2.0-arm64.AppImage");
  assert.equal(pick(future, "win32", "x64"), "Muro-Music-Setup-0.2.0.exe", "setup over portable");
  assert.equal(pick(future, "win32", "arm64"), "Muro-Music-Setup-0.2.0-arm64.exe");
}

// --- Integrity ------------------------------------------------------------------
{
  const hex = "ab".repeat(32);
  assert.equal(parseSha256Digest(`sha256:${hex.toUpperCase()}`), hex);
  assert.equal(parseSha256Digest("sha512:abc"), null);
  assert.equal(parseSha256Digest(null), null);
  const asset = { size: 10, digest: `sha256:${hex}` };
  assert.equal(integrityError({ bytes: 10, sha256: hex }, asset), null);
  assert.equal(integrityError({ bytes: 9, sha256: hex }, asset), "size-mismatch");
  assert.equal(integrityError({ bytes: 10, sha256: "cd".repeat(32) }, asset), "digest-mismatch");
  assert.equal(integrityError({ bytes: 10, sha256: "x" }, { size: 10, digest: null }), null);
}

// --- Checking GitHub --------------------------------------------------------------
const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

{
  let request = null;
  const latest = await fetchLatestRelease({
    userAgent: "MuroMusic/test",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse([rawRelease("v0.1.10")]);
    },
  });
  assert.equal(latest.version, "0.1.10");
  assert.equal(request.url, RELEASES_API_URL);
  assert.match(request.url, /\/releases\?per_page=20$/, "lists releases instead of /latest");
  assert.equal(request.init.headers.Accept, "application/vnd.github+json");
  assert.equal(request.init.headers["User-Agent"], "MuroMusic/test");
  assert.ok(request.init.signal instanceof AbortSignal, "the request has a timeout");

  const failure = async (fetchImpl) => {
    try {
      await fetchLatestRelease({ userAgent: "x", fetchImpl });
    } catch (error) {
      return error.code;
    }
    return null;
  };
  assert.equal(
    await failure(async () =>
      jsonResponse({}, { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    ),
    "rate-limited",
  );
  assert.equal(await failure(async () => jsonResponse({}, { status: 429 })), "rate-limited");
  assert.equal(await failure(async () => jsonResponse({}, { status: 500 })), "http");
  assert.equal(await failure(async () => new Response("<html>")), "invalid-response");
  assert.equal(await failure(async () => jsonResponse({ message: "x" })), "invalid-response");
  assert.equal(
    await failure(async () => {
      throw new TypeError("fetch failed");
    }),
    "network",
  );
  assert.equal(
    await failure(async () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    }),
    "timeout",
  );
}

// --- Downloading ----------------------------------------------------------------
const streamResponse = (buffer, { chunkSize = 16 * 1024, chunkDelayMs = 0, status = 200 } = {}) => {
  let offset = 0;
  const body = new ReadableStream({
    async pull(controller) {
      if (chunkDelayMs) await delay(chunkDelayMs);
      if (offset >= buffer.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(buffer.subarray(offset, offset + chunkSize)));
      offset += chunkSize;
    },
  });
  return new Response(body, {
    status,
    headers: { "content-length": String(buffer.length) },
  });
};

const payload = randomBytes(300 * 1024);
const payloadDigest = `sha256:${sha256(payload)}`;
const installerName = "Muro-Music-Setup-0.1.10.exe";
const installerUrl = `${DOWNLOAD_BASE}/v0.1.10/${installerName}`;

const releasesWith = (assetOverrides = {}) => [
  rawRelease("v0.1.10", {
    assets: [
      rawAsset("v0.1.10", installerName, {
        size: payload.length,
        digest: payloadDigest,
        ...assetOverrides,
      }),
      rawAsset("v0.1.10", "Muro-Music-0.1.10-arm64.dmg"),
      rawAsset("v0.1.10", `${installerName}.blockmap`),
    ],
  }),
  rawRelease("0.1.5"),
];

const createHarness = ({
  platform = "win32",
  arch = "x64",
  isPackaged = true,
  releases = releasesWith(),
  assetBody = () => streamResponse(payload),
} = {}) => {
  const downloadsDir = fs.mkdtempSync(path.join(root, "downloads-"));
  const calls = { api: 0, asset: 0, opened: [], shown: [], external: [] };
  const events = [];
  let time = Date.UTC(2026, 9, 14);
  const service = createUpdateService({
    currentVersion: "0.1.9",
    isPackaged,
    platform,
    arch,
    downloadsDir: () => downloadsDir,
    now: () => time,
    logger: { warn: () => undefined },
    emit: (name, status) => events.push({ name, status }),
    openPath: async (filePath) => {
      calls.opened.push(filePath);
      return "";
    },
    showItemInFolder: (filePath) => calls.shown.push(filePath),
    openExternal: async (url) => calls.external.push(url),
    fetchImpl: async (url) => {
      if (url === RELEASES_API_URL) {
        calls.api += 1;
        return jsonResponse(releases);
      }
      if (url === installerUrl) {
        calls.asset += 1;
        return assetBody();
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  return {
    service,
    calls,
    events,
    downloadsDir,
    advance: (milliseconds) => {
      time += milliseconds;
    },
  };
};

const settle = async (service) => {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (service.status().download.state !== "downloading") return service.status();
    await delay(5);
  }
  throw new Error("The download did not finish");
};

const listFiles = (directory) => fs.readdirSync(directory).sort();

// Checks: automatic ones are throttled and skipped in development builds.
{
  const { service, calls, events, advance } = createHarness();
  const pending = service.check({ manual: false });
  assert.equal(service.status().checking, true);
  const status = await pending;
  assert.equal(status.checking, false);
  assert.equal(status.currentVersion, "0.1.9");
  assert.equal(status.updateAvailable, true);
  assert.equal(status.error, null);
  assert.deepEqual(status.latest, {
    version: "0.1.10",
    name: "v0.1.10",
    prerelease: true,
    publishedAt: "2026-08-06T05:53:18Z",
    hasInstaller: true,
    installerName,
    installerSize: payload.length,
  });
  assert.ok(events.every((event) => event.name === UPDATE_STATUS_EVENT));
  assert.equal(events.at(-1).status.checking, false);
  await service.check({ manual: false });
  assert.equal(calls.api, 1, "a recent result is reused by automatic checks");
  await service.check({ manual: true });
  assert.equal(calls.api, 2, "manual checks always ask GitHub");
  advance(AUTOMATIC_CHECK_MIN_INTERVAL_MS + 1);
  await service.check({ manual: false });
  assert.equal(calls.api, 3);
  await Promise.all([service.check({ manual: true }), service.check({ manual: true })]);
  assert.equal(calls.api, 4, "concurrent checks share one request");
}
{
  const { service, calls } = createHarness({ isPackaged: false });
  assert.equal(service.status().automaticChecks, false);
  await service.check({ manual: false });
  assert.equal(calls.api, 0, "development builds never check on their own");
  assert.equal((await service.check({ manual: true })).updateAvailable, true);
}
{
  const { service } = createHarness({ releases: [rawRelease("v0.1.9"), rawRelease("0.1.5")] });
  const status = await service.check({ manual: true });
  assert.equal(status.updateAvailable, false);
  assert.equal(status.latest.version, "0.1.9");
}
{
  const failing = createUpdateService({
    currentVersion: "0.1.9",
    isPackaged: true,
    downloadsDir: () => root,
    logger: { warn: () => undefined },
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  const status = await failing.check({ manual: true });
  assert.equal(status.error, "network", "failures are reported in the status, not thrown");
  assert.equal(status.updateAvailable, false);
}

// A verified download lands in Downloads under the asset's name.
{
  const { service, calls, events, downloadsDir } = createHarness({
    assetBody: () => streamResponse(payload, { chunkDelayMs: 2 }),
  });
  await assert.rejects(service.openInstaller(), "nothing has been downloaded yet");
  await service.check({ manual: false });
  const started = await service.download("0.1.10");
  assert.equal(started.download.state, "downloading");
  assert.equal(started.download.totalBytes, payload.length);
  const done = await settle(service);
  assert.equal(done.download.state, "completed", JSON.stringify(done.download));
  assert.equal(done.download.fileName, installerName);
  assert.equal(done.download.receivedBytes, payload.length);
  assert.deepEqual(listFiles(downloadsDir), [installerName], "no .partial file is left");
  assert.ok(fs.readFileSync(path.join(downloadsDir, installerName)).equals(payload));
  const progress = events.filter((event) => event.status.download.state === "downloading");
  assert.ok(progress.length >= 2, "progress is reported while downloading");
  assert.ok(progress.at(-1).status.download.receivedBytes > 0);

  await service.openInstaller();
  await service.showInstaller();
  const saved = path.join(downloadsDir, installerName);
  assert.deepEqual(calls.opened, [saved]);
  assert.deepEqual(calls.shown, [saved]);

  // Downloading the same installer again reuses the verified file.
  await service.download("0.1.10");
  assert.equal((await settle(service)).download.state, "completed");
  assert.equal(calls.asset, 1);
  assert.deepEqual(listFiles(downloadsDir), [installerName]);

  // A missing installer is reported, not opened.
  fs.rmSync(saved);
  await assert.rejects(service.openInstaller());
  assert.equal(service.status().download.state, "idle");
  assert.equal(service.status().download.error, "missing-file");
  assert.equal(calls.opened.length, 1);
}

// An unrelated file with the installer's name is never overwritten.
{
  const { service, downloadsDir } = createHarness();
  fs.writeFileSync(path.join(downloadsDir, installerName), "someone else's file");
  await service.check({ manual: true });
  await service.download("0.1.10");
  assert.equal((await settle(service)).download.fileName, "Muro-Music-Setup-0.1.10 (1).exe");
  assert.equal(
    fs.readFileSync(path.join(downloadsDir, installerName), "utf8"),
    "someone else's file",
  );
}

// A digest or size mismatch deletes the file and reports the failure.
for (const [overrides, body, expected] of [
  [{ digest: `sha256:${"0".repeat(64)}` }, () => streamResponse(payload), "digest-mismatch"],
  [
    {},
    () => {
      const response = streamResponse(payload.subarray(0, 1000));
      response.headers.delete("content-length");
      return response;
    },
    "size-mismatch",
  ],
  [{ size: 1000 }, () => streamResponse(payload), "size-mismatch"],
  [{}, () => new Response("Not Found", { status: 404 }), "http"],
]) {
  const { service, downloadsDir } = createHarness({
    releases: releasesWith(overrides),
    assetBody: body,
  });
  await service.check({ manual: true });
  await service.download("0.1.10");
  const status = await settle(service);
  assert.equal(status.download.state, "failed", expected);
  assert.equal(status.download.error, expected);
  assert.deepEqual(listFiles(downloadsDir), [], `${expected} leaves no file behind`);
  await assert.rejects(service.openInstaller());
}

// Without a digest, the size alone is checked.
{
  const { service, downloadsDir } = createHarness({ releases: releasesWith({ digest: null }) });
  await service.check({ manual: true });
  await service.download("0.1.10");
  assert.equal((await settle(service)).download.state, "completed");
  assert.deepEqual(listFiles(downloadsDir), [installerName]);
}

// Cancelling stops the download and removes the partial file.
{
  const { service, downloadsDir } = createHarness({
    assetBody: () => streamResponse(payload, { chunkSize: 1024, chunkDelayMs: 5 }),
  });
  await service.check({ manual: true });
  await service.download("0.1.10");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (service.status().download.receivedBytes > 0) break;
    await delay(5);
  }
  assert.ok(service.status().download.receivedBytes > 0);
  service.cancelDownload();
  const status = await settle(service);
  assert.equal(status.download.state, "idle");
  assert.equal(status.download.error, null);
  await delay(50);
  assert.deepEqual(listFiles(downloadsDir), [], "the .partial file is removed");
}

// The renderer can only name a version; anything else is refused.
{
  const { service, calls } = createHarness();
  await service.check({ manual: true });
  const status = await service.download("9.9.9");
  assert.equal(status.download.state, "failed");
  assert.equal(status.download.error, "not-available");
  assert.equal(calls.asset, 0);
}

// Without an installer for this platform, Download opens the release page.
for (const [platform, arch] of [
  ["linux", "x64"],
  ["darwin", "x64"],
]) {
  const { service, calls } = createHarness({ platform, arch });
  const checked = await service.check({ manual: true });
  assert.equal(checked.latest.hasInstaller, false, platform);
  const status = await service.download("0.1.10");
  assert.equal(status.download.state, "idle");
  assert.deepEqual(calls.external, [`${PAGE_BASE}/v0.1.10`]);
  assert.equal(calls.asset, 0);
}
{
  const { service, calls } = createHarness();
  await service.openReleasePage();
  assert.deepEqual(calls.external, [RELEASES_PAGE_URL], "before a check, the release list opens");
  await service.check({ manual: true });
  await service.openReleasePage();
  assert.equal(calls.external.at(-1), `${PAGE_BASE}/v0.1.10`);
}

// downloadAsset refuses foreign URLs, plain-HTTP redirects and stalled transfers.
{
  const destinationDir = fs.mkdtempSync(path.join(root, "direct-"));
  const asset = { name: installerName, size: payload.length, digest: null, url: installerUrl };
  const codeOf = async (promise) => {
    try {
      await promise;
    } catch (error) {
      return error.code;
    }
    return null;
  };
  let fetched = false;
  assert.equal(
    await codeOf(
      downloadAsset(
        { ...asset, url: "https://evil.example/Muro-Music-Setup-0.1.10.exe" },
        {
          destinationDir,
          fetchImpl: async () => {
            fetched = true;
            return streamResponse(payload);
          },
        },
      ),
    ),
    "not-available",
  );
  assert.equal(fetched, false);
  assert.equal(
    await codeOf(
      downloadAsset(
        { ...asset, name: "../escape.exe" },
        { destinationDir, fetchImpl: async () => streamResponse(payload) },
      ),
    ),
    "invalid-response",
  );
  assert.equal(
    await codeOf(
      downloadAsset(asset, {
        destinationDir,
        fetchImpl: async () => {
          const response = streamResponse(payload);
          Object.defineProperty(response, "url", { value: "http://cdn.example/a.exe" });
          return response;
        },
      }),
    ),
    "network",
  );
  assert.equal(
    await codeOf(
      downloadAsset(asset, {
        destinationDir,
        stallTimeoutMs: 50,
        fetchImpl: async (_url, init) =>
          new Response(
            new ReadableStream({
              start(controller) {
                init.signal.addEventListener("abort", () => controller.error(init.signal.reason));
              },
            }),
          ),
      }),
    ),
    "timeout",
  );
  await delay(50);
  assert.deepEqual(listFiles(destinationDir), []);
}

fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
console.log("update-check-smoke: update checks and installer downloads verified");
