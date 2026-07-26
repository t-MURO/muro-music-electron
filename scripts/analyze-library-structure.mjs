/**
 * Measures the beat-grid analyser against a real library instead of synthetic
 * fixtures, and reports what the automix planner would do with the results.
 *
 * Synthetic tracks change section cleanly on a bar line; real ones build and
 * decay. This is the pass that says whether the confidence floors are set
 * anywhere near right.
 *
 *   npx electron scripts/analyze-library-structure.mjs [--sample 150] [--db PATH]
 *
 * Analysis needs Web Audio to decode, so it runs in an offscreen renderer,
 * while the planner runs here in the main process — plan.ts has only type
 * imports, so Node strips it directly.
 */
import { app, BrowserWindow, protocol } from "electron";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createLocalFileResponse } from "../electron/fileProtocol.mjs";
import { planTransition } from "../src/lib/mix/plan.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const SAMPLE_SIZE = Number(argOf("sample", 150));
const PAIR_COUNT = Number(argOf("pairs", 400));

/**
 * Running this file directly makes Electron report its own name, so
 * `userData` points at .../Roaming/Electron rather than the app's directory.
 * The packaged location is checked first.
 */
const defaultDbPath = () => {
  const candidates = [
    path.join(path.dirname(app.getPath("userData")), "muro-music-electron", "muro.db"),
    path.join(app.getPath("userData"), "muro.db"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
};
const DB_PATH = argOf("db", defaultDbPath());

protocol.registerSchemesAsPrivileged([
  {
    scheme: "muro-file",
    privileges: {
      standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true,
    },
  },
]);

/** Deterministic so repeated runs compare like with like. */
const seededShuffle = (items, seed) => {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const percentile = (sorted, fraction) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];

const histogram = (values, buckets) => {
  const counts = new Map(buckets.map((bucket) => [bucket, 0]));
  for (const value of values) {
    let chosen = buckets[0];
    for (const bucket of buckets) if (value >= bucket) chosen = bucket;
    counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
  }
  return counts;
};

const bar = (count, total, width = 32) =>
  "#".repeat(Math.round((count / Math.max(1, total)) * width));

const main = async () => {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}. Pass --db PATH.`);
    app.exit(1);
    return;
  }

  const db = new Database(DB_PATH, { readonly: true });
  const tracks = db.prepare(`
    SELECT id, title, artist, source_path, duration_seconds, bpm
    FROM tracks
    WHERE import_status != 'staged'
      AND COALESCE(is_missing, 0) = 0
      AND duration_seconds > 60
  `).all();
  db.close();

  const sample = seededShuffle(tracks, 20260726).slice(0, SAMPLE_SIZE)
    .filter((track) => fs.existsSync(track.source_path));
  console.log(`Library: ${tracks.length} eligible tracks. Analysing ${sample.length}.\n`);

  // Bundle the analyser for the renderer; esbuild reads the TypeScript directly.
  const bundlePath = path.join(os.tmpdir(), `muro-structure-probe-${process.pid}.js`);
  await build({
    stdin: {
      contents: `
        import { analyzeBeatGrid } from ${JSON.stringify(path.join(root, "src/lib/beatgrid/dsp.ts"))};
        const RATE = 11025;
        window.__analyzeTrack = async (sourcePath, bpmHint) => {
          const response = await fetch("muro-file://local/" + encodeURIComponent(sourcePath));
          if (!response.ok) throw new Error("HTTP " + response.status);
          const encoded = await response.arrayBuffer();
          // OfflineAudioContext decodes and resamples in one step, exactly as
          // the app's own analysis path does.
          const context = new OfflineAudioContext(1, 1, RATE);
          const decoded = await context.decodeAudioData(encoded);
          const mono = new Float32Array(decoded.length);
          const channels = decoded.numberOfChannels;
          for (let c = 0; c < channels; c += 1) {
            const data = decoded.getChannelData(c);
            for (let i = 0; i < mono.length; i += 1) mono[i] += data[i];
          }
          if (channels > 1) for (let i = 0; i < mono.length; i += 1) mono[i] /= channels;
          return analyzeBeatGrid(mono, decoded.sampleRate, { bpmHint: bpmHint || null });
        };
      `,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    outfile: bundlePath,
  });

  protocol.handle("muro-file", (request) => {
    try {
      const url = new URL(request.url);
      return createLocalFileResponse(request, decodeURIComponent(url.pathname.slice(1)));
    } catch {
      return new Response("bad", { status: 400 });
    }
  });

  const htmlPath = path.join(os.tmpdir(), `muro-structure-probe-${process.pid}.html`);
  fs.writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><script src="${
    "file://" + bundlePath.replace(/\\/g, "/")
  }"></script>`);

  // Offscreen: a hidden window stops producing frames partway through a long
  // run on Windows, which starves anything frame-driven.
  const window = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, webSecurity: true },
  });
  await window.loadFile(htmlPath);

  const grids = [];
  const failures = [];
  const startedAt = Date.now();

  for (let index = 0; index < sample.length; index += 1) {
    const track = sample[index];
    try {
      const grid = await window.webContents.executeJavaScript(
        `__analyzeTrack(${JSON.stringify(track.source_path)}, ${Number(track.bpm) || 0})`,
      );
      grids.push({ track, grid });
    } catch (error) {
      // executeJavaScript rejects with a plain object rather than an Error, so
      // String() on it yields "[object Object]" and hides the reason.
      const message = error instanceof Error
        ? error.message
        : (error?.message ?? error?.stack ?? JSON.stringify(error) ?? String(error));
      failures.push({ track, message: String(message).slice(0, 160) });
    }
    if ((index + 1) % 10 === 0 || index + 1 === sample.length) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = (index + 1) / elapsed;
      const remaining = (sample.length - index - 1) / Math.max(rate, 1e-6);
      process.stdout.write(
        `\r  ${index + 1}/${sample.length} analysed, ${failures.length} failed` +
        `, ${elapsed.toFixed(0)}s elapsed, ~${remaining.toFixed(0)}s left   `,
      );
    }
  }
  process.stdout.write("\n\n");

  fs.rmSync(bundlePath, { force: true });
  fs.rmSync(htmlPath, { force: true });

  if (grids.length === 0) {
    console.error("Nothing analysed.");
    for (const failure of failures.slice(0, 10)) {
      console.error(`  ${failure.track.title}: ${failure.message}`);
    }
    app.exit(1);
    return;
  }

  // --- Grid quality ---------------------------------------------------------
  const gridConfidence = grids.map((entry) => entry.grid.confidence).sort((a, b) => a - b);
  const phraseConfidence = grids.map((entry) => entry.grid.phraseConfidence).sort((a, b) => a - b);

  console.log(`=== ${grids.length} tracks analysed (${failures.length} failed) ===\n`);
  console.log("Grid confidence     p10=%s p50=%s p90=%s",
    percentile(gridConfidence, 0.1).toFixed(3),
    percentile(gridConfidence, 0.5).toFixed(3),
    percentile(gridConfidence, 0.9).toFixed(3));
  console.log("Phrase confidence   p10=%s p50=%s p90=%s",
    percentile(phraseConfidence, 0.1).toFixed(3),
    percentile(phraseConfidence, 0.5).toFixed(3),
    percentile(phraseConfidence, 0.9).toFixed(3));

  // The planner's own thresholds, so the numbers answer a real question.
  const MIN_PHRASE_CONFIDENCE = 0.15;
  const MIN_GRID_CONFIDENCE = 0.25;
  const usablePhrase = phraseConfidence.filter((value) => value >= MIN_PHRASE_CONFIDENCE).length;
  const usableGrid = gridConfidence.filter((value) => value >= MIN_GRID_CONFIDENCE).length;
  console.log("\nAbove planner floors:");
  console.log(`  grid   >= ${MIN_GRID_CONFIDENCE}: ${usableGrid}/${grids.length} (${(100 * usableGrid / grids.length).toFixed(0)}%)`);
  console.log(`  phrase >= ${MIN_PHRASE_CONFIDENCE}: ${usablePhrase}/${grids.length} (${(100 * usablePhrase / grids.length).toFixed(0)}%)`);

  console.log("\nPhrase confidence distribution:");
  const phraseBuckets = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.6];
  for (const [bucket, count] of histogram(phraseConfidence, phraseBuckets)) {
    console.log(`  >=${bucket.toFixed(2)}  ${String(count).padStart(4)}  ${bar(count, grids.length)}`);
  }

  console.log("\nDetected phrase length (bars):");
  const phraseBars = grids.map((entry) => entry.grid.phraseBars);
  for (const bars of [4, 8, 16, 32]) {
    const count = phraseBars.filter((value) => value === bars).length;
    console.log(`  ${String(bars).padStart(2)}  ${String(count).padStart(4)}  ${bar(count, grids.length)}`);
  }

  // --- Structure ------------------------------------------------------------
  const withOutro = grids.filter((entry) => entry.grid.hasOutro);
  const withIntro = grids.filter((entry) => entry.grid.introEndSec > 0);
  console.log("\nStructure:");
  console.log(`  has an outro: ${withOutro.length}/${grids.length} (${(100 * withOutro.length / grids.length).toFixed(0)}%)`);
  console.log(`  has an intro: ${withIntro.length}/${grids.length} (${(100 * withIntro.length / grids.length).toFixed(0)}%)`);

  const outroBars = withOutro.map((entry) => {
    const barSec = 4 * (60 / entry.grid.bpm);
    return (entry.track.duration_seconds - entry.grid.outroStartSec) / barSec;
  }).sort((a, b) => a - b);
  const introBars = withIntro.map((entry) => {
    const barSec = 4 * (60 / entry.grid.bpm);
    return (entry.grid.introEndSec - entry.grid.firstDownbeatSec) / barSec;
  }).sort((a, b) => a - b);
  if (outroBars.length > 0) {
    console.log("  outro length (bars) p10=%s p50=%s p90=%s",
      percentile(outroBars, 0.1).toFixed(1), percentile(outroBars, 0.5).toFixed(1),
      percentile(outroBars, 0.9).toFixed(1));
  }
  if (introBars.length > 0) {
    console.log("  intro length (bars) p10=%s p50=%s p90=%s",
      percentile(introBars, 0.1).toFixed(1), percentile(introBars, 0.5).toFixed(1),
      percentile(introBars, 0.9).toFixed(1));
  }

  // --- What the planner actually does with real pairs ------------------------
  console.log(`\n=== ${PAIR_COUNT} random pairs through planTransition (cap 16 bars) ===\n`);
  const shuffled = seededShuffle(grids, 987654321);
  const modes = { beatmatch: 0, fade: 0 };
  const chosenBars = [];
  const startFromEnd = [];
  for (let index = 0; index < PAIR_COUNT; index += 1) {
    const a = shuffled[index % shuffled.length];
    const b = shuffled[(index * 7 + 3) % shuffled.length];
    if (a === b) continue;
    const plan = planTransition({
      gridA: a.grid,
      gridB: b.grid,
      durationASec: a.track.duration_seconds,
      durationBSec: b.track.duration_seconds,
      bars: 16,
    });
    modes[plan.mode] += 1;
    if (plan.mode === "beatmatch") {
      chosenBars.push(plan.durationSec / (4 * (60 / a.grid.bpm)));
      startFromEnd.push(a.track.duration_seconds - plan.startAtSec);
    }
  }
  const planned = modes.beatmatch + modes.fade;
  console.log(`  beatmatched: ${modes.beatmatch}/${planned} (${(100 * modes.beatmatch / Math.max(1, planned)).toFixed(0)}%)`);
  console.log(`  fell back to fade: ${modes.fade}/${planned} (${(100 * modes.fade / Math.max(1, planned)).toFixed(0)}%)`);

  if (chosenBars.length > 0) {
    console.log("\n  Derived blend length (bars):");
    for (const bars of [2, 4, 8, 16, 32]) {
      const count = chosenBars.filter((value) => Math.abs(value - bars) < 0.5).length;
      console.log(`    ${String(bars).padStart(2)}  ${String(count).padStart(4)}  ${bar(count, chosenBars.length)}`);
    }
    const sortedStart = [...startFromEnd].sort((a, b) => a - b);
    console.log("\n  Mix-out point, seconds before the end of A:");
    console.log("    p10=%ss p50=%ss p90=%ss",
      percentile(sortedStart, 0.1).toFixed(1),
      percentile(sortedStart, 0.5).toFixed(1),
      percentile(sortedStart, 0.9).toFixed(1));
  }

  if (failures.length > 0) {
    console.log(`\nFailures (${failures.length}), first few:`);
    for (const failure of failures.slice(0, 5)) {
      console.log(`  ${failure.track.artist} - ${failure.track.title}: ${failure.message}`);
    }
  }

  app.exit(0);
};

app.whenReady().then(main).catch((error) => {
  console.error(error);
  app.exit(1);
});
