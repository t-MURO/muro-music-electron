import fs from "node:fs";
import { cacheCoverBytes } from "./metadata.mjs";

const COVER_ART_ARCHIVE_ROOT = "https://coverartarchive.org";
const MUSICBRAINZ_RELEASE_GROUP_ROOT = "https://musicbrainz.org/ws/2/release-group/";
const MUSICBRAINZ_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const NOT_FOUND_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;

const musicBrainzId = (value) => String(value ?? "").match(MUSICBRAINZ_ID)?.[0] ?? null;

const normalizedName = (value) => String(value ?? "").trim().toLocaleLowerCase();

const quotedSearchTerm = (value) => `"${String(value ?? "")
  .trim()
  .replace(/([\\"])/g, "\\$1")}"`;

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

export const createAlbumCoverService = ({
  cacheDir,
  fetchImpl = globalThis.fetch,
  cacheCoverBytesImpl = cacheCoverBytes,
  now = () => Date.now(),
  userAgent = "MuroMusicElectron/0.1.0 (https://github.com/t-MURO/muro-music-electron)",
} = {}) => {
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

  const searchReleaseGroup = async ({ album, artist }) => {
    if (!String(album ?? "").trim() || !String(artist ?? "").trim()) return null;
    const searchUrl = new URL(MUSICBRAINZ_RELEASE_GROUP_ROOT);
    searchUrl.searchParams.set(
      "query",
      `releasegroup:${quotedSearchTerm(album)} AND artist:${quotedSearchTerm(artist)}`,
    );
    searchUrl.searchParams.set("fmt", "json");
    searchUrl.searchParams.set("limit", "5");
    const response = await fetchImpl(searchUrl, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
    });
    if (!response.ok) throw new Error(`MusicBrainz cover lookup failed (${response.status})`);
    const payload = await response.json();
    const candidates = Array.isArray(payload?.["release-groups"])
      ? payload["release-groups"]
      : [];
    const exact = candidates.find((candidate) => (
      normalizedName(candidate?.title) === normalizedName(album)
      && Number(candidate?.score ?? 0) >= 80
    ));
    const selected = exact ?? candidates.find((candidate) => Number(candidate?.score ?? 0) >= 90);
    const releaseGroupId = musicBrainzId(selected?.id);
    return releaseGroupId ? {
      key: `release-group:${releaseGroupId.toLocaleLowerCase()}`,
      kind: "release-group",
      musicBrainzId: releaseGroupId,
    } : null;
  };

  const fetchCoverForTrack = async (db, { trackId, album, artist } = {}) => {
    const row = db.prepare(`
      SELECT id, artist, album_artist, album, musicbrainz_albumid, musicbrainz_releasegroupid
      FROM tracks
      WHERE id = ?
    `).get(String(trackId ?? ""));
    if (!row) throw new Error("Track was not found in the library");

    const identity = coverIdentity(row) ?? await searchReleaseGroup({
      album: String(album ?? row.album ?? "").trim(),
      artist: String(artist ?? row.album_artist ?? row.artist ?? "").trim(),
    });
    if (!identity) return null;

    const cached = readCachedCover(db, identity.key);
    if (cachedFilesExist(cached)) {
      return {
        fullPath: cached.full_path,
        thumbPath: cached.thumb_path,
        sourceUrl: cached.source_url,
      };
    }
    const cacheIsFresh = cached?.status === "not-found"
      && now() - Number(cached.fetched_at) * 1_000 < NOT_FOUND_CACHE_TTL_MS;
    if (cacheIsFresh) return null;

    const result = await fetchCover(identity);
    writeCachedCover(db, identity, result, now());
    return result;
  };

  return { fetchCoverForTrack };
};
