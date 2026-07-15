import {
  KeyFinderClient,
  resolveKeyFinderBinary,
} from "@neo-keyfinder/engine-client";

const camelotCodes = [
  "11B", "8A", "6B", "3A", "1B", "10A", "8B", "5A", "3B", "12A", "10B", "7A",
  "5B", "2A", "12B", "9A", "7B", "4A", "2B", "11A", "9B", "6A", "4B", "1A", "",
];

const analysisSettings = {
  schemaVersion: 2,
  parallel: true,
  bpmAnalysisEnabled: true,
  maxDurationMinutes: 60,
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
      const sender = senders.get(event.owner);
      if (!sender || sender.isDestroyed?.()) return;
      emit(sender, "muro://keyfinder-analysis", event);
      if (event.event === "jobFinished") senders.delete(event.owner);
    });
    client.on("stderr", (message) => console.warn(`KeyFinder engine: ${message.trimEnd()}`));
    client.on("protocolError", (error) => console.warn(error.message));
    return client;
  };

  return {
    async health() {
      return getClient().health();
    },

    async startAnalysis(tracks, sender) {
      const owner = `muro-analysis-${nextOwner++}`;
      senders.set(owner, sender);
      try {
        return await getClient().request(
          "startAnalysis",
          {
            owner,
            tracks: tracks.map(toEngineTrack),
            settings: analysisSettings,
            writeAuthorization: false,
          },
          { timeoutMs: 10_000 },
        );
      } catch (error) {
        senders.delete(owner);
        throw error;
      }
    },

    cancelAnalysis(jobId) {
      return getClient().request("cancelJob", { jobId }, { timeoutMs: 5_000 });
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
