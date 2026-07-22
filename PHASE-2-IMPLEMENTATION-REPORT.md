# Airmonlink Composer 1.0.0 — Phase 2 Implementation Report

## 1. Root causes discovered

- The pre-Phase-2 renderer did not have a sufficiently explicit page/system/staff/measure/segment coordinate hierarchy.
- Horizontal note placement needed reusable rhythmic profiles and clearance calculation rather than uniform measure fractions.
- Staff gaps needed content-driven expansion rather than only fixed constants.
- Simultaneous pitches needed one semantic chord identity.
- Panel state needed a central layout manager.
- Metadata and free text needed stable semantic anchors.
- MusicXML needed a duration-aware measure cursor and preservation report.
- The dirty-document browser unload handler prevented Electron from completing a safe native close.

## 2. MuseScore reference

Reference line: MuseScore Studio 4.7.4 / 4.7 branch, recorded build commit `7688c00`. Representative DOM, layout, notation interaction, MusicXML pass, and workspace lifecycle areas are listed in `MUSESCORE-REFERENCE-LOG.md`. Principles were independently adapted; no MuseScore code/UI/assets were copied.

## 3. MuseScore-to-project mapping

See `MUSESCORE-REFERENCE-LOG.md` for the complete table. The key mapping is semantic Score/Measure/Segment/Chord/Note/Voice concepts to Airmonlink's `score-model.js`, exact beat/duration records, stable chord IDs, four layers, derived layout profiles, history transactions, and `formats.js` MusicXML contexts.

## 4. Project files changed or added

### Semantic/model and algorithms

- `src/core/score-model.js`
- `src/core/layout-engine.js`
- `src/core/formats.js`
- `src/core/playback.js`
- `src/core/workspace-state.js`
- Existing lyrics, notation, Tonic Sol-fa, selection, history, and MIDI modules integrated without replacement.

### Desktop lifecycle

- `src/main.js`
- `src/preload.js`
- `src/desktop/shutdown-controller.js`
- `src/desktop/file-service.js`

### UI wiring

- `src/ui/app.js`
- `src/ui/index.html` only where Phase 2 controls/File Exit were required
- Existing styles/branding retained.

### Tests/tooling

- `test/v092-shutdown-lifecycle.test.js`
- `test/v100-phase2-foundations.test.js`
- `test/v100-workspace-phase2.test.js`
- Expanded browser smoke suite
- `scripts/shutdown_benchmark.py`

## 5. Chords and multi-voice behavior

Implemented:

- Stable chord ID and member-note list semantics
- Add interval above/below and add MIDI/mouse/keyboard pitch to selected chord
- Remove/move one member without deleting other members
- Shared chord onset/duration, independently editable pitch/accidental/tie/staff position
- Simultaneous playback events
- Seconds notehead displacement, inter-voice unison offset, accidental columns
- Complete-chord duration/transposition commands
- Four independent layers with separate rests/durations/playback/MusicXML voices
- Undo/redo and save/reopen foundations

## 6. Staff/page layout improvements

Implemented:

- Rhythmic segment extraction per measure
- Minimum width profiles and proportional duration spacing
- System construction with available-width fitting
- Manual system/page break handling
- Page cursor/reflow foundations
- Content profiles for lyrics, Tonic Sol-fa, text, and notation above/below staff
- Dynamic staff distances
- Manual offsets layered over automatic results
- Reset/optimize commands
- Grand-staff/choir alignment foundations

Not complete: full SMuFL engraving, every skyline collision, nested tuplets, professional automatic beaming, complex cross-staff, and all page-frame rules.

## 7. Composition Notepad

Implemented within the existing visual language. Groups include Note Entry, Pitch/Tonality, Rhythm/Measures, Expression, Text, Staff/Instruments, and Tonic Sol-fa. Sections are collapsible and connect existing controls/commands to the current score model.

## 8. View menu and panel behavior

Implemented:

- Composition Notepad, Inspector, Piano Input, Tonic Sol-fa, Mixer, playback controls, and Reset Workspace Layout
- Checked state synchronization
- Composition Notepad state persistence
- Inspector and Piano hidden by default
- Right-side tab/dock management
- Bottom piano dock
- Collapse/expand, resize, managed floating state
- Compact-screen redocking and clamped dimensions
- Canvas viewport adjustment rather than overlay

## 9. Tonic Sol-fa View integration

The existing dedicated page remains. A managed panel and optional above/below staff display use the same semantic score/Tonic Sol-fa parser. Opening or closing views never changes score data.

## 10. Composer/date and text

Implemented semantic title/subtitle/composer/arranger/lyricist/composition date/source/copyright/dedication/supporting metadata. Composer/date presentation reserves a first-page header region. Anchored text stores type, scope, staff/system/measure/tick anchor, placement/style, and user offset.

## 11. Pickup measures

Implemented validation, actual versus nominal duration, later timing shifts, rest regeneration, playback alignment, undo/redo, and MusicXML implicit measure import/export foundations.

## 12. MusicXML lyric/text corrections

Implemented:

- Exact divisions conversion and measure cursor
- `<chord/>`, `<backup>`, and `<forward>`
- Multiple staves/voices
- Multi-verse lyrics, syllabic values, elision and extend
- Composer/date/credits/rights/source
- Direction words, rehearsal, tempo, dynamics, harmony
- Page layout, manual system/page breaks, pickup measures
- Import counts/warnings/unsupported/fatal channels

## 13. Performance preservation

Selection, layer changes, panel toggles, playback highlighting, and hidden heavy views avoid unnecessary full score reconstruction. Layout profiles and lookups are cached and invalidated after score/layout mutation. Autosave is idle/debounced and panel resizing is debounced.

## 14. Shutdown ordering implemented

1. Coalesce/mark shutdown request.
2. Resolve Save/Discard/Cancel.
3. Block new score commands/jobs.
4. Settle/cancel autosave.
5. Stop playback and all audio preview nodes.
6. Send MIDI all-notes-off/all-sound-off and close ports.
7. Persist workspace/preferences.
8. Close owned dialogs, menus, drags, and managed floating panels.
9. Release file locks with bounded waits.
10. Approve native window close and normal Electron quit.

Failures/timeouts abort closure and keep the score open; structured diagnostics are retained.

## 15. Tests and commands

- `npm run validate:full`: passed
- `python scripts/shutdown_benchmark.py`: passed
- 119 automated tests
- 70 browser checks
- 0 runtime exceptions
- 0 console errors
- Windows payload/archive/checksum/PE structure verification: passed

## 16. Build status

- Source: implemented
- Static/syntax validation: passed
- Automated semantic/integration tests: passed
- Browser interaction tests: passed
- Windows application payload: compiled/assembled and verified
- Windows x64 Setup/uninstaller: compiled and structurally verified
- Physical Windows installation: not performed
- Real Windows process termination: not performed

## 17. Manual smoke testing

Browser-rendered workflows were exercised through the 70-check smoke suite, including panels, score, chords, layers, metadata, pickup, MusicXML, Tonic Sol-fa, File Exit wiring, and shutdown cleanup hooks. There was no real Windows GUI session available.

## 18. Known limitations

See `KNOWN-LIMITATIONS.md`.

## 19. Licensing

See `MUSESCORE-REFERENCE-LOG.md`. No GPL MuseScore code or assets were copied.

## 20. Completion assessment

Sections 1–26 are represented by implemented source and automated/browser tests as far as the environment permits. Phase 2 is **not declared production-complete** because the specification explicitly requires a real Windows close/process-termination test, which remains unavailable in this Linux environment.
