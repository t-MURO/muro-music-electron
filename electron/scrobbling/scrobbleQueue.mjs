// Database access for the scrobble_queue table (schema in database.mjs).

export const SCROBBLE_RETRY_BASE_DELAY_MS = 30_000;
export const SCROBBLE_RETRY_MAX_DELAY_MS = 60 * 60_000;
/** Dropped rows are kept as a record of what was refused, but only this many. */
export const SCROBBLE_DROPPED_HISTORY_LIMIT = 200;

/** 30 s, 1 min, 2 min, 4 min … capped at one hour. */
export const scrobbleRetryDelayMs = (attempts) =>
  Math.min(
    SCROBBLE_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1),
    SCROBBLE_RETRY_MAX_DELAY_MS,
  );

const rowToItem = (row) => ({
  id: Number(row.id),
  service: row.service,
  trackId: row.track_id ?? null,
  startedAt: Number(row.started_at),
  artist: row.artist,
  title: row.title,
  album: row.album ?? "",
  albumArtist: row.album_artist ?? "",
  trackNumber: row.track_number ?? null,
  durationSeconds: row.duration_seconds ?? null,
  recordingMbid: row.recording_mbid ?? null,
  releaseMbid: row.release_mbid ?? null,
  attempts: Number(row.attempts),
  nextAttemptAt: Number(row.next_attempt_at),
});

/** Returns the new row id, or null when this play is already queued. */
export const enqueueScrobble = (db, service, item, now = Date.now()) => {
  const result = db
    .prepare(
      `
    INSERT OR IGNORE INTO scrobble_queue(
      service, track_id, started_at, artist, title, album, album_artist,
      track_number, duration_seconds, recording_mbid, release_mbid, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      service,
      item.trackId ?? null,
      Math.trunc(item.startedAt),
      item.artist,
      item.title,
      item.album || null,
      item.albumArtist || null,
      item.trackNumber ?? null,
      item.durationSeconds ?? null,
      item.recordingMbid ?? null,
      item.releaseMbid ?? null,
      now,
    );
  return result.changes > 0 ? Number(result.lastInsertRowid) : null;
};

/** Oldest plays first: both services want cached plays sent in order. */
export const pendingScrobbles = (db, service, limit) =>
  db
    .prepare(
      `
    SELECT * FROM scrobble_queue
    WHERE service = ? AND status = 'pending'
    ORDER BY started_at, id
    LIMIT ?
  `,
    )
    .all(service, limit)
    .map(rowToItem);

/**
 * When sending may resume after a failure. Backoff applies to the whole
 * service, so new plays wait behind older ones instead of overtaking them.
 */
export const scrobbleRetryAt = (db, service) =>
  Number(
    db
      .prepare(
        `
    SELECT MAX(next_attempt_at) AS retry_at FROM scrobble_queue
    WHERE service = ? AND status = 'pending'
  `,
      )
      .get(service)?.retry_at ?? 0,
  );

export const completeScrobbles = (db, ids) => {
  const remove = db.prepare("DELETE FROM scrobble_queue WHERE id = ?");
  db.transaction(() => {
    for (const id of ids) remove.run(id);
  })();
};

/** Schedules another attempt, backing off further the more often it failed. */
export const deferScrobbles = (db, ids, { now = Date.now(), error, minDelayMs = 0 } = {}) => {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const attempts =
    Number(
      db
        .prepare(
          `SELECT MAX(attempts) AS attempts FROM scrobble_queue WHERE id IN (${placeholders})`,
        )
        .get(...ids)?.attempts ?? 0,
    ) + 1;
  const nextAttemptAt = now + Math.max(scrobbleRetryDelayMs(attempts), minDelayMs);
  db.prepare(
    `
    UPDATE scrobble_queue
    SET attempts = attempts + 1, next_attempt_at = ?, last_error = ?
    WHERE id IN (${placeholders})
  `,
  ).run(nextAttemptAt, error ? String(error).slice(0, 500) : null, ...ids);
  return nextAttemptAt;
};

/** Stops sending plays the service will never accept, keeping the reason. */
export const dropScrobbles = (db, drops, now = Date.now()) => {
  const drop = db.prepare(
    `
    UPDATE scrobble_queue
    SET status = 'dropped', last_error = ?, finished_at = ?
    WHERE id = ? AND status = 'pending'
  `,
  );
  const prune = db.prepare(
    `
    DELETE FROM scrobble_queue
    WHERE service = ? AND status = 'dropped' AND id NOT IN (
      SELECT id FROM scrobble_queue
      WHERE service = ? AND status = 'dropped'
      ORDER BY finished_at DESC, id DESC
      LIMIT ?
    )
  `,
  );
  db.transaction(() => {
    const services = new Set();
    for (const { id, reason } of drops) {
      drop.run(String(reason ?? "Rejected").slice(0, 500), now, id);
      const service = db.prepare("SELECT service FROM scrobble_queue WHERE id = ?").get(id);
      if (service) services.add(service.service);
    }
    for (const service of services) {
      prune.run(service, service, SCROBBLE_DROPPED_HISTORY_LIMIT);
    }
  })();
};

export const scrobbleQueueSummary = (db, service) => {
  const counts = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'dropped' THEN 1 ELSE 0 END), 0) AS dropped,
      MAX(CASE WHEN status = 'pending' THEN next_attempt_at END) AS retry_at
    FROM scrobble_queue WHERE service = ?
  `,
    )
    .get(service);
  const lastDropped = db
    .prepare(
      `
    SELECT title, artist, last_error, finished_at FROM scrobble_queue
    WHERE service = ? AND status = 'dropped'
    ORDER BY finished_at DESC, id DESC
    LIMIT 1
  `,
    )
    .get(service);
  return {
    pending: Number(counts?.pending ?? 0),
    dropped: Number(counts?.dropped ?? 0),
    retryAt: Number(counts?.retry_at) || null,
    lastDropped: lastDropped
      ? {
          title: lastDropped.title,
          artist: lastDropped.artist,
          reason: lastDropped.last_error ?? "",
          droppedAt: Number(lastDropped.finished_at),
        }
      : null,
  };
};
