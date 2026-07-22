# Tonic Sol-fa source-code decision — Build 13

The Build 13 implementation retains Airmonlink Composer's canonical score model and versioned parser. No third-party Tonic Sol-fa source was copied.

## Candidates reviewed

| Candidate | Relevant capability | Licence/integration decision |
| --- | --- | --- |
| Audiolizer / Solfacity | Textual Tonic Sol-fa parsing and MIDI-oriented playback | Useful behavioural reference. Do not copy until its repository licence and tests are confirmed for the exact files used. |
| Chromatic-Solfege | JavaScript chromatic solfege notes, intervals and transposition | Potentially useful for chromatic-name fixtures; not adopted because the existing parser already has integrated rhythm, score and round-trip semantics. |
| Tonal | Maintained TypeScript/JavaScript note, interval, chord, scale, mode and key operations | Suitable future theory adapter; not a Tonic Sol-fa rhythm or publication engine. |
| VexFlow | Browser/Electron SVG and Canvas staff engraving | Suitable future renderer adapter. Not required for this focused publication correction. |
| OpenSheetMusicDisplay | MusicXML-to-browser engraving based on VexFlow | Strong read-only/import-preview candidate; direct event editing would still require an Airmonlink adapter. |
| Verovio | MusicXML/MEI conversion and SVG engraving | Strong engraving/export candidate; LGPL obligations and editing integration must be reviewed before adoption. |
| MuseScore Studio | Professional workflow and engraving reference | GPLv3. Used only as a behavioural reference; no source, branding, icons or assets were copied. |

## Decision

Build 13 improves the existing parser and renderer behind stable adapters because it already synchronizes staff events, Tonic Sol-fa, lyrics, playback, MIDI and MusicXML. Replacing it during a layout repair would create unnecessary migration and licensing risk. A later renderer evaluation should compare VexFlow, OpenSheetMusicDisplay and Verovio with event-ID mapping, offline packaging, accessibility, editing latency and licence compliance as explicit gates.

Any future reuse must record repository URL, exact version/commit, licence, attribution, maintenance status, test coverage, offline behaviour and copied or adapted files.
