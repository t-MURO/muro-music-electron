import crypto from "node:crypto";
import fs from "node:fs";
import { cacheCoverBytes } from "./metadata.mjs";

const COVER_ART_ARCHIVE_ROOT = "https://coverartarchive.org";
const MUSICBRAINZ_RELEASE_GROUP_ROOT = "https://musicbrainz.org/ws/2/release-group/";
const DEEZER_ALBUM_SEARCH_ROOT = "https://api.deezer.com/search/album";
const MUSICBRAINZ_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const NOT_FOUND_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const COVER_CACHE_VERSION = "v3";

const musicBrainzId = (value) => String(value ?? "").match(MUSICBRAINZ_ID)?.[0] ?? null;

const normalizedName = (value) => String(value ?? "")
  .normalize("NFKC")
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase();

const quotedSearchTerm = (value) => `"${String(value ?? "")
  .trim()
  .replace(/([\\"])/g, "\\$1")}"`;

const normalizedArtistCredits = (value) => {
  const normalized = normalizedName(value);
  if (!normalized) return [];
  if (normalized === "va" || normalized === "v.a.") return ["various artists"];
  return [...new Set(normalized
    .replace(/\s+(?:feat\.?|featuring|ft\.?)\s+/g, ",")
    .split(/\s*(?:,|;|&)\s*/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => name === "va" || name === "v.a." ? "various artists" : name))]
    .sort();
};

const artistCreditsMatch = (left, right) => {
  const leftCredits = normalizedArtistCredits(left);
  const rightCredits = normalizedArtistCredits(right);
  if (leftCredits.length === 0 || rightCredits.length === 0) return false;
  return leftCredits.join("|") === rightCredits.join("|");
};

const coverIdentity = (row) => {
  const releaseGroupId = musicBrainzId(row.musicbrainz_releasegroupid);
  if (releaseGroupId) {
    return {
      key: `${COVER_CACHE_VERSION}:release-group:${releaseGroupId.toLocaleLowerCase()}`,
      kind: "release-group",
      musicBrainzId: releaseGroupId,
    };
  }
  const releaseId = musicBrainzId(row.musicbrainz_albumid);
  if (!releaseId) return null;
  return {
    key: `${COVER_CACHE_VERSION}:release:${releaseId.toLocaleLowerCase()}`,
    kind: "release",
    musicBrainzId: releaseId,
  };
};

const coverSearchIdentity = ({ album, artist }) => {
  const normalizedAlbum = normalizedName(album);
  const normalizedArtist = normalizedName(artist);
  if (!normalizedAlbum || !normalizedArtist) return null;
  const hash = crypto
    .createHash("sha256")
    .update(`${normalizedArtist}\0${normalizedAlbum}`)
    .digest("hex");
  return {
    key: `${COVER_CACHE_VERSION}:metadata:${hash}`,
    kind: "metadata",
    musicBrainzId: `metadata:${hash}`,
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
    selected?.thumbnails?.["1200"],
    selected?.thumbnails?.large,
    selected?.thumbnails?.["500"],
    selected?.image,
    selected?.thumbnails?.["250"],
  ].map(secureCoverUrl).find(Boolean) ?? null;
};

const secureDeezerImageUrl = (value) => {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" && url.hostname === "cdn-images.dzcdn.net"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};

const pickDeezerAlbum = (payload, { album, artist }) => {
  const candidates = Array.isArray(payload?.data) ? payload.data : [];
  return candidates.find((candidate) => (
    Number.isSafeInteger(Number(candidate?.id))
    && Number(candidate.id) > 0
    && normalizedName(candidate?.title) === normalizedName(album)
    && artistCreditsMatch(candidate?.artist?.name, artist)
    && secureDeezerImageUrl(
      candidate?.cover_xl || candidate?.cover_big || candidate?.cover_medium,
    )
  )) ?? null;
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

const coverProvider = (sourceUrl) => {
  try {
    return new URL(String(sourceUrl ?? "")).hostname.endsWith("deezer.com")
      ? "deezer"
      : "cover-art-archive";
  } catch {
    return null;
  }
};

export const createAlbumCoverService = ({
  cacheDir,
  fetchImpl = globalThis.fetch,
  cacheCoverBytesImpl = cacheCoverBytes,
  now = () => Date.now(),
  userAgent = "MuroMusicElectron/0.1.0 (https://github.com/t-MURO/muro-music-electron)",
} = {}) => {
  const cacheRemoteCover = async (imageUrl, sourceUrl, provider) => {
    const imageResponse = await fetchImpl(imageUrl, { headers: { "User-Agent": userAgent } });
    if (imageResponse.status === 404) return null;
    if (!imageResponse.ok) {
      throw new Error(`${provider} image request failed (${imageResponse.status})`);
    }
    const declaredSize = Number(imageResponse.headers.get("content-length") || 0);
    if (declaredSize > MAX_DOWNLOAD_BYTES) throw new Error("Album cover is too large");
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error("Album cover is too large");
    const cached = await cacheCoverBytesImpl(bytes, cacheDir);
    return { ...cached, sourceUrl, provider };
  };

  const fetchCoverArtArchive = async (identity) => {
    const response = await fetchImpl(
      `${COVER_ART_ARCHIVE_ROOT}/${identity.kind}/${identity.musicBrainzId}`,
      { headers: { Accept: "application/json", "User-Agent": userAgent } },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Cover Art Archive request failed (${response.status})`);
    const imageUrl = pickCoverUrl(await response.json());
    if (!imageUrl) return null;
    return cacheRemoteCover(imageUrl, imageUrl, "cover-art-archive");
  };

  const fetchDeezerCover = async ({ album, artist }) => {
    if (!String(album ?? "").trim() || !String(artist ?? "").trim()) return null;
    const searchUrl = new URL(DEEZER_ALBUM_SEARCH_ROOT);
    searchUrl.searchParams.set("q", `${String(album).trim()} ${String(artist).trim()}`);
    searchUrl.searchParams.set("limit", "15");
    const response = await fetchImpl(searchUrl, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(15_000)
        : undefined,
    });
    if (!response.ok) throw new Error(`Deezer cover lookup failed (${response.status})`);
    const payload = await response.json();
    if (payload?.error) throw new Error("Deezer cover lookup failed");
    const selected = pickDeezerAlbum(payload, { album, artist });
    if (!selected) return null;
    const imageUrl = secureDeezerImageUrl(
      selected.cover_xl || selected.cover_big || selected.cover_medium,
    );
    if (!imageUrl) return null;
    return cacheRemoteCover(
      imageUrl,
      `https://www.deezer.com/album/${Number(selected.id)}`,
      "deezer",
    );
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
      key: `${COVER_CACHE_VERSION}:release-group:${releaseGroupId.toLocaleLowerCase()}`,
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

    const metadata = {
      album: String(album ?? row.album ?? "").trim(),
      artist: String(artist ?? row.album_artist ?? row.artist ?? "").trim(),
    };
    const metadataIdentity = coverSearchIdentity(metadata);
    let archiveIdentity = coverIdentity(row);
    let releaseSearchError = null;
    if (!archiveIdentity) {
      const metadataCached = metadataIdentity
        ? readCachedCover(db, metadataIdentity.key)
        : null;
      if (cachedFilesExist(metadataCached)) {
        return {
          fullPath: metadataCached.full_path,
          thumbPath: metadataCached.thumb_path,
          sourceUrl: metadataCached.source_url,
          provider: coverProvider(metadataCached.source_url),
        };
      }
      const metadataCacheIsFresh = metadataCached?.status === "not-found"
        && now() - Number(metadataCached.fetched_at) * 1_000 < NOT_FOUND_CACHE_TTL_MS;
      if (metadataCacheIsFresh) return null;
      try {
        archiveIdentity = await searchReleaseGroup(metadata);
      } catch (error) {
        releaseSearchError = error;
        console.warn("Could not search MusicBrainz for cover artwork:", error);
      }
    }
    const identity = archiveIdentity ?? metadataIdentity;
    if (!identity) return null;

    const cached = readCachedCover(db, identity.key);
    if (cachedFilesExist(cached)) {
      return {
        fullPath: cached.full_path,
        thumbPath: cached.thumb_path,
        sourceUrl: cached.source_url,
        provider: coverProvider(cached.source_url),
      };
    }
    const cacheIsFresh = cached?.status === "not-found"
      && now() - Number(cached.fetched_at) * 1_000 < NOT_FOUND_CACHE_TTL_MS;
    if (cacheIsFresh) return null;

    let result = null;
    let archiveError = null;
    if (archiveIdentity) {
      try {
        result = await fetchCoverArtArchive(archiveIdentity);
      } catch (error) {
        archiveError = error;
        console.warn("Could not fetch Cover Art Archive artwork:", error);
      }
    }
    if (!result) result = await fetchDeezerCover(metadata);
    if (!result && archiveError) throw archiveError;
    if (!result && releaseSearchError) throw releaseSearchError;
    writeCachedCover(db, identity, result, now());
    return result;
  };

  return { fetchCoverForTrack };
};
