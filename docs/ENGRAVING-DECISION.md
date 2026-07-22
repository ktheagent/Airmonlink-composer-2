# Engraving Decision — Build 14

## Decision

Airmonlink Composer selects **Route B: an independent professional engraving engine**.

The application must not claim that it uses “exactly MuseScore” or that its output is MuseScore-identical. MuseScore Studio is GPL-3.0-only, is implemented as a large C++/Qt desktop application, and is not a drop-in JavaScript layout component. Embedding or linking its engraving source into the current application would create material architecture and licensing obligations that have not been authorized or satisfied.

## Build 14 direction

- Continue the independent structured score model and SVG renderer.
- Use MusicXML 4.0 as the interoperability boundary.
- Implement and test page geometry, rhythmic spacing, beams, stems, chord notehead collisions, accidental columns, rests, voices, ledgers, clefs, key/time signatures, barlines, system breaks, justification, lyrics, ties, slurs, tuplets, grace notes, repeats, endings, brackets and braces.
- Maintain visual regression fixtures derived from Airmonlink test scores and documented engraving rules, not copied application screenshots or proprietary assets.
- Describe results as “professional independent engraving” only when the corresponding completion-matrix evidence passes.

## Future optional workflow

A future feature may export MusicXML and let a user open it in their separately installed MuseScore application. That would be an exchange workflow, not an embedded MuseScore layout engine, and must be described honestly.

## Sources

- [MuseScore Studio official repository and GPL-3.0-only source headers](https://github.com/musescore/MuseScore)
- [MusicXML 4.0 specification](https://www.w3.org/2021/06/musicxml40/)
- [OpenSheetMusicDisplay official repository](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay)
- [abcjs official repository](https://github.com/paulrosen/abcjs)
