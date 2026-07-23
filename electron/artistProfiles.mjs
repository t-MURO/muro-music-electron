import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const NOT_FOUND_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MUSICBRAINZ_INTERVAL_MS = 1_100;
const SCAN_FAILURE_BACKOFF_MS = 30 * 60 * 1_000;
const MAX_ARTIST_IMAGE_BYTES = 8 * 1024 * 1024;
const PROFILE_VERSION = 2;
const MUSICBRAINZ_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const FANART_API_ROOT = "https://webservice.fanart.tv/v3.2/music/";
const THEAUDIODB_API_ROOT = "https://www.theaudiodb.com/api/v2/json";
const LASTFM_API_ROOT = "https://ws.audioscrobbler.com/2.0/";
const DEEZER_API_ROOT = "https://api.deezer.com";
const BRAVE_IMAGE_SEARCH_ROOT = "https://api.search.brave.com/res/v1/images/search";
const BRAVE_IMAGE_RESULT_COUNT = 15;

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
    && cached.profile.imageSelection !== "manual"
    && (
      (!cached.profile.imagePath && !cached.profile.imageUrl)
      || cached.profile.imageProvider === "theaudiodb"
    )
    && !cached.profile.fanartAttempted,
  );
  const needsProfileUpgrade = cached.profile?.status === "ready"
    && cached.profile.profileVersion !== PROFILE_VERSION;
  return needsProfileUpgrade
    || shouldTryConfiguredLastFm
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

const secureWikimediaUrl = (value) => {
  const normalized = secureUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  return url.hostname === "upload.wikimedia.org" || url.hostname.endsWith(".wikimedia.org")
    ? normalized
    : null;
};

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

const cleanHtmlText = (value, maxLength = 1_000) => decodeHtmlEntities(
  String(value ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "),
)
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maxLength) || null;

const cleanLastFmText = (value) => cleanHtmlText(
  String(value ?? "")
    .replace(/<a\b[^>]*>\s*Read more(?: on Last\.fm)?\s*<\/a>/gi, " "),
  8_000,
);

const wikidataImageFile = (entity) => {
  const statements = Array.isArray(entity?.claims?.P18) ? entity.claims.P18 : [];
  const selected = statements.find((statement) => (
    statement?.rank === "preferred"
    && typeof statement?.mainsnak?.datavalue?.value === "string"
  )) ?? statements.find((statement) => (
    typeof statement?.mainsnak?.datavalue?.value === "string"
  ));
  return nonEmptyString(selected?.mainsnak?.datavalue?.value);
};

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

const artistImageCandidateId = (provider, imageUrl) => crypto
  .createHash("sha256")
  .update(`${provider}:${imageUrl}`)
  .digest("hex");

const fanartArtistImages = (payload, musicBrainzId) => (Array.isArray(payload?.artistthumb)
  ? payload.artistthumb
  : [])
  .flatMap((image) => {
    const imageUrl = secureImageUrl(image?.url);
    if (!imageUrl) return [];
    return [{
      id: artistImageCandidateId("fanart.tv", imageUrl),
      provider: "fanart.tv",
      imageUrl,
      sourceUrl: `https://fanart.tv/artist/${musicBrainzId}/`,
      attribution: "Fanart.tv contributor",
      license: null,
      licenseUrl: null,
      width: Number(image?.width ?? 0) || null,
      height: Number(image?.height ?? 0) || null,
      score: Number(image?.likes ?? 0),
    }];
  })
  .sort((left, right) => right.score - left.score || (right.width ?? 0) - (left.width ?? 0));

const theAudioDbArtistImages = (artist) => {
  const sourceUrl = nonEmptyString(artist?.idArtist)
    ? `https://www.theaudiodb.com/artist/${encodeURIComponent(artist.idArtist)}`
    : "https://www.theaudiodb.com/";
  const seen = new Set();
  return [
    [artist?.strArtistThumb, 4],
    [artist?.strArtistFanart, 3],
    [artist?.strArtistFanart2, 2],
    [artist?.strArtistFanart3, 1],
  ].flatMap(([value, score]) => {
    const imageUrl = secureImageUrl(value);
    if (!imageUrl || seen.has(imageUrl)) return [];
    seen.add(imageUrl);
    return [{
      id: artistImageCandidateId("theaudiodb", imageUrl),
      provider: "theaudiodb",
      imageUrl,
      sourceUrl,
      attribution: "TheAudioDB contributor",
      license: nonEmptyString(artist?.strCreativeCommons),
      licenseUrl: null,
      width: null,
      height: null,
      score,
    }];
  });
};

const profileArtistImage = (profile) => {
  const imageUrl = secureImageUrl(profile?.imageUrl);
  const provider = profile?.imageProvider;
  if (!imageUrl || !provider) return null;
  const sourceUrl = profile.imageSourceUrl || (provider === "wikimedia-commons"
    ? profile.wikimediaCommonsUrl
    : provider === "wikipedia"
      ? profile.wikipediaUrl
      : provider === "fanart.tv"
        ? profile.fanartUrl
        : profile.theAudioDbUrl);
  return {
    id: artistImageCandidateId(provider, imageUrl),
    provider,
    imageUrl,
    sourceUrl: secureUrl(sourceUrl),
    attribution: profile.imageAttribution ?? null,
    license: profile.imageLicense ?? null,
    licenseUrl: secureUrl(profile.imageLicenseUrl),
    width: null,
    height: null,
    score: Number.MAX_SAFE_INTEGER,
    current: true,
  };
};

const commonsArtistImage = (image) => {
  const imageUrl = secureWikimediaUrl(image?.imageUrl);
  if (!imageUrl) return null;
  return {
    id: artistImageCandidateId("wikimedia-commons", imageUrl),
    provider: "wikimedia-commons",
    imageUrl,
    sourceUrl: secureUrl(image?.commonsUrl),
    attribution: image?.attribution ?? "Wikimedia Commons contributor",
    license: image?.license ?? null,
    licenseUrl: secureUrl(image?.licenseUrl),
    width: null,
    height: null,
    score: 0,
  };
};

const wikipediaArtistImage = (summary) => {
  const imageUrl = secureWikimediaUrl(summary?.imageUrl);
  if (!imageUrl) return null;
  return {
    id: artistImageCandidateId("wikipedia", imageUrl),
    provider: "wikipedia",
    imageUrl,
    sourceUrl: secureUrl(summary?.wikipediaUrl),
    attribution: "Wikipedia contributor",
    license: null,
    licenseUrl: null,
    width: null,
    height: null,
    score: 0,
  };
};

const braveArtistImages = (payload, searchUrl) => (Array.isArray(payload?.results)
  ? payload.results
  : [])
  .flatMap((result, index) => {
    const imageUrl = secureImageUrl(result?.thumbnail?.src);
    if (!imageUrl || new URL(imageUrl).hostname.toLocaleLowerCase() !== "imgs.search.brave.com") {
      return [];
    }
    const sourceName = cleanHtmlText(
      nonEmptyString(result?.source, result?.meta_url?.hostname),
      200,
    );
    const confidenceScore = {
      high: 3,
      medium: 2,
      low: 1,
    }[String(result?.confidence ?? "").toLocaleLowerCase()] ?? 0;
    return [{
      id: artistImageCandidateId("brave-search", imageUrl),
      provider: "brave-search",
      imageUrl,
      sourceUrl: searchUrl,
      sourceName,
      title: cleanHtmlText(result?.title, 500),
      attribution: sourceName,
      license: null,
      licenseUrl: null,
      width: Number(result?.properties?.width ?? 0) || null,
      height: Number(result?.properties?.height ?? 0) || null,
      score: confidenceScore * 1_000 - index,
    }];
  });

const deezerArtistImages = (payload, requestedName) => (Array.isArray(payload?.data)
  ? payload.data
  : [])
  .flatMap((artist, index) => {
    const artistId = Number(artist?.id);
    const artistName = cleanHtmlText(artist?.name, 200);
    const imageUrl = secureImageUrl(
      artist?.picture_xl || artist?.picture_big || artist?.picture_medium,
    );
    if (
      !Number.isSafeInteger(artistId)
      || artistId <= 0
      || !artistName
      || !imageUrl
      || new URL(imageUrl).hostname.toLocaleLowerCase() !== "cdn-images.dzcdn.net"
      || new URL(imageUrl).pathname.includes("/images/artist//")
    ) {
      return [];
    }
    const exactMatch = normalizeArtistKey(artistName) === normalizeArtistKey(requestedName);
    return [{
      id: artistImageCandidateId("deezer", imageUrl),
      provider: "deezer",
      imageUrl,
      sourceUrl: `https://www.deezer.com/artist/${artistId}`,
      sourceName: artistName,
      title: `${artistName} on Deezer`,
      attribution: "Deezer",
      license: null,
      licenseUrl: null,
      width: artist?.picture_xl ? 1_000 : null,
      height: artist?.picture_xl ? 1_000 : null,
      score: (exactMatch ? 10_000 : 1_000) - index,
    }];
  })
  .sort((left, right) => right.score - left.score);

const validateCandidateImageUrl = (provider, value) => {
  const imageUrl = secureImageUrl(value);
  if (!imageUrl) return null;
  const hostname = new URL(imageUrl).hostname.toLocaleLowerCase();
  if (provider === "wikimedia-commons" || provider === "wikipedia") {
    return hostname === "upload.wikimedia.org" || hostname.endsWith(".wikimedia.org")
      ? imageUrl
      : null;
  }
  if (provider === "fanart.tv") {
    return hostname === "fanart.tv" || hostname.endsWith(".fanart.tv") ? imageUrl : null;
  }
  if (provider === "theaudiodb") {
    return hostname === "theaudiodb.com" || hostname.endsWith(".theaudiodb.com")
      ? imageUrl
      : null;
  }
  if (provider === "brave-search") {
    return hostname === "imgs.search.brave.com" ? imageUrl : null;
  }
  if (provider === "deezer") {
    return hostname === "cdn-images.dzcdn.net" ? imageUrl : null;
  }
  return null;
};

const preserveManualImage = (profile, cachedProfile) => {
  if (cachedProfile?.imageSelection !== "manual") return profile;
  return {
    ...profile,
    imagePath: cachedProfile.imagePath ?? null,
    imageUrl: cachedProfile.imageUrl ?? null,
    imageProvider: cachedProfile.imageProvider ?? null,
    imageAttribution: cachedProfile.imageAttribution ?? null,
    imageLicense: cachedProfile.imageLicense ?? null,
    imageLicenseUrl: cachedProfile.imageLicenseUrl ?? null,
    imageSourceUrl: cachedProfile.imageSourceUrl ?? null,
    imageSelection: "manual",
    wikimediaCommonsUrl: cachedProfile.wikimediaCommonsUrl ?? profile.wikimediaCommonsUrl,
    wikipediaUrl: cachedProfile.wikipediaUrl ?? profile.wikipediaUrl,
    theAudioDbUrl: cachedProfile.theAudioDbUrl ?? profile.theAudioDbUrl,
    fanartUrl: cachedProfile.fanartUrl ?? profile.fanartUrl,
  };
};

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

  const getWikidataProfile = async (resource) => {
    if (!resource) return null;
    const entityId = String(resource).match(/Q\d+/i)?.[0]?.toUpperCase();
    if (!entityId) return null;
    const data = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`);
    const entity = data?.entities?.[entityId];
    const sitelink = entity?.sitelinks?.enwiki ?? Object.entries(entity?.sitelinks ?? {})
      .find(([key]) => key.endsWith("wiki") && !key.includes("commons"))?.[1];
    let wikipediaTarget = null;
    if (sitelink?.title) {
      const languageKey = Object.entries(entity?.sitelinks ?? {})
        .find(([, value]) => value === sitelink)?.[0] ?? "enwiki";
      const language = languageKey.slice(0, -"wiki".length) || "en";
      wikipediaTarget = {
        hostname: `${language}.wikipedia.org`,
        title: sitelink.title.replace(/ /g, "_"),
        url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(sitelink.title.replace(/ /g, "_"))}`,
      };
    }
    return {
      entityId,
      wikipediaTarget,
      imageFileName: wikidataImageFile(entity),
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
      wikibaseItem: String(summary.wikibase_item ?? "").match(/Q\d+/i)?.[0]?.toUpperCase() ?? null,
    };
  };

  const fetchWikimediaCommonsImage = async (fileName) => {
    if (!fileName) return null;
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "800",
      iiextmetadatalanguage: "en",
      iiextmetadatafilter: "Artist|Credit|LicenseShortName|LicenseUrl|UsageTerms",
      titles: `File:${String(fileName).replace(/^File:/i, "")}`,
    }).toString();
    const payload = await fetchJson(url.toString());
    const page = Array.isArray(payload?.query?.pages) ? payload.query.pages[0] : null;
    const imageInfo = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
    const imageUrl = secureWikimediaUrl(imageInfo?.thumburl || imageInfo?.url);
    if (!imageUrl) return null;
    const metadata = imageInfo?.extmetadata ?? {};
    return {
      imageUrl,
      commonsUrl: secureWikimediaUrl(imageInfo?.descriptionurl)
        || `https://commons.wikimedia.org/wiki/${encodeURIComponent(`File:${fileName}`.replace(/ /g, "_"))}`,
      attribution: cleanHtmlText(metadata?.Artist?.value)
        || cleanHtmlText(metadata?.Credit?.value)
        || "Wikimedia Commons contributor",
      license: cleanHtmlText(metadata?.LicenseShortName?.value)
        || cleanHtmlText(metadata?.UsageTerms?.value)
        || "See file page for license",
      licenseUrl: secureUrl(metadata?.LicenseUrl?.value),
    };
  };

  const fetchFanartArtist = async (musicBrainzId, apiKey) => {
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
    return response.json();
  };

  const fetchFanartArtistImage = async (musicBrainzId, apiKey) => {
    const selected = pickFanartArtistImage(await fetchFanartArtist(musicBrainzId, apiKey));
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

  const fetchBraveArtistImages = async (artistName, apiKey) => {
    const normalizedArtistName = String(artistName ?? "").replaceAll('"', " ").trim();
    const query = `"${normalizedArtistName}" musician DJ artist portrait`;
    const requestUrl = new URL(BRAVE_IMAGE_SEARCH_ROOT);
    requestUrl.search = new URLSearchParams({
      q: query,
      country: "ALL",
      search_lang: "en",
      count: String(BRAVE_IMAGE_RESULT_COUNT),
      safesearch: "strict",
    }).toString();
    const response = await fetchImpl(requestUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
        "X-Subscription-Token": String(apiKey).trim(),
      },
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(15_000)
        : undefined,
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("The Brave Search API key was rejected");
    }
    if (response.status === 429) {
      throw new Error("The Brave Image Search rate limit was reached");
    }
    if (!response.ok) throw new Error(`Brave Image Search failed (${response.status})`);
    const payload = await response.json();
    const publicSearchUrl = new URL("https://search.brave.com/images");
    publicSearchUrl.searchParams.set("q", query);
    return braveArtistImages(payload, publicSearchUrl.toString());
  };

  const fetchDeezerArtistImages = async (artistName) => {
    const requestUrl = new URL(`${DEEZER_API_ROOT}/search/artist`);
    requestUrl.search = new URLSearchParams({
      q: String(artistName ?? "").trim(),
      limit: "8",
    }).toString();
    const response = await fetchImpl(requestUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
      },
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(15_000)
        : undefined,
    });
    if (!response.ok) throw new Error(`Deezer artist search failed (${response.status})`);
    const payload = await response.json();
    if (payload?.error) throw new Error("Deezer artist search failed");
    return deezerArtistImages(payload, artistName);
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
          profileVersion: PROFILE_VERSION,
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
    let wikidata = null;
    const wikidataResource = wikidataRelation(relations);
    if (wikidataResource) {
      try {
        wikidata = await getWikidataProfile(wikidataResource);
        wikipediaTarget ||= wikidata?.wikipediaTarget ?? null;
      } catch (error) {
        console.warn(`Could not load Wikidata profile for ${requestedName}:`, error);
      }
    }

    let wikipedia = null;
    try {
      wikipedia = await fetchWikipediaSummary(wikipediaTarget);
    } catch (error) {
      console.warn(`Could not load Wikipedia profile for ${requestedName}:`, error);
    }

    if (!wikidata && wikipedia?.wikibaseItem) {
      try {
        wikidata = await getWikidataProfile(wikipedia.wikibaseItem);
      } catch (error) {
        console.warn(`Could not load Wikidata image data for ${requestedName}:`, error);
      }
    }

    let wikimediaCommons = null;
    if (wikidata?.imageFileName) {
      try {
        wikimediaCommons = await fetchWikimediaCommonsImage(wikidata.imageFileName);
      } catch (error) {
        console.warn(`Could not load Wikimedia Commons image for ${requestedName}:`, error);
      }
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
    const commonsImageUrl = secureWikimediaUrl(wikimediaCommons?.imageUrl);
    const wikipediaImageUrl = secureImageUrl(wikipedia?.imageUrl);
    let fanartImageUrl = null;
    let fanartUrl = null;
    let fanartAttempted = false;
    if (!commonsImageUrl && !wikipediaImageUrl && String(fanartApiKey).trim()) {
      fanartAttempted = true;
      try {
        const fanart = await fetchFanartArtistImage(musicBrainzId, fanartApiKey);
        if (fanart) {
          fanartImageUrl = fanart.imageUrl;
          fanartUrl = fanart.fanartUrl;
        }
      } catch (error) {
        console.warn(`Could not load Fanart.tv image for ${requestedName}:`, error);
      }
    }
    const imageUrl = commonsImageUrl || wikipediaImageUrl || fanartImageUrl || premiumImageUrl;
    const imageProvider = commonsImageUrl
      ? "wikimedia-commons"
      : wikipediaImageUrl
        ? "wikipedia"
        : fanartImageUrl
          ? "fanart.tv"
          : premiumImageUrl
            ? "theaudiodb"
            : null;

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
      profileVersion: PROFILE_VERSION,
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
      imageAttribution: imageProvider === "wikimedia-commons"
        ? wikimediaCommons?.attribution ?? null
        : imageProvider === "fanart.tv"
          ? "Fanart.tv contributor"
          : imageProvider === "theaudiodb"
            ? "TheAudioDB contributor"
            : imageProvider === "wikipedia"
              ? "Wikipedia contributor"
              : null,
      imageLicense: imageProvider === "wikimedia-commons"
        ? wikimediaCommons?.license ?? null
        : imageProvider === "theaudiodb"
          ? nonEmptyString(theAudioDb?.strCreativeCommons)
          : null,
      imageLicenseUrl: imageProvider === "wikimedia-commons"
        ? wikimediaCommons?.licenseUrl ?? null
        : null,
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
      wikimediaCommonsUrl: wikimediaCommons?.commonsUrl || null,
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
        const fetchedProfile = await fetchProfile(db, requestedName, artistKey, {
          fanartApiKey,
          lastFmApiKey,
          theAudioDbApiKey,
        });
        const profile = preserveManualImage(fetchedProfile, cached?.profile);
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

  const searchImages = async (
    db,
    artistName,
    {
      braveSearchApiKey = "",
      fanartApiKey = "",
      lastFmApiKey = "",
      theAudioDbApiKey = "",
    } = {},
  ) => {
    const requestedName = String(artistName ?? "").trim();
    let profile = null;
    let profileError = null;
    try {
      profile = await getProfile(db, requestedName, {
        fanartApiKey,
        lastFmApiKey,
        theAudioDbApiKey,
      });
    } catch (error) {
      profileError = error;
    }

    const candidates = [];
    const current = profileArtistImage(profile);
    if (current) candidates.push(current);

    if (profile?.status === "ready" && profile.musicBrainzId) {
      try {
        const lookupUrl = new URL(`https://musicbrainz.org/ws/2/artist/${profile.musicBrainzId}`);
        lookupUrl.search = new URLSearchParams({ inc: "url-rels", fmt: "json" }).toString();
        const artist = await fetchMusicBrainzJson(lookupUrl.toString());
        const relations = Array.isArray(artist?.relations) ? artist.relations : [];
        let wikipediaTarget = parseWikipediaTarget(wikipediaRelation(relations));
        let wikidata = null;
        const wikidataResource = wikidataRelation(relations);
        if (wikidataResource) {
          wikidata = await getWikidataProfile(wikidataResource);
          wikipediaTarget ||= wikidata?.wikipediaTarget ?? null;
        }
        const wikipedia = await fetchWikipediaSummary(wikipediaTarget).catch(() => null);
        if (!wikidata && wikipedia?.wikibaseItem) {
          wikidata = await getWikidataProfile(wikipedia.wikibaseItem).catch(() => null);
        }
        const commons = wikidata?.imageFileName
          ? await fetchWikimediaCommonsImage(wikidata.imageFileName).catch(() => null)
          : null;
        const openImage = commonsArtistImage(commons) || wikipediaArtistImage(wikipedia);
        if (openImage) candidates.push(openImage);
      } catch (error) {
        console.warn(`Could not search Wikimedia images for ${requestedName}:`, error);
      }

      if (String(fanartApiKey).trim()) {
        try {
          const payload = await fetchFanartArtist(profile.musicBrainzId, fanartApiKey);
          candidates.push(...fanartArtistImages(payload, profile.musicBrainzId));
        } catch (error) {
          console.warn(`Could not search Fanart.tv images for ${requestedName}:`, error);
        }
      }

      if (String(theAudioDbApiKey).trim()) {
        try {
          const artist = await fetchTheAudioDbArtist(profile.musicBrainzId, theAudioDbApiKey);
          candidates.push(...theAudioDbArtistImages(artist));
        } catch (error) {
          console.warn(`Could not search TheAudioDB images for ${requestedName}:`, error);
        }
      }
    }

    try {
      candidates.push(...await fetchDeezerArtistImages(requestedName));
    } catch (error) {
      console.warn(`Could not search Deezer images for ${requestedName}:`, error);
    }

    let braveError = null;
    if (String(braveSearchApiKey).trim()) {
      try {
        candidates.push(...await fetchBraveArtistImages(requestedName, braveSearchApiKey));
      } catch (error) {
        braveError = error;
        console.warn(`Could not search Brave images for ${requestedName}:`, error);
      }
    }

    if (candidates.length === 0 && braveError) throw braveError;
    if (candidates.length === 0 && profileError) throw profileError;

    const providerRank = {
      "wikimedia-commons": 0,
      wikipedia: 1,
      "fanart.tv": 2,
      theaudiodb: 3,
      deezer: 4,
      "brave-search": 5,
    };
    const seen = new Set();
    return candidates
      .filter((candidate) => {
        if (seen.has(candidate.imageUrl)) return false;
        seen.add(candidate.imageUrl);
        return true;
      })
      .sort((left, right) => (
        Number(Boolean(right.current)) - Number(Boolean(left.current))
        || (providerRank[left.provider] ?? 99) - (providerRank[right.provider] ?? 99)
        || right.score - left.score
      ));
  };

  const setImage = async (db, artistName, candidate) => {
    const requestedName = String(artistName ?? "").trim();
    const artistKey = normalizeArtistKey(requestedName);
    if (!artistKey) throw new Error("Artist name is required");
    const cached = readCachedProfile(db, artistKey);
    if (!cached?.profile) {
      throw new Error("Load the artist profile before selecting a picture");
    }

    const provider = String(candidate?.provider ?? "");
    const imageUrl = validateCandidateImageUrl(provider, candidate?.imageUrl);
    if (!imageUrl) throw new Error("The selected artist picture URL is not allowed");

    const imagePath = await cacheArtistImage(`${artistKey}:${imageUrl}`, imageUrl);
    if (!imagePath) throw new Error("The selected artist picture could not be saved");
    const sourceUrl = secureUrl(candidate?.sourceUrl);
    const profile = {
      ...cached.profile,
      imagePath,
      imageUrl,
      imageProvider: provider,
      imageAttribution: cleanHtmlText(candidate?.attribution, 500),
      imageLicense: cleanHtmlText(candidate?.license, 200),
      imageLicenseUrl: secureUrl(candidate?.licenseUrl),
      imageSourceUrl: sourceUrl,
      imageSelection: "manual",
      wikimediaCommonsUrl: provider === "wikimedia-commons"
        ? sourceUrl
        : cached.profile.wikimediaCommonsUrl,
      wikipediaUrl: provider === "wikipedia" ? sourceUrl : cached.profile.wikipediaUrl,
      fanartUrl: provider === "fanart.tv" ? sourceUrl : cached.profile.fanartUrl,
      theAudioDbUrl: provider === "theaudiodb" ? sourceUrl : cached.profile.theAudioDbUrl,
      fetchedAt: new Date(now()).toISOString(),
    };
    writeCachedProfile(db, artistKey, requestedName, profile, now());

    const previousImagePath = cached.profile.imagePath;
    const resolvedCacheDir = path.resolve(cacheDir);
    if (
      previousImagePath
      && previousImagePath !== imagePath
      && path.resolve(previousImagePath).startsWith(`${resolvedCacheDir}${path.sep}`)
    ) {
      await fs.promises.rm(previousImagePath, { force: true }).catch(() => undefined);
    }
    return { ...profile, cacheState: "fresh" };
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

  return { loadCachedProfiles, getProfile, scanProfiles, searchImages, setImage };
};
