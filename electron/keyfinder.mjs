import {
  KeyFinderClient,
  resolveKeyFinderBinary,
} from "@neo-keyfinder/engine-client";
import { availableParallelism } from "node:os";

const camelotCodes = [
  "11B", "8A", "6B", "3A", "1B", "10A", "8B", "5A", "3B", "12A", "10B", "7A",
  "5B", "2A", "12B", "9A", "7B", "4A", "2B", "11A", "9B", "6A", "4B", "1A", "",
];

const baseAnalysisSettings = {
  schemaVersion: 2,
  // Key + BPM analysis keeps sizeable decoded-audio buffers in memory. Running
  // multiple native analyzers at once can exhaust memory on large selections,
  // so Muro deliberately favors stable sequential processing here.
  parallel: false,
  bpmAnalysisEnabled: true,
  maxDurationMinutes: 3600,
  skipExisting: false,
  automaticWrites: false,
  extensionFilterEnabled: false,
  extensions: [],
  outputs: {
    title: "none",
    artist: "none",
    album: "none",
    comment: "none",
    grouping: "none",
    initialKey: "none",
    bpm: "none",
    filename: "none",
  },
  delimiter: " - ",
  notation: "custom",
  customCodes: camelotCodes,
  libraryPaths: { itunes: "", traktor: "", serato: "" },
};

const outputModes = new Set(["none", "prepend", "append", "overwrite"]);
const notationModes = new Set(["standard", "custom", "combined", "djCombined"]);

const normalizeOutputMode = (value) => outputModes.has(value) ? value : "none";

const createAnalysisSettings = (requestedSettings, writeAuthorization) => {
  const requestedOutputs = requestedSettings?.outputs ?? {};
  const outputs = {
    title: "none",
    artist: "none",
    album: "none",
    comment: normalizeOutputMode(requestedOutputs.comment),
    grouping: normalizeOutputMode(requestedOutputs.grouping),
    initialKey: normalizeOutputMode(requestedOutputs.initialKey),
    bpm: requestedOutputs.bpm === "overwrite" ? "overwrite" : "none",
    // Renaming source files would make Muro's stored source paths stale.
    filename: "none",
  };
  const writesEnabled = Boolean(writeAuthorization) &&
    Object.values(outputs).some((mode) => mode !== "none");
  const customCodes = Array.from({ length: camelotCodes.length }, (_, index) => {
    const value = requestedSettings?.customCodes?.[index];
    return typeof value === "string" ? value.slice(0, 32) : camelotCodes[index];
  });

  return {
    ...baseAnalysisSettings,
    automaticWrites: writesEnabled,
    outputs,
    delimiter: typeof requestedSettings?.delimiter === "string"
      ? requestedSettings.delimiter.slice(0, 32)
      : baseAnalysisSettings.delimiter,
    notation: notationModes.has(requestedSettings?.notation)
      ? requestedSettings.notation
      : baseAnalysisSettings.notation,
    customCodes,
  };
};

const toEngineTrack = (track) => ({
  id: String(track.id),
  path: String(track.sourcePath),
  filename: String(track.sourcePath).split(/[\\/]/).at(-1) || String(track.title || track.id),
  title: String(track.title || ""),
  artist: String(track.artist || ""),
  album: String(track.album || ""),
  comment: String(track.comment || ""),
  grouping: "",
  initialKey: String(track.key || ""),
  initialBpm: Number.isFinite(track.bpm) ? track.bpm : null,
  durationMs: Number.isFinite(track.durationSeconds) ? Math.round(track.durationSeconds * 1000) : null,
  detectedKey: null,
  detectedCode: "",
  detectedBpm: null,
  status: "ready",
  error: null,
});

export const createKeyFinderService = ({ binaryDirectories, emit }) => {
  const clients = [];
  let nextOwner = 1;
  let nextPublicJob = 1;
  const senders = new Map();
  const jobs = new Map();

  const cleanupActive = (owner, active) => {
    senders.delete(owner);
    clients[active.clientIndex]?.activeOwners.delete(owner);
    jobs.delete(active.publicJobId);
    active.finished = true;
  };

  const createClient = (clientIndex) => {
    const client = new KeyFinderClient({
      executablePath: resolveKeyFinderBinary({ directories: binaryDirectories }),
    });
    const state = { client, activeOwners: new Set() };
    clients[clientIndex] = state;
    client.on("event", (event) => {
      const active = senders.get(event.owner);
      if (!active || active.clientIndex !== clientIndex) return;
      if (!active.sender.isDestroyed?.()) {
        emit(active.sender, "muro://keyfinder-analysis", {
          ...event,
          jobId: active.publicJobId,
        });
      }
      if (event.event === "jobFinished") cleanupActive(event.owner, active);
    });
    client.once("exit", () => {
      if (clients[clientIndex] === state) clients[clientIndex] = undefined;
      for (const [owner, active] of senders) {
        if (active.clientIndex !== clientIndex) continue;
        if (!active.sender.isDestroyed?.()) {
          for (const track of active.tracks) {
            emit(active.sender, "muro://keyfinder-analysis", {
              version: 1,
              event: "trackUpdated",
              jobId: active.publicJobId,
              owner,
              sequence: 0,
              payload: {
                track: {
                  ...toEngineTrack(track),
                  status: "failed",
                  error: {
                    code: "ENGINE_EXITED",
                    stage: "analysis",
                    message: "The analysis engine stopped. This batch can be retried.",
                  },
                },
              },
            });
          }
          emit(active.sender, "muro://keyfinder-analysis", {
            version: 1,
            event: "jobFinished",
            jobId: active.publicJobId,
            owner,
            sequence: 0,
            payload: { cancelled: false, completed: active.tracks.length, total: active.tracks.length },
          });
        }
        cleanupActive(owner, active);
      }
      client.removeAllListeners();
    });
    client.on("stderr", (message) => console.warn(`KeyFinder engine ${clientIndex + 1}: ${message.trimEnd()}`));
    client.on("protocolError", (error) => console.warn(error.message));
    return state;
  };

  const getClient = (clientIndex = 0) => clients[clientIndex] ?? createClient(clientIndex);

  const poolSizeFor = (performance) => {
    const available = Math.max(1, availableParallelism());
    if (performance === "maximum") return Math.min(4, available);
    if (performance === "fast") return Math.min(2, available);
    return 1;
  };

  const trimIdleClients = (poolSize) => {
    for (let index = poolSize; index < clients.length; index += 1) {
      const state = clients[index];
      if (!state || state.activeOwners.size > 0) continue;
      clients[index] = undefined;
      state.client.removeAllListeners();
      state.client.close();
    }
  };

  const selectClient = (poolSize) => {
    const states = Array.from({ length: poolSize }, (_, index) => getClient(index));
    return states.reduce((selected, candidate) => (
      candidate.activeOwners.size < selected.activeOwners.size ? candidate : selected
    ));
  };

  return {
    async health() {
      return getClient(0).client.health();
    },

    async startAnalysis(tracks, sender, requestedSettings, writeAuthorization = false) {
      const owner = `muro-analysis-${nextOwner++}`;
      const publicJobId = `job-${nextPublicJob++}`;
      const poolSize = poolSizeFor(requestedSettings?.performance);
      trimIdleClients(poolSize);
      const state = selectClient(poolSize);
      const clientIndex = clients.indexOf(state);
      const active = {
        sender,
        tracks,
        publicJobId,
        rawJobId: null,
        clientIndex,
        finished: false,
      };
      senders.set(owner, active);
      state.activeOwners.add(owner);
      const settings = createAnalysisSettings(requestedSettings, writeAuthorization);
      try {
        const result = await state.client.request(
          "startAnalysis",
          {
            owner,
            tracks: tracks.map(toEngineTrack),
            settings,
            writeAuthorization: settings.automaticWrites,
          },
          { timeoutMs: 60_000 },
        );
        active.rawJobId = result.jobId;
        if (!active.finished && senders.get(owner) === active) {
          jobs.set(publicJobId, { clientIndex, rawJobId: result.jobId });
        }
        return { ...result, jobId: publicJobId };
      } catch (error) {
        if (senders.get(owner) === active) cleanupActive(owner, active);
        throw error;
      }
    },

    cancelAnalysis(jobId) {
      const job = jobs.get(jobId);
      const state = job ? clients[job.clientIndex] : null;
      if (!job || !state) return Promise.resolve({ cancelled: false });
      return state.client.request("cancelJob", { jobId: job.rawJobId }, { timeoutMs: 5_000 });
    },

    recycle() {
      if (senders.size > 0 || clients.every((state) => !state)) return { recycled: false };
      for (let index = 0; index < clients.length; index += 1) {
        const state = clients[index];
        if (!state) continue;
        clients[index] = undefined;
        state.client.removeAllListeners();
        state.client.close();
      }
      jobs.clear();
      return { recycled: true };
    },

    generateWaveform(sourcePath, points = 512) {
      return getClient(0).client.request(
        "generateWaveform",
        { path: String(sourcePath), points: Math.max(32, Math.min(1024, Number(points) || 512)) },
        { timeoutMs: 120_000 },
      );
    },

    close() {
      senders.clear();
      jobs.clear();
      for (let index = 0; index < clients.length; index += 1) {
        const state = clients[index];
        if (!state) continue;
        clients[index] = undefined;
        state.client.removeAllListeners();
        state.client.close();
      }
    },
  };
};
