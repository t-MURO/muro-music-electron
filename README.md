# Muro Music Electron

Muro Music Electron is a cross-platform desktop music library and player built
with Electron, Node.js, React, and SQLite.

## Architecture

- `electron/main.mjs` owns the application lifecycle, desktop window, native
  dialogs, file protocol, and IPC handlers.
- `electron/preload.cjs` exposes a narrow, context-isolated desktop bridge.
- `electron/backend.mjs` implements library, Inbox, playlist, search, and
  recently-played operations.
- `electron/database.mjs` manages the SQLite schema and persistence layer.
- `electron/metadata.mjs` reads audio metadata, caches artwork, and writes edits
  back to source files.
- `src/desktop/*` provides the renderer-facing desktop runtime, event, path, and
  dialog APIs.
- `src/*` contains the React interface and application state.

## Requirements

- Node.js 22.6 or newer
- npm 10 or newer
- A Neo KeyFinder checkout, either at `../neo-keyfinder`, at
  `../neo-key-finder/neo-keyfinder`, or selected with `NEO_KEYFINDER_ROOT`
- The native build prerequisites documented by Neo KeyFinder; distributable
  builds also require vcpkg (the build discovers its standard local locations,
  or you can set `VCPKG_ROOT`)

## Install and verify

```sh
npm install
npm run check
npm run test:smoke
npm run test:renderer
npm run build
```

## Run and package

```sh
npm start
npm run package
npm run dist
```

The package commands build the KeyFinder engine and stage the platform binary
under `build/keyfinder` before Electron Builder runs. To use a checkout in a
different location:

```sh
NEO_KEYFINDER_ROOT=/absolute/path/to/neo-keyfinder npm run dist -- --mac
```

For development, run `npm run dev:electron`. It starts the Vite renderer, waits
for it to become reachable, launches Electron, and shuts both processes down
together. `npm run dev:renderer` remains available when only the browser-based
renderer is needed.

## Features

- Recursive folder and individual-file import into Inbox
- Full-library search and configurable table columns
- Inbox acceptance, move-back, and rejection workflows
- Playlist creation, deletion, multiselect drag-and-drop, and duplicate guards
- Recursive playlist-folder import that groups discovered playlists under one parent folder
- Persistent metadata and rating edits in SQLite and source audio files
- Cover extraction, artwork caching, manual cover replacement, and BPM/key analysis
- Queue management, playback, seeking, volume, and recently-played history
- Native file and folder pickers plus operating-system drag-and-drop

Application data is stored in Electron's per-user data directory by default.
