import {
  KeyFinderClient,
  resolveKeyFinderBinary,
} from "@neo-keyfinder/engine-client";

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
  let client;
  let nextOwner = 1;
  const senders = new Map();

  const getClient = () => {
    if (client) return client;
    client = new KeyFinderClient({
      executablePath: resolveKeyFinderBinary({ directories: binaryDirectories }),
    });
    client.on("event", (event) => {
      const active = senders.get(event.owner);
      if (!active || active.sender.isDestroyed?.()) return;
      emit(active.sender, "muro://keyfinder-analysis", event);
      if (event.event === "jobFinished") senders.delete(event.owner);
    });
    client.once("exit", () => {
      const failedClient = client;
      client = undefined;
      for (const [owner, active] of senders) {
        if (active.sender.isDestroyed?.()) continue;
        const jobId = active.jobId || `failed-${owner}`;
        for (const track of active.tracks) {
          emit(active.sender, "muro://keyfinder-analysis", {
            version: 1,
            event: "trackUpdated",
            jobId,
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
          jobId,
          owner,
          sequence: 0,
          payload: { cancelled: false, completed: active.tracks.length, total: active.tracks.length },
        });
      }
      senders.clear();
      if (failedClient) failedClient.removeAllListeners();
    });
    client.on("stderr", (message) => console.warn(`KeyFinder engine: ${message.trimEnd()}`));
    client.on("protocolError", (error) => console.warn(error.message));
    return client;
  };

  return {
    async health() {
      return getClient().health();
    },

    async startAnalysis(tracks, sender, requestedSettings, writeAuthorization = false) {
      const owner = `muro-analysis-${nextOwner++}`;
      const active = { sender, tracks, jobId: null };
      senders.set(owner, active);
      const settings = createAnalysisSettings(requestedSettings, writeAuthorization);
      try {
        const result = await getClient().request(
          "startAnalysis",
          {
            owner,
            tracks: tracks.map(toEngineTrack),
            settings,
            writeAuthorization: settings.automaticWrites,
          },
          { timeoutMs: 60_000 },
        );
        active.jobId = result.jobId;
        return result;
      } catch (error) {
        senders.delete(owner);
        throw error;
      }
    },

    cancelAnalysis(jobId) {
      return getClient().request("cancelJob", { jobId }, { timeoutMs: 5_000 });
    },

    recycle() {
      if (senders.size > 0 || !client) return { recycled: false };
      const previousClient = client;
      client = undefined;
      previousClient.removeAllListeners();
      previousClient.close();
      return { recycled: true };
    },

    generateWaveform(sourcePath, points = 512) {
      return getClient().request(
        "generateWaveform",
        { path: String(sourcePath), points: Math.max(32, Math.min(1024, Number(points) || 512)) },
        { timeoutMs: 120_000 },
      );
    },

    close() {
      senders.clear();
      client?.close();
      client = undefined;
    },
  };
};
