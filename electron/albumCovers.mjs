import fs from "node:fs";
import { cacheCoverBytes } from "./metadata.mjs";

const COVER_ART_ARCHIVE_ROOT = "https://coverartarchive.org";
const MUSICBRAINZ_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const NOT_FOUND_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const FAILURE_BACKOFF_MS = 30 * 60 * 1_000;
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;

const musicBrainzId = (value) => String(value ?? "").match(MUSICBRAINZ_ID)?.[0] ?? null;

const coverIdentity = (row) => {
  const releaseGroupId = musicBrainzId(row.musicbrainz_releasegroupid);
  if (releaseGroupId) {
    return {
      key: `release-group:${releaseGroupId.toLocaleLowerCase()}`,
      kind: "release-group",
      musicBrainzId: releaseGroupId,
    };
  }
  const releaseId = musicBrainzId(row.musicbrainz_albumid);
  if (!releaseId) return null;
  return {
    key: `release:${releaseId.toLocaleLowerCase()}`,
    kind: "release",
    musicBrainzId: releaseId,
  };
};

const secureCoverUrl = (value) => {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol === "http:") url.protocol = "https:";
    const allowedHost = url.hostname === "coverartarchive.org"
      || url.hostname.endsWith(".coverartarchive.org")
      || url.hostname === "archive.org"
      || url.hostname.endsWith(".archive.org");
    return url.protocol === "https:" && allowedHost ? url.toString() : null;
  } catch {
    return null;
  }
};

const pickCoverUrl = (payload) => {
  const images = Array.isArray(payload?.images) ? payload.images : [];
  const selected = [...images].sort((left, right) => (
    Number(Boolean(right?.front)) - Number(Boolean(left?.front))
    || Number(Boolean(right?.approved)) - Number(Boolean(left?.approved))
  ))[0];
  return [
    selected?.thumbnails?.["500"],
    selected?.thumbnails?.large,
    selected?.thumbnails?.["250"],
    selected?.image,
  ].map(secureCoverUrl).find(Boolean) ?? null;
};

const readCachedCover = (db, coverKey) => db.prepare(`
  SELECT status, full_path, thumb_path, source_url, fetched_at
  FROM album_cover_cache
  WHERE cover_key = ?
`).get(coverKey) ?? null;

const writeCachedCover = (db, identity, result, nowMs) => {
  db.prepare(`
    INSERT INTO album_cover_cache(
      cover_key, kind, musicbrainz_id, status, full_path, thumb_path, source_url, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cover_key) DO UPDATE SET
      kind = excluded.kind,
      musicbrainz_id = excluded.musicbrainz_id,
      status = excluded.status,
      full_path = excluded.full_path,
      thumb_path = excluded.thumb_path,
      source_url = excluded.source_url,
      fetched_at = excluded.fetched_at
  `).run(
    identity.key,
    identity.kind,
    identity.musicBrainzId,
    result ? "ready" : "not-found",
    result?.fullPath ?? null,
    result?.thumbPath ?? null,
    result?.sourceUrl ?? null,
    Math.floor(nowMs / 1_000),
  );
};

const cachedFilesExist = (cached) => Boolean(
  cached?.status === "ready"
  && cached.full_path
  && cached.thumb_path
  && fs.existsSync(cached.full_path)
  && fs.existsSync(cached.thumb_path)
);

const applyCoverToTracks = (db, trackIds, cached) => {
  if (!cachedFilesExist(cached) || trackIds.length === 0) return 0;
  const placeholders = trackIds.map(() => "?").join(", ");
  return db.prepare(`
    UPDATE tracks
    SET cover_art_path = ?, cover_art_thumb_path = ?
    WHERE id IN (${placeholders})
      AND (cover_art_path IS NULL OR cover_art_path = '')
  `).run(cached.full_path, cached.thumb_path, ...trackIds).changes;
};

export const createAlbumCoverService = ({
  cacheDir,
  fetchImpl = globalThis.fetch,
  cacheCoverBytesImpl = cacheCoverBytes,
  now = () => Date.now(),
  userAgent = "MuroMusicElectron/0.1.0 (https://github.com/t-MURO/muro-music-electron)",
} = {}) => {
  const scanInFlight = new WeakMap();
  const retryAfter = new Map();

  const fetchCover = async (identity) => {
    const response = await fetchImpl(
      `${COVER_ART_ARCHIVE_ROOT}/${identity.kind}/${identity.musicBrainzId}`,
      { headers: { Accept: "application/json", "User-Agent": userAgent } },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Cover Art Archive request failed (${response.status})`);
    const imageUrl = pickCoverUrl(await response.json());
    if (!imageUrl) return null;

    const imageResponse = await fetchImpl(imageUrl, { headers: { "User-Agent": userAgent } });
    if (imageResponse.status === 404) return null;
    if (!imageResponse.ok) {
      throw new Error(`Cover Art Archive image request failed (${imageResponse.status})`);
    }
    const declaredSize = Number(imageResponse.headers.get("content-length") || 0);
    if (declaredSize > MAX_DOWNLOAD_BYTES) throw new Error("Album cover is too large");
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error("Album cover is too large");
    const cached = await cacheCoverBytesImpl(bytes, cacheDir);
    return { ...cached, sourceUrl: imageUrl };
  };

  const scanCovers = async (db, { limit = 25 } = {}) => {
    if (scanInFlight.has(db)) return scanInFlight.get(db);
    const pending = (async () => {
      const rows = db.prepare(`
        SELECT id, musicbrainz_albumid, musicbrainz_releasegroupid
        FROM tracks
        WHERE (cover_art_path IS NULL OR cover_art_path = '')
          AND (
            (musicbrainz_releasegroupid IS NOT NULL AND musicbrainz_releasegroupid != '')
            OR (musicbrainz_albumid IS NOT NULL AND musicbrainz_albumid != '')
          )
      `).all();
      const groups = new Map();
      for (const row of rows) {
        const identity = coverIdentity(row);
        if (!identity) continue;
        const existing = groups.get(identity.key);
        if (existing) existing.trackIds.push(String(row.id));
        else groups.set(identity.key, { ...identity, trackIds: [String(row.id)] });
      }

      let updated = 0;
      const due = [];
      const scanStartedAt = now();
      for (const identity of groups.values()) {
        const cached = readCachedCover(db, identity.key);
        if (cachedFilesExist(cached)) {
          updated += applyCoverToTracks(db, identity.trackIds, cached);
          continue;
        }
        const negativeCacheIsFresh = cached?.status === "not-found"
          && scanStartedAt - Number(cached.fetched_at) * 1_000 < NOT_FOUND_CACHE_TTL_MS;
        if (!negativeCacheIsFresh && (retryAfter.get(identity.key) ?? 0) <= scanStartedAt) {
          due.push(identity);
        }
      }

      const batchLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 25)));
      const batch = due.slice(0, batchLimit);
      let failed = 0;
      for (const identity of batch) {
        try {
          const result = await fetchCover(identity);
          writeCachedCover(db, identity, result, now());
          if (result) {
            updated += applyCoverToTracks(db, identity.trackIds, {
              status: "ready",
              full_path: result.fullPath,
              thumb_path: result.thumbPath,
            });
          }
          retryAfter.delete(identity.key);
        } catch (error) {
          failed += 1;
          retryAfter.set(identity.key, now() + FAILURE_BACKOFF_MS);
          console.warn(`Could not load album cover for ${identity.musicBrainzId}:`, error);
        }
      }

      return {
        checked: batch.length,
        updated,
        failed,
        queued: Math.max(0, due.length - batch.length),
        remaining: Math.max(0, due.length - batch.length + failed),
        totalAlbums: groups.size,
      };
    })();
    scanInFlight.set(db, pending);
    try {
      return await pending;
    } finally {
      scanInFlight.delete(db);
    }
  };

  return { scanCovers };
};
