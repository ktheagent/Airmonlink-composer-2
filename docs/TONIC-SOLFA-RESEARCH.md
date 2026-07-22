# Tonic Sol-fa and Engraving Research — Build 14

Reviewed: 2026-07-21. This is an engineering review, not legal advice.

## Result

No maintained, browser-ready open-source library was found that implements the complete Curwen-style tonic-sol-fa grammar required by Airmonlink: contextual rhythm punctuation, octave marks, rests, continuations, bar validation, movable/fixed do, minor systems, linked staff conversion, multiple lyric verses, and MusicXML round trips. Airmonlink will therefore retain its independently written, tested parser and renderer. No external tonic-sol-fa source code was copied.

## Sources reviewed

| Source | Capability | Language / status | License | Decision |
|---|---|---|---|---|
| [MuseScore Studio](https://github.com/musescore/MuseScore) | Full desktop notation editor and engraving engine | C++/Qt; active | GPL-3.0-only | Do not link or copy into the currently non-GPL Electron application. MusicXML exchange with a separately installed user tool remains possible, but is not an embedded engine. |
| [MusicXML 4.0](https://www.w3.org/2021/06/musicxml40/) | Score interchange including layout, credits, lyrics, chords and compressed MXL | W3C Community Group specification | Specification terms apply | Continue standards-based import/export and strengthen layout/credit/lyric round trips. |
| [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) | Browser MusicXML rendering built over VexFlow | TypeScript; active | BSD-3-Clause | Viable future read-only rendering comparison, but not a complete interactive editor or tonic-sol-fa parser. Not integrated in Build 14. |
| [abcjs](https://github.com/paulrosen/abcjs) | ABC notation rendering, MIDI and playback | JavaScript; maintained | MIT | Useful notation reference but its data language and renderer do not meet Airmonlink's semantic editing and tonic-sol-fa requirements. Not integrated. |
| [Sibelius Add Tonic Sol-Fa plug-in](https://www.sibelius.com/download/plugins/index.html?plugin=256) | Adds tonic-sol-fa text to Sibelius scores | Sibelius ManuScript; last listed update 2014 | No reusable source license established during review | Do not copy or integrate. It also depends on Sibelius and does not provide Airmonlink's parser model. |
| [tonic.ts](https://github.com/osteele/tonic.ts) | Music theory, pitch diagrams and guitar chord calculations | TypeScript; repository available | MIT | Name is unrelated to tonic-sol-fa notation; it lacks the required grammar and publication engine. Not integrated. |

## Reliability approach

- Keep `src/core/solfa-parser.js`, `src/core/solfa.js`, and `src/core/solfa-layout.js` independently implemented.
- Treat the structured score as the single musical source of truth.
- Validate tonic-sol-fa onset and duration against exact measure capacity.
- Preserve lyric verse metadata independently from lyric text.
- Test difficult keys, major/minor systems, octave punctuation, rests, sustains, compound meter, pickups, key/time changes, multiple voices, and multi-page publication.
- Use MusicXML 4.0 for exchange rather than copying another application's internal model.

## Maintenance risks

- Historic tonic-sol-fa conventions vary. Airmonlink must keep its convention identifier versioned and never silently reinterpret stored text.
- Visual similarity to another editor is not evidence of equivalent engraving.
- Any later third-party integration requires a fresh license, security, maintenance and distribution review.
