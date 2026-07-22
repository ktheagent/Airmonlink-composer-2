# Engineering Audit — Airmonlink Composer 1.0.0 Phase 2

## Scope

This audit covers the coordinated Phase 2 implementation: score/page placement, staff expansion, semantic chords, four layers, Composition Notepad, managed panels, metadata, anchored text, pickup measures, MusicXML, performance preservation, and deterministic shutdown.

## Root causes found

1. **Horizontal engraving was too uniform.** Earlier rendering relied heavily on measure fractions and repeated score scans rather than a reusable rhythmic-segment profile.
2. **Vertical spacing was partly fixed.** Lyrics, Tonic Sol-fa, and anchored content could require more space than a constant staff gap supplied.
3. **Chord entry lacked a complete semantic identity.** Simultaneous notes needed a shared chord ID and common onset/duration rather than only approximate x alignment.
4. **Workspace panels needed one manager.** Visibility, tab state, floating state, split dimensions, compact layouts, and View-menu checks could otherwise drift apart.
5. **Metadata/text needed stable anchors.** Composer/date and score text could not remain robust if represented only as temporary page labels or pixels.
6. **MusicXML import needed a real cursor.** Voices, chords, lyrics, directions, and pickups cannot be reconstructed by treating XML order as simple left-to-right display order.
7. **Shutdown was canceled by renderer unload behavior.** Returning a non-void value from the dirty-score unload handler in Electron blocked native closure without completing a coordinated quit.

## Architectural corrections

- Semantic score events remain authoritative.
- Layout profiles, systems, pages, item bounding regions, and playback events are derived.
- Chords use stable IDs and shared onset/duration with independently editable note members.
- Four layers remain isolated musical voices.
- Layout invalidation is separated from selection/panel/playback refresh.
- Workspace state is sanitized against viewport bounds before restoration.
- Text uses semantic anchor/scope/tick/measure plus optional visual offsets.
- MusicXML uses exact quarter-unit rational conversion and an independent cursor for every measure context.
- Shutdown uses an Electron main-process coordinator plus renderer cleanup response with bounded waits.

## UI and branding protection

The implementation preserved:

- Airmonlink Composer name and application identity
- Official logo, launcher icon, colour system, typography, gradients, and staff styling
- Existing note-entry controls and symbol keypad
- Dedicated Tonic Sol-fa page and route
- Existing navigation and workspace visual language
- Package identity `com.airmonlink.composer`
- `.airscore` project identity and format version 9

The only necessary visible lifecycle addition was File → Exit, which routes to the same shutdown coordinator as the title-bar close request. Phase 2 panel commands were added within the existing visual language requested by the Phase 2 specification.

## Data-model invariants

- Musical time is stored independently of x/y coordinates.
- One layer's duration does not consume another layer's capacity.
- A chord's pitches share staff/layer/start/duration but retain individual pitch, accidental, tie, and staff-position properties.
- Pickup actual duration is shorter than nominal meter capacity and later measure positions remain coherent.
- Visual offsets never change pitch, duration, beat, layer, or playback.
- Tonic Sol-fa, staff notation, playback, save data, and import/export derive from one score.
- Shutdown cannot be finalized twice and cannot proceed after Cancel or failed cleanup.

## Evidence

- 40 JavaScript files passed syntax validation
- 119 automated tests passed
- 70 browser interactions passed
- Runtime exceptions: 0
- Console errors: 0
- Controlled shutdown cleanup: 210.7 ms
- Windows payload ZIP: integrity passed
- Embedded application: version 1.0.0, Build 12, app ID verified
- Setup and uninstaller: PE32+ Windows x64 GUI executables

## Honest boundary

No real Windows process was launched in this environment. The installer and application payload are compiled and structurally verified, but Windows process termination, real audio/MIDI cleanup, real floating-panel close behavior, and installer/uninstaller execution are not yet device-validated. The build is therefore a release candidate, not a final Phase 2 completion declaration.
