import crypto from "node:crypto";

const MAX_PLAYLIST_HISTORY = 100;
const MAX_PLAYLIST_SNAPSHOTS = 50;

const parseState = (raw) => {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid playlist state");
  return {
    playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
    folders: Array.isArray(parsed.folders) ? parsed.folders : [],
  };
};

export const capturePlaylistState = (db) => {
  const folders = db.prepare(`
    SELECT id, name, parent_id, sort_order, created_at
    FROM playlist_folders
    ORDER BY parent_id, sort_order, id
  `).all().map((folder) => ({
    id: String(folder.id),
    name: String(folder.name),
    parentId: folder.parent_id == null ? null : String(folder.parent_id),
    sortOrder: Number(folder.sort_order) || 0,
    createdAt: Number(folder.created_at) || 0,
  }));
  const tracksByPlaylist = new Map();
  for (const row of db.prepare(`
    SELECT playlist_id, track_id
    FROM playlist_tracks
    ORDER BY playlist_id, position
  `).all()) {
    const playlistId = String(row.playlist_id);
    const ids = tracksByPlaylist.get(playlistId) ?? [];
    ids.push(String(row.track_id));
    tracksByPlaylist.set(playlistId, ids);
  }
  const playlists = db.prepare(`
    SELECT id, name, folder_id, sort_order, created_at
    FROM playlists
    ORDER BY folder_id, sort_order, id
  `).all().map((playlist) => ({
    id: String(playlist.id),
    name: String(playlist.name),
    folderId: playlist.folder_id == null ? null : String(playlist.folder_id),
    sortOrder: Number(playlist.sort_order) || 0,
    createdAt: Number(playlist.created_at) || 0,
    trackIds: tracksByPlaylist.get(String(playlist.id)) ?? [],
  }));
  return { playlists, folders };
};

const applyPlaylistStateChanges = (db, requestedState) => {
  const state = parseState(requestedState);
  if (state.playlists.length > 10_000 || state.folders.length > 10_000) {
    throw new Error("Playlist state is too large");
  }
  const existingTrackIds = new Set(
    db.prepare("SELECT id FROM tracks").all().map((row) => String(row.id)),
  );
  const folderIds = new Set(state.folders.map((folder) => String(folder.id)));
  const insertFolder = db.prepare(`
    INSERT INTO playlist_folders(id, name, parent_id, sort_order, created_at)
    VALUES (?, ?, NULL, ?, ?)
  `);
  const setFolderParent = db.prepare(
    "UPDATE playlist_folders SET parent_id = ? WHERE id = ?",
  );
  const insertPlaylist = db.prepare(`
    INSERT INTO playlists(id, name, folder_id, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertTrack = db.prepare(`
    INSERT INTO playlist_tracks(playlist_id, track_id, position)
    VALUES (?, ?, ?)
  `);

  db.prepare("DELETE FROM playlist_tracks").run();
  db.prepare("DELETE FROM playlists").run();
  db.prepare("DELETE FROM playlist_folders").run();

  for (const folder of state.folders) {
    insertFolder.run(
      String(folder.id),
      String(folder.name || "Playlist Folder").trim() || "Playlist Folder",
      Number(folder.sortOrder) || 0,
      Number(folder.createdAt) || Math.floor(Date.now() / 1000),
    );
  }
  for (const folder of state.folders) {
    const parentId = folder.parentId == null ? null : String(folder.parentId);
    if (parentId && parentId !== String(folder.id) && folderIds.has(parentId)) {
      setFolderParent.run(parentId, String(folder.id));
    }
  }
  for (const playlist of state.playlists) {
    const playlistId = String(playlist.id);
    const folderId = playlist.folderId == null ? null : String(playlist.folderId);
    insertPlaylist.run(
      playlistId,
      String(playlist.name || "Playlist").trim() || "Playlist",
      folderId && folderIds.has(folderId) ? folderId : null,
      Number(playlist.sortOrder) || 0,
      Number(playlist.createdAt) || Math.floor(Date.now() / 1000),
    );
    const uniqueTrackIds = [...new Set(
      (Array.isArray(playlist.trackIds) ? playlist.trackIds : [])
        .map((id) => String(id))
        .filter((id) => existingTrackIds.has(id)),
    )];
    uniqueTrackIds.forEach((trackId, position) => {
      insertTrack.run(playlistId, trackId, position);
    });
  }
};

export const applyPlaylistState = (db, requestedState) =>
  db.transaction(() => applyPlaylistStateChanges(db, requestedState))();

export const withPlaylistHistory = (db, action, mutation) => db.transaction(() => {
  const before = capturePlaylistState(db);
  const result = mutation();
  const after = capturePlaylistState(db);
  const beforeJson = JSON.stringify(before);
  const afterJson = JSON.stringify(after);
  if (beforeJson !== afterJson) {
    db.prepare("DELETE FROM playlist_history WHERE undone = 1").run();
    db.prepare(`
      INSERT INTO playlist_history(action, before_json, after_json, created_at, undone)
      VALUES (?, ?, ?, ?, 0)
    `).run(String(action || "Playlist change"), beforeJson, afterJson, new Date().toISOString());
    db.prepare(`
      DELETE FROM playlist_history
      WHERE id NOT IN (
        SELECT id FROM playlist_history ORDER BY id DESC LIMIT ?
      )
    `).run(MAX_PLAYLIST_HISTORY);
  }
  return result;
})();

export const listPlaylistHistory = (db, limit = 50) => {
  const bounded = Math.max(1, Math.min(Number(limit) || 50, MAX_PLAYLIST_HISTORY));
  const entries = db.prepare(`
    SELECT id, action, created_at, undone
    FROM playlist_history
    ORDER BY id DESC
    LIMIT ?
  `).all(bounded).map((entry) => ({
    id: Number(entry.id),
    action: String(entry.action),
    createdAt: String(entry.created_at),
    undone: Number(entry.undone) === 1,
  }));
  return {
    entries,
    canUndo: Boolean(db.prepare(
      "SELECT 1 FROM playlist_history WHERE undone = 0 ORDER BY id DESC LIMIT 1",
    ).get()),
    canRedo: Boolean(db.prepare(
      "SELECT 1 FROM playlist_history WHERE undone = 1 ORDER BY id ASC LIMIT 1",
    ).get()),
  };
};

export const undoPlaylistHistory = (db) => db.transaction(() => {
  const entry = db.prepare(`
    SELECT id, action, before_json
    FROM playlist_history
    WHERE undone = 0
    ORDER BY id DESC
    LIMIT 1
  `).get();
  if (!entry) return null;
  applyPlaylistStateChanges(db, entry.before_json);
  db.prepare("UPDATE playlist_history SET undone = 1 WHERE id = ?").run(entry.id);
  return { id: Number(entry.id), action: String(entry.action), state: capturePlaylistState(db) };
})();

export const redoPlaylistHistory = (db) => db.transaction(() => {
  const entry = db.prepare(`
    SELECT id, action, after_json
    FROM playlist_history
    WHERE undone = 1
    ORDER BY id ASC
    LIMIT 1
  `).get();
  if (!entry) return null;
  applyPlaylistStateChanges(db, entry.after_json);
  db.prepare("UPDATE playlist_history SET undone = 0 WHERE id = ?").run(entry.id);
  return { id: Number(entry.id), action: String(entry.action), state: capturePlaylistState(db) };
})();

export const createPlaylistSnapshot = (db, name) => {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("Snapshot name is required");
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO playlist_snapshots(id, name, state_json, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, trimmed.slice(0, 120), JSON.stringify(capturePlaylistState(db)), createdAt);
  db.prepare(`
    DELETE FROM playlist_snapshots
    WHERE id NOT IN (
      SELECT id FROM playlist_snapshots ORDER BY created_at DESC LIMIT ?
    )
  `).run(MAX_PLAYLIST_SNAPSHOTS);
  return { id, name: trimmed.slice(0, 120), createdAt };
};

export const listPlaylistSnapshots = (db) => db.prepare(`
  SELECT id, name, created_at
  FROM playlist_snapshots
  ORDER BY created_at DESC
`).all().map((snapshot) => ({
  id: String(snapshot.id),
  name: String(snapshot.name),
  createdAt: String(snapshot.created_at),
}));

export const restorePlaylistSnapshot = (db, snapshotId) => {
  const snapshot = db.prepare(
    "SELECT id, name, state_json FROM playlist_snapshots WHERE id = ?",
  ).get(snapshotId);
  if (!snapshot) throw new Error("Playlist snapshot was not found");
  withPlaylistHistory(db, `Restore snapshot: ${snapshot.name}`, () => {
    applyPlaylistStateChanges(db, snapshot.state_json);
  });
  return capturePlaylistState(db);
};

export const deletePlaylistSnapshot = (db, snapshotId) => {
  const result = db.prepare("DELETE FROM playlist_snapshots WHERE id = ?").run(snapshotId);
  return { deleted: result.changes > 0 };
};
