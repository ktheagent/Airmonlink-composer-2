# Airmonlink Composer 0.8.0 — Tonic Sol-fa Implementation Audit

Date: 2026-07-20

## Scope

This audit is the mandatory first stage before changing the Tonic Sol-fa engine. It evaluates the current 0.8.0 source against the new accuracy, page-preservation and staff-integration specification.

## Existing implementation that must be preserved

- Dedicated Tonic Sol-fa application view and navigation command.
- Existing `.airscore` settings and saved score data.
- Staff-to-sol-fa rendering from score events.
- Optional staff sol-fa overlay.
- Four-layer publication output.
- Lyrics, ties, slurs, key changes, measure boundaries and calculated rests already represented in the shared score model.
- Sol-fa-to-staff pitch editing for a selected linked note.
- Existing export-to-text foundation.

## Current symbol meanings in 0.8.0

The present implementation hard-codes the following display meanings in `src/core/solfa.js`:

- `|` is added between rendered measures by the text exporter.
- `:` is emitted before an event beginning on a later pulse.
- `.` is emitted before an event beginning on a half-pulse subdivision.
- `,` is emitted before an event beginning on a quarter- or three-quarter-pulse subdivision.
- `—` is emitted to continue durations longer than one pulse and for tied continuations.
- A non-breaking blank is used as the visible rest syllable.
- `'` and `,` are accepted by the single-syllable parser as upper- and lower-octave marks.
- Lyric `-`, `_` and `‿` are handled by lyric metadata, not by the music-duration parser.

These meanings are not yet controlled by a formal, configurable notation convention.

## Accuracy gaps found

### 1. No complete tonic-sol-fa grammar

`parseSyllable()` parses only one syllable and optional octave marks. It does not parse a complete tonic-sol-fa passage, measure, voice or line into structured timed events.

### 2. Hard-coded punctuation interpretation

`rhythmPrefix()` and `rhythmMark()` assign fixed meanings to colon, dot, comma and dash. Their meaning is not selected by convention or validated by context.

### 3. Staff-to-sol-fa is stronger than sol-fa-to-staff

Staff events can be rendered into sol-fa, but reverse editing currently changes only the pitch of one selected note. It does not construct notes, rests, ties, tuplets, measures or multiple voices from tonic-sol-fa input.

### 4. Minor-mode mapping is incomplete

Pitch conversion uses the major-scale interval table. A complete movable-do/fixed-do and do-based/la-based minor policy is not yet implemented.

### 5. Rest notation is not explicit enough

Rests are structured in the score model, but the sol-fa text renderer uses blank rhythmic space. The parser cannot yet distinguish explicit rests, hidden rests and empty layout space.

### 6. Error reporting is too general

Current verification checks pitch identity and accidental-symbol leakage. It does not yet report the exact measure, beat, voice, symbol, interpretation and suggested correction for grammar errors.

### 7. Measure validation is not parser-driven

The score model can calculate layer capacity, but tonic-sol-fa text is not parsed and validated independently against active meter, pickup length and tuplets.

### 8. On-staff controls are incomplete

The existing overlay is a global below-staff toggle. It does not yet provide above/below position, per-staff scope, convention, pitch basis, warning visibility, font size, vertical spacing or linked counterpart highlighting.

### 9. Dedicated page editing is not a full structured editor

The page renders structured score events, but it is not yet a full tonic-sol-fa text/event editor with source ranges, ambiguity markers and preview-before-replacement conversion.

### 10. Migration metadata is missing

Existing projects do not record which symbol convention produced older rendered text. A migration record is needed so old project data is preserved and potentially misinterpreted text can be revalidated rather than silently rewritten.

## Required architecture for 0.9.0

1. Add a versioned `solfaConvention` definition with token meanings and context rules.
2. Add a lexer that preserves source ranges and line/column positions.
3. Add a parser that produces structured sol-fa events.
4. Add a duration-aware voice/measure validator.
5. Add explicit ambiguity and error objects.
6. Add staff-to-sol-fa serialization from the shared score model.
7. Add sol-fa-to-staff preview and apply workflow.
8. Preserve the existing Tonic Sol-fa view and project settings.
9. Add above/below and per-staff overlay settings.
10. Add linked staff-note/sol-fa-event selection.
11. Add migration metadata and compatibility reports.
12. Add reference tests for punctuation, meter, rests, ties, tuplets, modes and round trips.

## Migration policy

- Do not remove or rename the existing Tonic Sol-fa view.
- Do not discard existing score events or lyrics.
- Existing score-derived sol-fa remains reproducible.
- Add a default legacy convention marker to older projects.
- Revalidate any stored free-form sol-fa source under the recorded convention.
- Show ambiguities to the user; do not silently reinterpret them.
- Require preview and confirmation before tonic-sol-fa text replaces staff notation.

## Completion status

Audit completed. Engine correction has not yet been declared complete. The next implementation stage is the versioned symbol table, lexer, parser and precise validation model.
