# Airmonlink Composer 1.1.0 Build 14 — Windows Release Candidate

Airmonlink Composer is a Windows desktop music-composition and notation application combining staff notation, four independent layers, lyrics, playback, MIDI, MusicXML, harmony assistance, and synchronized tonic sol-fa.

Build 14 continues the established application and preserves the Airmonlink identity, `.airscore` documents, application ID `com.airmonlink.composer`, independent engraving architecture, and existing user-data model.

## Build 14 highlights

- True multi-page tonic-solfa publication with whole-system pagination, manual page breaks, SATB, and multiple lyric verses
- Fit Width, Fit Page, 100%, manual zoom, resize recomputation, and print-safe transforms
- Editable and independently draggable publication text for staff and tonic-solfa layouts
- Sixteen functional command groups with compact vertical labels and three-column command lists
- Right-side panels that consume layout width instead of covering the staff
- Automatic semantic chord creation across mouse, keyboard, on-screen piano, MIDI, paste, and import
- Lyric verses 1–24 stored as metadata without contaminating lyric text
- Accurate tonic-solfa note, rest, rhythm, and punctuation output with optional staff overlay
- Print isolation so hidden staff or mixer views cannot leak into tonic-solfa output
- Windows `.airscore` file association and startup/open diagnostics for automated release validation

## Source validation

The current Windows release candidate passes:

- JavaScript syntax validation: 50 files
- Automated semantic and integration tests: 143 passed, 0 failed
- Workflow YAML 1.2 parsing

The supplied Build 14 records also document prior Linux browser-level visual and print validation. Those browser checks were not rerun in this dependency-restricted workspace.

## Run from source

```text
npm ci
npm start
```

## Validate source

```text
npm run lint
npm test
```

For the complete browser suite:

```text
npm run validate:full
```

## Build Windows artifacts

On Windows x64 with Node.js 22:

```text
npm ci
npm run dist:win
```

The candidate workflow is `.github/workflows/windows-build.yml`, named **Validate and Build Windows Release**. It is designed to produce:

- `Airmonlink-Composer-1.1.0-Build14-Setup.exe`
- `Airmonlink-Composer-1.1.0-Build14-Portable.exe`
- `SHA256SUMS.txt`
- Windows install, launch, association, uninstall, signature, and validation-summary evidence

## Release status

This source is a **Windows release candidate**, not a completed Windows release. A green Windows workflow and confirmed artifact metadata, checksums, install/launch/uninstall evidence, and feasible QA rows are still required. Human GUI, printing, MIDI/device, SmartScreen, signing, and upgrade checks must remain explicitly `BLOCKED` until corresponding evidence exists.
