import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const NOT_FOUND_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MUSICBRAINZ_INTERVAL_MS = 1_100;
const SCAN_FAILURE_BACKOFF_MS = 30 * 60 * 1_000;
const MAX_ARTIST_IMAGE_BYTES = 8 * 1024 * 1024;
const MUSICBRAINZ_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const FANART_API_ROOT = "https://webservice.fanart.tv/v3.2/music/";
const THEAUDIODB_API_ROOT = "https://www.theaudiodb.com/api/v2/json";
const LASTFM_API_ROOT = "https://ws.audioscrobbler.com/2.0/";

export const normalizeArtistKey = (artistName) => String(artistName ?? "")
  .normalize("NFKC")
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase();

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

const readCachedProfile = (db, artistKey) => {
  const row = db.prepare(`
    SELECT profile_json, fetched_at
    FROM artist_profiles
    WHERE artist_key = ?
  `).get(artistKey);
  if (!row) return null;
  try {
    return {
      profile: JSON.parse(row.profile_json),
      fetchedAtMs: Number(row.fetched_at) * 1_000,
    };
  } catch {
    return null;
  }
};

const writeCachedProfile = (db, artistKey, requestedName, profile, fetchedAtMs) => {
  db.prepare(`
    INSERT INTO artist_profiles(artist_key, requested_name, profile_json, fetched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(artist_key) DO UPDATE SET
      requested_name = excluded.requested_name,
      profile_json = excluded.profile_json,
      fetched_at = excluded.fetched_at
  `).run(artistKey, requestedName, JSON.stringify(profile), Math.floor(fetchedAtMs / 1_000));
};

const cachedProfileNeedsRefresh = (
  cached,
  nowMs,
  { fanartApiKey = "", lastFmApiKey = "", theAudioDbApiKey = "" } = {},
) => {
  if (!cached) return true;
  const ttlMs = cached.profile?.status === "not-found"
    ? NOT_FOUND_CACHE_TTL_MS
    : DEFAULT_CACHE_TTL_MS;
  const shouldTryConfiguredTheAudioDb = Boolean(
    String(theAudioDbApiKey).trim()
    && cached.profile?.status === "ready"
    && !cached.profile.theAudioDbAttempted,
  );
  const shouldTryConfiguredLastFm = Boolean(
    String(lastFmApiKey).trim()
    && cached.profile?.status === "ready"
    && !cached.profile.lastFmAttempted,
  );
  const shouldTryConfiguredFanart = Boolean(
    String(fanartApiKey).trim()
    && cached.profile?.status === "ready"
    && !cached.profile.imagePath
    && !cached.profile.imageUrl
    && !cached.profile.fanartAttempted,
  );
  return shouldTryConfiguredLastFm
    || shouldTryConfiguredTheAudioDb
    || shouldTryConfiguredFanart
    || nowMs - cached.fetchedAtMs >= ttlMs;
};

const findStoredMusicBrainzId = (db, artistName) => {
  const row = db.prepare(`
    SELECT musicbrainz_artistid
    FROM tracks
    WHERE LOWER(TRIM(artist)) = LOWER(TRIM(?))
      AND musicbrainz_artistid IS NOT NULL
      AND musicbrainz_artistid != ''
    LIMIT 1
  `).get(artistName);
  return String(row?.musicbrainz_artistid ?? "").match(MUSICBRAINZ_ID)?.[0] ?? null;
};

const artistScore = (artist) => Number(artist?.score ?? 0);

const pickArtist = (artists, requestedName) => {
  const requestedKey = normalizeArtistKey(requestedName);
  const exact = artists.filter((artist) => {
    if (normalizeArtistKey(artist?.name) === requestedKey) return true;
    return Array.isArray(artist?.aliases) && artist.aliases.some(
      (alias) => normalizeArtistKey(alias?.name) === requestedKey,
    );
  });
  const candidates = exact.length > 0 ? exact : artists;
  return [...candidates].sort((left, right) => artistScore(right) - artistScore(left))[0] ?? null;
};

const wikipediaRelation = (relations) => {
  const resources = (Array.isArray(relations) ? relations : [])
    .filter((relation) => relation?.type === "wikipedia")
    .map((relation) => relation?.url?.resource)
    .filter(Boolean);
  return resources.find((resource) => {
    try {
      return new URL(resource).hostname === "en.wikipedia.org";
    } catch {
      return false;
    }
  }) ?? resources[0] ?? null;
};

const wikidataRelation = (relations) => (Array.isArray(relations) ? relations : [])
  .find((relation) => relation?.type === "wikidata")
  ?.url?.resource ?? null;

const parseWikipediaTarget = (resource) => {
  try {
    const url = new URL(resource);
    if (!url.hostname.endsWith(".wikipedia.org") || !url.pathname.startsWith("/wiki/")) return null;
    return {
      hostname: url.hostname,
      title: decodeURIComponent(url.pathname.slice("/wiki/".length)),
      url: url.toString(),
    };
  } catch {
    return null;
  }
};

const imageExtension = (contentType, imageUrl) => {
  const normalizedType = String(contentType ?? "").split(";")[0].trim().toLocaleLowerCase();
  const byType = {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  }[normalizedType];
  if (byType) return byType;
  try {
    const extension = path.extname(new URL(imageUrl).pathname).toLocaleLowerCase();
    return [".gif", ".jpeg", ".jpg", ".png", ".webp"].includes(extension)
      ? extension.replace(".jpeg", ".jpg")
      : ".jpg";
  } catch {
    return ".jpg";
  }
};

const secureUrl = (value) => {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const secureImageUrl = secureUrl;

const nonEmptyString = (...values) => values
  .map((value) => String(value ?? "").trim())
  .find(Boolean) ?? null;

const decodeHtmlEntities = (value) => String(value ?? "")
  .replace(/&#(x?[0-9a-f]+);/gi, (match, code) => {
    const numeric = String(code).toLocaleLowerCase().startsWith("x")
      ? Number.parseInt(String(code).slice(1), 16)
      : Number.parseInt(String(code), 10);
    try {
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : match;
    } catch {
      return match;
    }
  })
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">");

const cleanLastFmText = (value) => decodeHtmlEntities(
  String(value ?? "")
    .replace(/<a\b[^>]*>\s*Read more(?: on Last\.fm)?\s*<\/a>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "),
)
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 8_000) || null;

const lastFmTags = (artist) => {
  const seen = new Set();
  const tags = Array.isArray(artist?.tags?.tag) ? artist.tags.tag : [];
  return tags
    .map((tag) => nonEmptyString(tag?.name))
    .filter((name) => {
      const key = name?.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
};

const lastFmSimilarArtists = (artist) => {
  const seen = new Set();
  const similar = Array.isArray(artist?.similar?.artist) ? artist.similar.artist : [];
  return similar
    .flatMap((candidate) => {
      const name = nonEmptyString(candidate?.name);
      const key = normalizeArtistKey(name);
      if (!name || !key || seen.has(key)) return [];
      seen.add(key);
      return [{
        name,
        musicBrainzId: String(candidate?.mbid ?? "").match(MUSICBRAINZ_ID)?.[0] ?? null,
        url: secureUrl(candidate?.url),
      }];
    })
    .slice(0, 8);
};

const theAudioDbGenres = (artist) => {
  const seen = new Set();
  return [artist?.strGenre, artist?.strStyle]
    .flatMap((value) => String(value ?? "").split(/[,;/]/))
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
};

const theAudioDbImage = (artist) => [
  artist?.strArtistThumb,
  artist?.strArtistFanart,
  artist?.strArtistFanart2,
  artist?.strArtistFanart3,
]
  .map(secureImageUrl)
  .find(Boolean) ?? null;

const pickFanartArtistImage = (payload) => (Array.isArray(payload?.artistthumb)
  ? payload.artistthumb
  : [])
  .map((image) => ({
    url: secureImageUrl(image?.url),
    likes: Number(image?.likes ?? 0),
    pixels: Number(image?.width ?? 0) * Number(image?.height ?? 0),
  }))
  .filter((candidate) => Boolean(candidate.url))
  .sort((left, right) => right.likes - left.likes || right.pixels - left.pixels)[0] ?? null;

export const createArtistProfileService = ({
  cacheDir,
  fetchImpl = globalThis.fetch,
  musicBrainzIntervalMs = MUSICBRAINZ_INTERVAL_MS,
  now = () => Date.now(),
  userAgent = "MuroMusicElectron/0.1.0 (https://github.com/t-MURO/muro-music-electron)",
}) => {
  const inFlight = new Map();
  const scanInFlight = new WeakMap();
  const scanRetryAfter = new Map();
  let musicBrainzChain = Promise.resolve();
  let nextMusicBrainzRequestAt = 0;

  const fetchJson = async (url) => {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
      },
    });
    if (!response.ok) throw new Error(`Request failed (${response.status}) for ${url}`);
    return response.json();
  };

  const fetchMusicBrainzJson = (url) => {
    const request = musicBrainzChain.then(async () => {
      const waitMs = Math.max(0, nextMusicBrainzRequestAt - now());
      if (waitMs > 0) await sleep(waitMs);
      nextMusicBrainzRequestAt = now() + musicBrainzIntervalMs;
      return fetchJson(url);
    });
    musicBrainzChain = request.catch(() => undefined);
    return request;
  };

  const getWikipediaTargetFromWikidata = async (resource) => {
    if (!resource) return null;
    const entityId = String(resource).match(/Q\d+/i)?.[0]?.toUpperCase();
    if (!entityId) return null;
    const data = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`);
    const entity = data?.entities?.[entityId];
    const sitelink = entity?.sitelinks?.enwiki ?? Object.entries(entity?.sitelinks ?? {})
      .find(([key]) => key.endsWith("wiki") && !key.includes("commons"))?.[1];
    if (!sitelink?.title) return null;
    const languageKey = Object.entries(entity?.sitelinks ?? {})
      .find(([, value]) => value === sitelink)?.[0] ?? "enwiki";
    const language = languageKey.slice(0, -"wiki".length) || "en";
    return {
      hostname: `${language}.wikipedia.org`,
      title: sitelink.title.replace(/ /g, "_"),
      url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(sitelink.title.replace(/ /g, "_"))}`,
    };
  };

  const fetchWikipediaSummary = async (target) => {
    if (!target) return null;
    const title = encodeURIComponent(target.title.replace(/ /g, "_"));
    const summary = await fetchJson(`https://${target.hostname}/api/rest_v1/page/summary/${title}`);
    if (!summary || summary.type === "disambiguation") return null;
    return {
      biography: summary.extract || null,
      description: summary.description || null,
      imageUrl: summary.thumbnail?.source || summary.originalimage?.source || null,
      wikipediaUrl: summary.content_urls?.desktop?.page || target.url,
    };
  };

  const fetchFanartArtistImage = async (musicBrainzId, apiKey) => {
    const normalizedApiKey = String(apiKey ?? "").trim();
    if (!normalizedApiKey) return null;
    const response = await fetchImpl(`${FANART_API_ROOT}${musicBrainzId}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
        "api-key": normalizedApiKey,
      },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Fanart.tv request failed (${response.status})`);
    const selected = pickFanartArtistImage(await response.json());
    if (!selected?.url) return null;
    return {
      imageUrl: selected.url,
      fanartUrl: `https://fanart.tv/artist/${musicBrainzId}/`,
    };
  };

  const fetchTheAudioDbArtist = async (musicBrainzId, apiKey) => {
    const normalizedApiKey = String(apiKey ?? "").trim();
    if (!normalizedApiKey) return null;
    const response = await fetchImpl(
      `${THEAUDIODB_API_ROOT}/lookup/artist_mb/${encodeURIComponent(musicBrainzId)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent,
          "X-API-KEY": normalizedApiKey,
        },
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`TheAudioDB request failed (${response.status})`);
    const payload = await response.json();
    return Array.isArray(payload?.lookup) ? payload.lookup[0] ?? null : null;
  };

  const fetchLastFmArtist = async (musicBrainzId, apiKey) => {
    const normalizedApiKey = String(apiKey ?? "").trim();
    if (!normalizedApiKey) return null;
    const url = new URL(LASTFM_API_ROOT);
    url.search = new URLSearchParams({
      method: "artist.getinfo",
      mbid: musicBrainzId,
      api_key: normalizedApiKey,
      format: "json",
      autocorrect: "1",
      lang: "en",
    }).toString();
    const response = await fetchImpl(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
      },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Last.fm request failed (${response.status})`);
    const payload = await response.json();
    if (Number(payload?.error) === 6 || !payload?.artist) return null;
    if (payload?.error) throw new Error(`Last.fm request failed (${payload.error})`);
    return payload.artist;
  };

  const cacheArtistImage = async (artistKey, imageUrl) => {
    if (!imageUrl) return null;
    const url = new URL(imageUrl);
    if (url.protocol !== "https:") return null;
    const response = await fetchImpl(url, { headers: { "User-Agent": userAgent } });
    if (!response.ok) throw new Error(`Artist image request failed (${response.status})`);
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_ARTIST_IMAGE_BYTES) throw new Error("Artist image is too large");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_ARTIST_IMAGE_BYTES) throw new Error("Artist image is too large");

    const extension = imageExtension(response.headers.get("content-type"), imageUrl);
    const fileName = `${crypto.createHash("sha256").update(artistKey).digest("hex")}${extension}`;
    const filePath = path.join(cacheDir, fileName);
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.mkdir(cacheDir, { recursive: true });
      await fs.promises.writeFile(temporaryPath, bytes);
      await fs.promises.rm(filePath, { force: true });
      await fs.promises.rename(temporaryPath, filePath);
      return filePath;
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  const fetchProfile = async (
    db,
    requestedName,
    artistKey,
    { fanartApiKey = "", lastFmApiKey = "", theAudioDbApiKey = "" } = {},
  ) => {
    let musicBrainzId = findStoredMusicBrainzId(db, requestedName);
    if (!musicBrainzId) {
      const searchUrl = new URL("https://musicbrainz.org/ws/2/artist/");
      searchUrl.search = new URLSearchParams({
        query: requestedName,
        dismax: "true",
        fmt: "json",
        limit: "5",
      }).toString();
      const search = await fetchMusicBrainzJson(searchUrl.toString());
      const artist = pickArtist(Array.isArray(search?.artists) ? search.artists : [], requestedName);
      if (!artist?.id || artistScore(artist) < 70) {
        return {
          artistKey,
          requestedName,
          name: requestedName,
          status: "not-found",
          fetchedAt: new Date(now()).toISOString(),
        };
      }
      musicBrainzId = artist.id;
    }

    const lookupUrl = new URL(`https://musicbrainz.org/ws/2/artist/${musicBrainzId}`);
    lookupUrl.search = new URLSearchParams({ inc: "url-rels+genres", fmt: "json" }).toString();
    const artist = await fetchMusicBrainzJson(lookupUrl.toString());
    const relations = Array.isArray(artist?.relations) ? artist.relations : [];
    let wikipediaTarget = parseWikipediaTarget(wikipediaRelation(relations));
    if (!wikipediaTarget) {
      wikipediaTarget = await getWikipediaTargetFromWikidata(wikidataRelation(relations));
    }

    let wikipedia = null;
    try {
      wikipedia = await fetchWikipediaSummary(wikipediaTarget);
    } catch (error) {
      console.warn(`Could not load Wikipedia profile for ${requestedName}:`, error);
    }

    let lastFm = null;
    let lastFmAttempted = false;
    if (String(lastFmApiKey).trim()) {
      lastFmAttempted = true;
      try {
        lastFm = await fetchLastFmArtist(musicBrainzId, lastFmApiKey);
      } catch (error) {
        console.warn(`Could not load Last.fm profile for ${requestedName}:`, error);
      }
    }

    let theAudioDb = null;
    let theAudioDbAttempted = false;
    if (String(theAudioDbApiKey).trim()) {
      theAudioDbAttempted = true;
      try {
        theAudioDb = await fetchTheAudioDbArtist(musicBrainzId, theAudioDbApiKey);
      } catch (error) {
        console.warn(`Could not load TheAudioDB profile for ${requestedName}:`, error);
      }
    }

    const premiumImageUrl = theAudioDbImage(theAudioDb);
    const wikipediaImageUrl = secureImageUrl(wikipedia?.imageUrl);
    let imageUrl = wikipediaImageUrl || premiumImageUrl;
    let imageProvider = wikipediaImageUrl
      ? "wikipedia"
      : premiumImageUrl
        ? "theaudiodb"
        : null;
    let fanartUrl = null;
    let fanartAttempted = false;
    if (!imageUrl && String(fanartApiKey).trim()) {
      fanartAttempted = true;
      try {
        const fanart = await fetchFanartArtistImage(musicBrainzId, fanartApiKey);
        if (fanart) {
          imageUrl = fanart.imageUrl;
          imageProvider = "fanart.tv";
          fanartUrl = fanart.fanartUrl;
        }
      } catch (error) {
        console.warn(`Could not load Fanart.tv image for ${requestedName}:`, error);
      }
    }

    let imagePath = null;
    if (imageUrl) {
      try {
        imagePath = await cacheArtistImage(artistKey, imageUrl);
      } catch (error) {
        console.warn(`Could not cache artist image for ${requestedName}:`, error);
      }
    }

    const musicBrainzGenres = (Array.isArray(artist?.genres) ? artist.genres : [])
      .map((genre) => genre?.name)
      .filter(Boolean)
      .slice(0, 8);
    const premiumGenres = theAudioDbGenres(theAudioDb);
    const lastFmGenres = lastFmTags(lastFm);
    const similarArtists = lastFmSimilarArtists(lastFm);
    const theAudioDbId = nonEmptyString(theAudioDb?.idArtist);

    return {
      artistKey,
      requestedName,
      name: artist?.name || requestedName,
      sortName: artist?.["sort-name"] || null,
      disambiguation: artist?.disambiguation || null,
      status: "ready",
      type: artist?.type || null,
      country: artist?.country || nonEmptyString(theAudioDb?.strCountry),
      area: artist?.area?.name || artist?.["begin-area"]?.name || null,
      begin: artist?.["life-span"]?.begin
        || nonEmptyString(theAudioDb?.intFormedYear, theAudioDb?.intBornYear),
      end: artist?.["life-span"]?.end || null,
      ended: Boolean(artist?.["life-span"]?.ended),
      genres: musicBrainzGenres.length > 0
        ? musicBrainzGenres
        : lastFmGenres.length > 0
          ? lastFmGenres
          : premiumGenres,
      description: wikipedia?.description || null,
      biography: wikipedia?.biography
        || cleanLastFmText(lastFm?.bio?.content)
        || cleanLastFmText(lastFm?.bio?.summary)
        || nonEmptyString(theAudioDb?.strBiography, theAudioDb?.strBiographyEN),
      imagePath,
      imageUrl,
      imageProvider,
      lastFmAttempted,
      lastFmUrl: secureUrl(lastFm?.url),
      similarArtists,
      theAudioDbAttempted,
      theAudioDbId,
      theAudioDbUrl: theAudioDbId ? `https://www.theaudiodb.com/artist/${theAudioDbId}` : null,
      fanartAttempted,
      musicBrainzId,
      musicBrainzUrl: `https://musicbrainz.org/artist/${musicBrainzId}`,
      wikipediaUrl: wikipedia?.wikipediaUrl || wikipediaTarget?.url || null,
      fanartUrl,
      fetchedAt: new Date(now()).toISOString(),
    };
  };

  const loadCachedProfiles = (db) => db
    .prepare("SELECT profile_json FROM artist_profiles ORDER BY requested_name COLLATE NOCASE")
    .all()
    .flatMap((row) => {
      try {
        return [JSON.parse(row.profile_json)];
      } catch {
        return [];
      }
    });

  const getProfile = async (
    db,
    artistName,
    { force = false, fanartApiKey = "", lastFmApiKey = "", theAudioDbApiKey = "" } = {},
  ) => {
    const requestedName = String(artistName ?? "").trim();
    const artistKey = normalizeArtistKey(requestedName);
    if (!artistKey) throw new Error("Artist name is required");

    const cached = readCachedProfile(db, artistKey);
    if (!force && !cachedProfileNeedsRefresh(cached, now(), {
      fanartApiKey,
      lastFmApiKey,
      theAudioDbApiKey,
    })) {
      return { ...cached.profile, cacheState: "fresh" };
    }

    const requestKey = [
      artistKey,
      String(lastFmApiKey).trim() ? "lastfm" : "no-lastfm",
      String(theAudioDbApiKey).trim() ? "theaudiodb" : "no-theaudiodb",
      String(fanartApiKey).trim() ? "fanart" : "no-fanart",
    ].join(":");
    if (inFlight.has(requestKey)) return inFlight.get(requestKey);
    const pending = (async () => {
      try {
        const profile = await fetchProfile(db, requestedName, artistKey, {
          fanartApiKey,
          lastFmApiKey,
          theAudioDbApiKey,
        });
        writeCachedProfile(db, artistKey, requestedName, profile, now());
        return { ...profile, cacheState: "fresh" };
      } catch (error) {
        if (cached) return { ...cached.profile, cacheState: "stale" };
        throw error;
      }
    })();
    inFlight.set(requestKey, pending);
    try {
      return await pending;
    } finally {
      inFlight.delete(requestKey);
    }
  };

  const scanProfiles = async (
    db,
    { fanartApiKey = "", lastFmApiKey = "", theAudioDbApiKey = "", limit = 25 } = {},
  ) => {
    if (scanInFlight.has(db)) return scanInFlight.get(db);
    const pending = (async () => {
      const artistRows = db.prepare(`
        SELECT artist, MAX(COALESCE(added_at, 0)) AS newest_track
        FROM tracks
        WHERE artist IS NOT NULL AND TRIM(artist) != ''
        GROUP BY LOWER(TRIM(artist))
        ORDER BY newest_track DESC, artist COLLATE NOCASE
      `).all();
      const seen = new Set();
      const artists = artistRows.flatMap((row) => {
        const name = String(row.artist ?? "").trim();
        const artistKey = normalizeArtistKey(name);
        if (!artistKey || seen.has(artistKey)) return [];
        seen.add(artistKey);
        return [{ name, artistKey }];
      });
      const cachedRows = db.prepare("SELECT artist_key, profile_json, fetched_at FROM artist_profiles").all();
      const cachedByArtist = new Map(cachedRows.flatMap((row) => {
        try {
          return [[row.artist_key, {
            profile: JSON.parse(row.profile_json),
            fetchedAtMs: Number(row.fetched_at) * 1_000,
          }]];
        } catch {
          return [];
        }
      }));
      // Background scans only discover artists that have never been cached.
      // Existing profiles are refreshed on demand when their artist page opens.
      const due = artists.filter(({ artistKey }) => !cachedByArtist.has(artistKey));
      const scanStartedAt = now();
      const eligible = due.filter(({ artistKey }) => (
        scanRetryAfter.get(artistKey) ?? 0
      ) <= scanStartedAt);
      const batchLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 25)));
      const batch = eligible.slice(0, batchLimit);
      let updated = 0;
      let failed = 0;
      for (const artist of batch) {
        try {
          const profile = await getProfile(db, artist.name, {
            fanartApiKey,
            lastFmApiKey,
            theAudioDbApiKey,
          });
          if (profile.cacheState === "stale") {
            failed += 1;
            scanRetryAfter.set(artist.artistKey, now() + SCAN_FAILURE_BACKOFF_MS);
          } else {
            updated += 1;
            scanRetryAfter.delete(artist.artistKey);
          }
        } catch {
          failed += 1;
          scanRetryAfter.set(artist.artistKey, now() + SCAN_FAILURE_BACKOFF_MS);
        }
      }
      return {
        checked: batch.length,
        updated,
        failed,
        queued: Math.max(0, eligible.length - batch.length),
        remaining: Math.max(0, due.length - updated),
        totalArtists: artists.length,
      };
    })();
    scanInFlight.set(db, pending);
    try {
      return await pending;
    } finally {
      scanInFlight.delete(db);
    }
  };

  return { loadCachedProfiles, getProfile, scanProfiles };
};
