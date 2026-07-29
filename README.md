# Muro Music

Muro Music is a local-first desktop music library and player for
macOS, Windows, and Linux. It is designed for large personal collections,
detailed metadata work, playlist management, harmonic-mixing preparation, and
playing music on the computer or compatible devices on the local network.

The application is built with Electron, React, TypeScript, Node.js, and SQLite.
Your library database, settings, cached waveforms, and downloaded artist
information stay on your computer.

> [!NOTE]
> Muro is under active development. DJ transitions are experimental, and
> packaged builds are currently intended for testing rather than a signed
> public release.

## What Muro does

### Imports and organizes a local music library

- Import individual audio files or scan complete folders recursively.
- Drag files and folders from Finder, Explorer, or a Linux file manager into
  the application.
- Review new music in an **Inbox** before accepting it into the main library.
- Accept, reject, or move tracks back to the Inbox in batches.
- Avoid duplicate library entries when the same source file is imported again.
- Keep audio files in their existing locations during a normal import.
- Remove a track only from Muro, or explicitly delete the source file from
  disk.
- Open a track's location with **Show in Finder** on macOS or **Show in
  folder** on other platforms.

Supported import formats:

- MP3 (`.mp3`)
- FLAC (`.flac`)
- WAV (`.wav`)
- MPEG-4 audio (`.m4a`)
- AAC (`.aac`)
- Ogg Vorbis (`.ogg`)
- AIFF (`.aiff` and `.aif`)
- ALAC (`.alac`)

During import, Muro reads embedded tags and artwork and records technical
details such as duration, format, bitrate, sample rate, bit depth, and file
size.

### Browses, searches, and filters the collection

The Collection section includes:

- **All Songs**
- **Recently Played**
- **Genres**
- **Artists**
- **Albums**
- **Labels**
- **Keys**
- Regular playlists and nested playlist folders
- Smart Crates

Artist and album values in the track table are links. Selecting one opens its
artist or album page, and selecting the current track in the player returns to
the list it is playing from.

Search covers the whole library. Advanced filters can locate tracks with
missing or present album artist, album, genre, year, key, BPM, artwork, label,
or comment information.

### Provides a configurable music table

The virtualized table is suitable for large libraries. Columns can be shown,
hidden, resized, reordered, sorted, and automatically fitted. Available
columns include:

- Title, artist, album artist, and album
- Track number, track total, and disc number
- Key, BPM, genre, year, and date
- Date added, date modified, last played, and play count
- Rating and comment
- Duration, format, bitrate, sample rate, bit depth, and file size
- Source file path

Ratings support half-star values. Clicking the active rating again can clear a
track back to zero stars.

### Creates regular playlists and Smart Crates

Regular playlists support:

- Create, rename, reorder, and delete
- Add one track or a multi-track selection
- Drag tracks from the library into a playlist
- Duplicate protection
- **Play**, **Play next**, and **Add to queue** actions
- Nested playlist folders, including folder reordering and bulk moves

Smart Crates create live views from rules. Rules can match all or any
condition and can use BPM, key, genre, rating, artist, album, year, date added,
play count, or comment. Depending on the field, operators include equals,
contains, at least, at most, between, and within the last number of days.

### Imports and exports playlists

Muro imports M3U, M3U8, and PLS playlists. Playlist entries may use absolute
paths, paths relative to the playlist file, or `file:` URLs. Existing library
tracks are reused; available files that are not yet known to Muro are imported
into the Inbox.

Importing a playlist folder scans every subdirectory. Muro creates one parent
playlist folder named after the selected directory, recreates the nested
folder hierarchy below it, and places each imported playlist in its matching
folder.

An individual playlist can be exported as M3U8. The organized-library export
copies the entire collection into a portable structure:

```text
Muro Library/
├── Album Artist (or Artist)/
│   └── Album/
│       ├── Disc 1/
│       │   └── Song.ext
│       └── Disc 2/
│           └── Song.ext
└── Playlists/
    ├── Root Playlist.m3u8
    └── Nested Folder/
        └── Nested Playlist.m3u8
```

The `Disc N` level is added only for multi-disc albums. Exported playlists use
relative paths to the copied music. An optional setting switches Muro to the
exported files after a completely successful export; the original files are
not deleted.

### Edits tags, ratings, and artwork

The edit dialog supports single-track and batch changes for:

- Title, artist, album artist, and album
- Track and disc numbers and totals
- Year, genre, label, and comment
- BPM and musical key
- Rating and cover art
- MusicBrainz recording, release, and release-group IDs
- AcoustID ID

Changes are saved in SQLite and written to the source audio file when the
format and tag support allow it. File-write failures are reported without
discarding the database change. Artist and album suggestions help keep names
consistent.

Cover art is intentionally not fetched in the background. In the edit dialog,
right-click the cover field and choose **Fetch cover art**. Muro checks Cover
Art Archive and can use an exact Deezer match as a fallback. The result is
shown for review and does not silently overwrite an existing cover.

### Finds missing metadata

Right-click a track and choose **Search for metadata** to search MusicBrainz.
Muro displays the proposed values before saving and lets you choose exactly
which fields to update.

Album metadata search is available from a track's album context menu, the
album grid, and the album detail page. It matches the local tracks to a
MusicBrainz release, shows the proposed track mapping, and lets you select the
album-wide and track-specific fields to apply.

For files with poor or missing tags, **Identify with AcoustID** creates an
audio fingerprint with the bundled Chromaprint `fpcalc` program. Only the
compact fingerprint and track duration are sent to AcoustID. Candidate
recordings and proposed changes are reviewed before they are applied.

AcoustID identification requires an **application API key** created under
AcoustID's *My Applications* page. A personal user API key is not accepted for
identification lookups.

### Cleans up artist separators safely

The artist-separator maintenance tool scans both artist and album-artist
fields for names separated by `&` or `feat.` and proposes comma-separated
values. Every result is reviewed individually because some real artist names
contain an ampersand.

### Builds artist pages

Artist pages can combine biographies, tags, country information, profile
links, similar artists, and images. Muro uses the following sources:

- MusicBrainz
- Wikidata, Wikipedia, and Wikimedia Commons
- Last.fm
- TheAudioDB
- Fanart.tv
- Deezer
- Brave Image Search

No-key sources are used first where possible. Optional service keys add more
results. The artist-image chooser shows candidates for manual selection;
Brave results use strict SafeSearch. Selected images and artist profiles are
cached locally, and source or license information is retained when a provider
supplies it.

Last.fm is used for artist biography, tags, links, and similar artists, not
for artwork. Deezer is useful as an additional artist-image source and as the
on-demand album-cover fallback. When MusicBrainz, Cover Art Archive, and
Deezer cannot find an album cover, an optional Brave Image Search key adds a
manual candidate picker; web results are never applied without selection.

### Analyzes key and BPM

Muro uses the Neo KeyFinder native engine to analyze selected tracks. Analysis
can run with one stable worker, two parallel workers, or up to four workers.
Results can be displayed as:

- Standard key, such as `Am`
- Custom or Camelot notation, such as `8A`
- Combined notation
- DJ notation with a configurable separator

Custom key-code mappings are supported. By default, analysis does not modify
source-file tags. Settings can explicitly write the result to Comment,
Grouping/custom field, Initial Key, or BPM using prepend, append, or overwrite
behavior where applicable.

### Recommends harmonically compatible tracks

The **Mix Next** panel ranks tracks against the currently playing song using
Camelot-key compatibility, BPM distance, genre, and rating. It includes:

- An interactive Camelot wheel
- BPM-difference filters
- Minimum-rating filters
- Same-genre and current-playlist filters
- Sorting by best match, closest BPM, or highest rating
- Actions to play immediately, play next, or start a mix

These recommendations work independently of the experimental audio-transition
feature.

### Plays and queues music

Playback includes play/pause, previous, next, shuffle, repeat-all,
repeat-one, waveform seeking, volume, mute, and fast or accurate seek modes.
The player shows cover art, title, artist, album, BPM, key, and an editable
star rating.

The right panel separates upcoming music into two lists:

1. **Queue** contains tracks deliberately queued by the user and always has
   priority.
2. **Playing next** contains the remaining tracks from the list, album,
   playlist, or Smart Crate that started playback.

Both lists can be reordered. A track can also be dragged from Playing next
into Queue to give it priority. When Queue is empty, the Next button advances
through the current playback list. Muro records play count and recently played
history and integrates with operating-system media controls.

### Plays on local and network outputs

The output picker can switch between the system default and available local
audio devices. On the same local network, Muro can discover and play to:

- Google Cast / Chromecast receivers
- DLNA media renderers

While remote playback is active, a temporary local media server makes the
selected track available to the chosen receiver. Network discovery and
playback depend on the receiver, codec support, firewall, and local-network
configuration.

### Offers experimental DJ transitions

Enable **Experimental DJ mixing** in Settings → DJ & Mixing to add beat-grid analysis,
manual two-track mixes, and optional automatic transitions into the first
queued track. Transition lengths of 4, 8, 16, or 32 bars are available, with
an option to preserve pitch.

This feature is experimental. Mix Next recommendations remain available when
DJ transitions are disabled.

### Customizes the application

- System, light, and dark themes
- English and German interface languages
- Animated, resizable, collapsible sidebars
- Fast or accurate seeking
- Configurable SQLite database location and file name
- Search-index and cover-cache maintenance tools

## Online services

Muro is usable as a local library and player without online-service keys.
These integrations are optional:

| Service | Used for | Key required |
| --- | --- | --- |
| MusicBrainz | Track, album, and artist metadata | No |
| Cover Art Archive | On-demand album artwork | No |
| AcoustID | Fingerprint-based recording identification | Application API key |
| Wikidata / Wikipedia / Wikimedia Commons | Artist information and images | No |
| Deezer | Artist-image search and on-demand album-cover fallback | No |
| Last.fm | Artist biographies, tags, links, and similar artists | API key |
| TheAudioDB | Artist biography, genre, country, and image fallback | Premium API key |
| Fanart.tv | Final artist-artwork fallback | Project API key |
| Brave Image Search | Selectable artist images and manual album-cover fallback | API key |

API keys are stored in Muro's local application settings. Each external
service remains subject to its own API terms, availability, attribution
requirements, and rate limits.

## Local data and privacy

- The default SQLite database is `muro.db` in Electron's per-user application
  data directory. Its path and file name can be changed in Settings.
- Imported audio is referenced at its existing path unless organized-library
  export is explicitly used.
- Cover thumbnails, waveform data, artist profiles, and selected artist images
  are cached locally.
- Metadata and cover searches contact the selected external providers.
- AcoustID receives a fingerprint and duration, not the audio file.
- Cast and DLNA playback temporarily exposes the current media through the
  local network to the selected device.

Back up the SQLite database if its playlists, ratings, play counts, and library
state are important. Muro is not a substitute for backing up the audio files
themselves.

## Requirements for development

- Node.js 22.22 or newer
- npm 10 or newer
- A Neo KeyFinder checkout at one of these locations:
  - `../neo-keyfinder`
  - `../neo-key-finder/neo-keyfinder`
  - Any path supplied through `NEO_KEYFINDER_ROOT`
- The native compiler and library prerequisites required by Neo KeyFinder
- vcpkg for release builds, discoverable from a standard local location or
  supplied through `VCPKG_ROOT`

Chromaprint `fpcalc` 1.6.0 is downloaded for the current platform and
architecture by the preparation script. Its archive checksum is verified
before the executable is staged.

## Install and run for development

Install dependencies:

```sh
npm install
```

Start the complete Electron application with Vite hot reload:

```sh
npm run dev:electron
```

This command prepares `fpcalc`, builds the Neo KeyFinder sidecar, starts Vite,
waits for the renderer, launches Electron, and shuts both processes down
together.

To run only the browser renderer:

```sh
npm run dev:renderer
```

To run Electron against an existing production renderer build:

```sh
npm run build
npm start
```

## Build the final macOS DMG

The macOS build must include a Neo KeyFinder native binary for the same
architecture as the Mac performing the build.

```sh
npm install
NEO_KEYFINDER_ROOT=/absolute/path/to/neo-keyfinder npm run dist -- --mac
```

If Neo KeyFinder already exists at one of the default locations, the
environment variable can be omitted:

```sh
npm run dist -- --mac
```

The command:

1. Downloads and verifies the matching Chromaprint `fpcalc` binary if needed.
2. Builds and stages the release Neo KeyFinder sidecar.
3. Type-checks the renderer and syntax-checks the Electron and test scripts.
4. Builds the Vite renderer.
5. Runs Electron Builder and creates the macOS application and DMG.

Electron Builder writes packaged output to `dist/`. Build on Apple silicon for
an arm64 DMG and on an Intel Mac for an x64 DMG; the current sidecar staging
script targets the build machine's architecture. The current configuration
does not code-sign or notarize the application.

To create an unpacked application instead of an installer:

```sh
npm run package
```

The Electron Builder configuration also defines an NSIS installer for Windows
and an AppImage for Linux:

```sh
npm run dist -- --win
npm run dist -- --linux
```

Those builds require their platform-specific Neo KeyFinder native
prerequisites.

## Verification

Run the main static checks and test suites:

```sh
npm run check
npm run test:smoke
npm run test:renderer
npm run build
```

Run the same grouped smoke suites used by CI:

```sh
npm run test:ci:core
npm run test:ci:ui
```

The cross-platform GitHub Actions workflow is currently disabled. Its
definition is retained at `.github/ci.yml.disabled` so it can be moved back to
`.github/workflows/ci.yml` when CI is re-enabled. The Neo KeyFinder integration
suite is not part of that workflow because it requires the separate native
repository and platform toolchain.

Focused suites are also available:

```sh
npm run test:acoustid
npm run test:keyfinder
npm run test:audio-seek
npm run test:beatgrid
npm run test:mixplan
npm run test:playback-guard
npm run test:artist-separators
npm run test:library-export
npm run test:cast
npm run test:dlna
```

## Architecture

- `electron/main.mjs` owns the application lifecycle, desktop window, native
  dialogs, local file protocol, and IPC registration.
- `electron/preload.cjs` exposes a narrow, context-isolated bridge to the
  renderer.
- `electron/backend.mjs` implements desktop commands for the library,
  playlists, metadata, search, remote output, and maintenance.
- `electron/database.mjs` owns the SQLite schema, migrations, queries, and
  persistence.
- `electron/metadata.mjs` reads audio metadata, caches artwork, and writes
  supported tag changes to source files.
- `electron/artistProfiles.mjs`, `electron/albumCovers.mjs`, and
  `electron/acoustid.mjs` implement optional online metadata integrations.
- `electron/cast/` and `electron/dlna/` implement discovery and remote
  playback.
- `packages/engine-client/` provides the JavaScript client for the Neo
  KeyFinder sidecar.
- `src/desktop/` contains the renderer-facing desktop bridge.
- `src/components/`, `src/hooks/`, `src/stores/`, and `src/utils/` contain the
  React interface, workflows, application state, and shared logic.
- `tests/` contains Node and renderer smoke tests.

## License

Muro Music is licensed under the GNU Affero General Public License,
version 3 or any later version (`AGPL-3.0-or-later`). See [`LICENSE`](LICENSE)
for the complete license text.

Bundled third-party components remain subject to their own licenses. In
particular, the Neo KeyFinder native sidecar is distributed under
`AGPL-3.0-or-later`, while Chromaprint `fpcalc` is distributed under LGPL 2.1
or later. Binary distributions must include the required third-party notices
and corresponding source offers.
