# Migration Notes — 0.9.1 to 1.0.0 Phase 2

## Project compatibility

No destructive musical-data migration is required.

- `.airscore` schema remains `airscore-v9`.
- Score format version remains 9.
- Existing notes, rests, exactly four layers, lyrics, ties, slurs, Tonic Sol-fa, playback, repeats, metadata, and page settings remain supported.
- New Phase 2 properties are added with safe defaults during normalization.

## New normalized fields

- Metadata: `compositionDate`, `source`, `movementTitle`, expanded supporting credits
- Measure layout: `newSystem`, `newPage`
- Chords: stable `chordId` where simultaneous member notes form a semantic chord
- Workspace state: Composition Notepad/Inspector/Tonic/Piano visibility, active right tab, collapse/floating state, safe dimensions
- Anchored text: type, anchor, scope, measure/tick/staff, placement, style, and optional offsets
- Import report: parts/measures/notes/chords/voices/lyrics/text/metadata counts, warnings, unsupported elements, and fatal errors

## Pickup measures

Existing `pickupBeats` data remains valid. The 1.0.0 command validates existing events before shortening the pickup and shifts later score positions when its duration changes.

## Chord normalization

Older scores with simultaneous notes but no chord identity remain playable. Chord-editing operations assign a stable chord ID when the user explicitly groups/adds pitches. Existing independent-layer notes are not automatically merged into chords.

## Workspace

Stored panel dimensions and floating state are sanitized against the current viewport. Invalid/off-screen floating panels are redocked on compact displays. This changes only application workspace preferences, not score data.

## Shutdown

No document migration is needed. The new lifecycle may write `shutdown.log` under the Electron user-data directory for useful structured diagnostics.
