# MuseScore Functional Reference and Licensing Log

## Engineering purpose

MuseScore was used only as a functional reference for score-domain separation, exact musical time, chord/voice semantics, layout invalidation, MusicXML cursor behavior, panel lifecycle principles, and deterministic shutdown ordering. Airmonlink Composer's UI, branding, icons, menus, panels, staff appearance, notation style, and assets were not copied or redesigned to resemble MuseScore.

## Reproducibility reference

- Project: `musescore/MuseScore`
- Release line referenced: MuseScore Studio 4.7.4 / 4.7 release branch
- Build/commit reference recorded during investigation: `7688c00`
- Language/framework: C++ and Qt/QML
- License: GNU GPL version 3

Direct full-source checkout was blocked in this environment by intermittent GitHub/DNS access. Therefore this report does not claim a complete local recursive call trace of every current MuseScore method. Public source paths, available patches/indexes, established invariants, and Airmonlink Composer's own executable paths were used. No MuseScore source code was copied.

## Representative MuseScore areas examined as functional references

- `src/engraving/dom/score.*`
- `src/engraving/dom/measure.*`
- `src/engraving/dom/segment.*`
- `src/engraving/dom/chord.*`
- `src/engraving/dom/note.*`
- `src/engraving/dom/rest.*`
- `src/engraving/dom/lyrics.*`
- `src/engraving/dom/inputstate.*`
- Fraction/rational-duration support
- `src/notation/internal/notationinteraction.*`
- `src/engraving/layout/score/tlayout.*`
- System/shape/skyline layout concepts
- `src/importexport/musicxml/internal/musicxml/import/importmusicxmlpass1.cpp`
- `src/importexport/musicxml/internal/musicxml/import/importmusicxmlpass2.cpp`
- Dock/workspace ownership and close-lifecycle principles

## Functional call-flow principles adapted independently

### Note/chord entry

User input
→ active part/staff/layer/beat resolution
→ existing event/chord lookup
→ create note or add chord member
→ one history transaction
→ measure/rest normalization
→ affected layout invalidation
→ chord engraving offsets
→ viewport refresh
→ playback event derivation

### Staff layout

Score/layout mutation
→ measure event profiles
→ rhythmic segment minimum widths
→ system construction and forced-break handling
→ horizontal distribution
→ item bounds and chord offsets
→ vertical content profiles/staff distance
→ page placement/reflow
→ render

### MusicXML

File/container detection
→ XML parsing
→ part/measure context
→ divisions/key/time/clef/transpose updates
→ per-measure time cursor
→ chord/backup/forward handling
→ semantic notes/rests/lyrics/directions/harmony
→ normalization/import report
→ layout/playback derivation

### Shutdown

OS/window/File Exit request
→ Electron main close intercept
→ Save/Discard/Cancel decision
→ renderer cleanup request
→ block new work
→ stop playback/audio/MIDI/autosave
→ persist workspace
→ close owned UI
→ release locks with bounded waits
→ approve close
→ normal Electron event-loop exit

## MuseScore-to-Airmonlink mapping

| MuseScore concept | Airmonlink Composer equivalent | Phase 2 implementation |
|---|---|---|
| Score/MasterScore | `score` in `score-model.js` | Authoritative semantic document |
| Measure/Segment/tick | Measure records, beat/start/duration, cached timeline | Exact measure-relative and absolute musical positions |
| Staff/track/voice | Part → staff → Layer 1–4 | Four independent voices per staff |
| ChordRest/Chord/Note | Event collection with stable `chordId` and note members | Simultaneous pitches share onset/duration but remain editable |
| Fraction/TDuration | Quarter-unit durations and exact MusicXML division conversion | Avoid uncontrolled screen/floating placement logic |
| InputState | UI entry state, caret, active part/staff/layer/duration | Mouse/keyboard/MIDI/palette command resolution |
| Undo command | `history.js` checkpoints/transactions | One logical action per undo step |
| Layout invalidation | score epoch/layout signatures/cache invalidation | Full layout only after semantic/layout mutation |
| Shape/Skyline | Item bounds and vertical content profiles | Dynamic staff spacing and collision foundations |
| MusicXML pass contexts | `formats.js` part/measure cursor/import report | Voices, chords, lyrics, directions, metadata, pickup |
| Dock/workspace manager | `workspace-state.js` and UI panel manager | Managed tabs/docks, compact redocking, persistence |
| Application close lifecycle | `main.js`, `shutdown-controller.js`, renderer cleanup | Save/Discard/Cancel and bounded deterministic cleanup |

## Licensing decision

MuseScore Studio is GPLv3. Airmonlink Composer is currently private and marked `UNLICENSED`. Direct copying of substantial MuseScore implementation could create GPL derivative-work and source-disclosure obligations. This release therefore independently implements general music-theory rules, data-flow principles, invariants, and algorithms. No MuseScore files, fonts, icons, branding, UI assets, or verbatim implementation code are distributed with Airmonlink Composer.
