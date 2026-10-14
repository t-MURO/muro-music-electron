import { useCallback, useEffect, useState } from "react";
import type { ArtistImageCandidate, ArtistProfile } from "../types";
import { artistIdentityKey, type ArtistTarget } from "../utils/artistCredits";
import {
  getArtistProfile,
  loadCachedArtistProfiles,
  scanArtistProfiles,
  searchArtistImages,
  setArtistImage,
} from "../utils";
import { startTask, useSettingsStore, type TaskHandle } from "../stores";
import { t } from "../i18n";

const INITIAL_SCAN_DELAY_MS = 5_000;
const CONTINUE_SCAN_DELAY_MS = 60_000;
const PERIODIC_SCAN_DELAY_MS = 30 * 60_000;
const SCAN_BATCH_SIZE = 25;

export const normalizeArtistProfileKey = (artistName: string) =>
  artistName.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

export const useArtistProfiles = () => {
  const lastFmApiKey = useSettingsStore((state) => state.lastFmApiKey);
  const theAudioDbApiKey = useSettingsStore((state) => state.theAudioDbApiKey);
  const fanartApiKey = useSettingsStore((state) => state.fanartApiKey);
  const braveSearchApiKey = useSettingsStore((state) => state.braveSearchApiKey);
  const [profiles, setProfiles] = useState<Record<string, ArtistProfile>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const cached = await loadCachedArtistProfiles();
        if (cancelled) return;
        setProfiles(Object.fromEntries(cached.map((profile) => [profile.artistKey, profile])));
      } catch {
        // Cached profiles are optional; artist pages still work through on-demand lookup.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One task spans the batches of a discovery run, which are a minute apart.
    let task: TaskHandle | null = null;
    let updated = 0;
    let failed = 0;
    let inFlight = false;
    let stopRequested = false;
    const summary = () =>
      t("tasks.artists.summary", { updated: String(updated), failed: String(failed) });
    const endRun = () => {
      task = null;
      updated = 0;
      failed = 0;
    };
    const schedule = (delayMs: number) => {
      if (!cancelled) timer = setTimeout(() => void run(), delayMs);
    };
    // Skips the rest of this run; the periodic check picks it up later.
    const stopRun = () => {
      task?.cancelled(summary());
      endRun();
      if (inFlight) {
        stopRequested = true;
      } else {
        if (timer) clearTimeout(timer);
        schedule(PERIODIC_SCAN_DELAY_MS);
      }
    };
    const run = async () => {
      inFlight = true;
      try {
        const result = await scanArtistProfiles(
          { fanartApiKey, lastFmApiKey, theAudioDbApiKey },
          SCAN_BATCH_SIZE,
        );
        inFlight = false;
        if (cancelled) return;
        const stopped = stopRequested;
        stopRequested = false;
        if (!stopped && result.checked > 0) {
          updated += result.updated;
          failed += result.failed;
          if (!task && result.queued > 0) {
            task = startTask({ kind: "artists", title: t("tasks.artists.title"), cancel: stopRun });
          }
          task?.progress(Math.max(0, result.totalArtists - result.remaining), result.totalArtists);
        }
        const cached = await loadCachedArtistProfiles();
        if (cancelled) return;
        setProfiles(Object.fromEntries(cached.map((profile) => [profile.artistKey, profile])));
        if (result.queued === 0) {
          task?.succeed(summary());
          endRun();
        }
        schedule(result.queued > 0 && !stopped ? CONTINUE_SCAN_DELAY_MS : PERIODIC_SCAN_DELAY_MS);
      } catch (error) {
        inFlight = false;
        stopRequested = false;
        task?.fail(error, summary());
        endRun();
        schedule(PERIODIC_SCAN_DELAY_MS);
      }
    };
    schedule(INITIAL_SCAN_DELAY_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // New provider keys restart discovery with a fresh task.
      task?.cancelled(summary());
    };
  }, [fanartApiKey, lastFmApiKey, theAudioDbApiKey]);

  const loadProfile = useCallback(
    async (artistName: string, force = false, identity?: ArtistTarget) => {
      const artistKey = identity
        ? artistIdentityKey(identity)
        : normalizeArtistProfileKey(artistName);
      if (!artistKey) return null;
      setLoadingKeys((current) => new Set(current).add(artistKey));
      setErrors((current) => {
        const next = { ...current };
        delete next[artistKey];
        return next;
      });
      try {
        const profile = await getArtistProfile(
          artistName,
          force,
          {
            fanartApiKey,
            lastFmApiKey,
            theAudioDbApiKey,
          },
          {
            artistId: identity?.artistId,
            musicBrainzId: identity?.musicBrainzId,
          },
        );
        setProfiles((current) => ({ ...current, [artistKey]: profile }));
        return profile;
      } catch (error) {
        setErrors((current) => ({
          ...current,
          [artistKey]: error instanceof Error ? error.message : "Artist information is unavailable",
        }));
        return null;
      } finally {
        setLoadingKeys((current) => {
          const next = new Set(current);
          next.delete(artistKey);
          return next;
        });
      }
    },
    [fanartApiKey, lastFmApiKey, theAudioDbApiKey],
  );

  const searchImages = useCallback(
    async (artistName: string, identity?: ArtistTarget) => {
      return searchArtistImages(
        artistName,
        {
          braveSearchApiKey,
          fanartApiKey,
          lastFmApiKey,
          theAudioDbApiKey,
        },
        {
          artistId: identity?.artistId,
          musicBrainzId: identity?.musicBrainzId,
        },
      );
    },
    [braveSearchApiKey, fanartApiKey, lastFmApiKey, theAudioDbApiKey],
  );

  const selectImage = useCallback(
    async (artistName: string, candidate: ArtistImageCandidate, identity?: ArtistTarget) => {
      const artistKey = identity
        ? artistIdentityKey(identity)
        : normalizeArtistProfileKey(artistName);
      const profile = await setArtistImage(artistName, candidate, {
        artistId: identity?.artistId,
        musicBrainzId: identity?.musicBrainzId,
      });
      setProfiles((current) => ({ ...current, [artistKey]: profile }));
      return profile;
    },
    [],
  );

  return { profiles, loadingKeys, errors, loadProfile, searchImages, selectImage };
};
