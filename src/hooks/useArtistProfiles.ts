import { useCallback, useEffect, useState } from "react";
import type { ArtistProfile } from "../types";
import { getArtistProfile, loadCachedArtistProfiles } from "../utils";
import { useSettingsStore } from "../stores";
import { useDbPath } from "./useDbPath";

export const normalizeArtistProfileKey = (artistName: string) => artistName
  .normalize("NFKC")
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase();

export const useArtistProfiles = () => {
  const resolveDbPath = useDbPath();
  const fanartApiKey = useSettingsStore((state) => state.fanartApiKey);
  const [profiles, setProfiles] = useState<Record<string, ArtistProfile>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const dbPath = await resolveDbPath();
        const cached = await loadCachedArtistProfiles(dbPath);
        if (cancelled) return;
        setProfiles(Object.fromEntries(cached.map((profile) => [profile.artistKey, profile])));
      } catch {
        // Cached profiles are optional; artist pages still work through on-demand lookup.
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [resolveDbPath]);

  const loadProfile = useCallback(async (artistName: string, force = false) => {
    const artistKey = normalizeArtistProfileKey(artistName);
    if (!artistKey) return null;
    setLoadingKeys((current) => new Set(current).add(artistKey));
    setErrors((current) => {
      const next = { ...current };
      delete next[artistKey];
      return next;
    });
    try {
      const dbPath = await resolveDbPath();
      const profile = await getArtistProfile(dbPath, artistName, force, fanartApiKey);
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
  }, [fanartApiKey, resolveDbPath]);

  return { profiles, loadingKeys, errors, loadProfile };
};
