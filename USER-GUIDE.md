# Airmonlink Composer 1.0.0 Phase 2 User Guide

## Starting a score

Use **File → New Score** and complete the four-step wizard:

1. Template and ensemble
2. Key, time, tempo, pickup, measures, and page setup
3. Title, subtitle, composer, composition date, arranger, lyricist, source, and supporting text
4. Review and create

The displayed meter remains independent of an optional shorter pickup duration.

## Composition Notepad and panels

Use **View** to show or hide:

- Composition Notepad
- Inspector
- Piano Input
- Tonic Sol-fa
- Mixer
- Playback controls
- Reset Workspace Layout

Composition Notepad is the grouped notation palette on the right. Inspector and Piano Input are hidden by default. Right-side panels share a managed tab/dock area; Piano Input uses the bottom dock and reduces the score viewport rather than covering the lower staves.

## Entering notes, chords, and layers

- Choose a note/rest duration from the symbol keypad.
- Choose Layer 1, 2, 3, or 4.
- Use Chord mode or **Add Interval Above/Below** to add a pitch to the existing chord at the same beat.
- A chord shares one onset and duration but each note can be selected, moved, tied, respelled, or removed independently.
- Different layers at the same beat remain separate voices and may use different durations.

## Lyrics

- Select a note and enter Lyrics mode.
- Space applies the syllable and advances.
- Hyphen marks a continuing word.
- Underscore creates a melisma/extension.
- Verse number and syllabic state remain attached to the note through reflow, transposition, save/reopen, and MusicXML.

## Tonic Sol-fa

The dedicated Tonic Sol-fa page remains available. The View menu can also show a managed Tonic Sol-fa panel, and Staff view may show synchronized sol-fa above or below selected staves. Hiding a view never deletes the underlying data.

## Metadata and text

Edit title, composer, composition date, arranger, lyricist, source, and other credits through score properties/Inspector. Composer and composition date appear in the right-aligned first-page metadata area.

Use the Text group in Composition Notepad for staff text, system text, rehearsal marks, tempo text, chord symbols, header/footer text, or other anchored text. Dragging stores a visual offset from the musical anchor; it does not change the event's beat.

## Pickup measure

Use **Create/Configure Pickup Measure**. Choose a common duration or enter a custom quarter-note duration shorter than the nominal first measure. The command validates existing events and updates later timing, rests, playback, measure numbering foundations, and MusicXML implicit-measure state as one undoable action.

## Layout and optimization

- Optimize Current System
- Optimize Selected Range
- Optimize Complete Score
- Expand/reduce staff spacing
- Expand/reduce system spacing
- Reset manual score spacing

Optimization recalculates rhythmic spacing and staff distances while preserving semantic timing, manual breaks, page margins, and deliberate offsets unless a reset command is explicitly chosen.

## MusicXML import

Open `.musicxml`, `.xml`, or `.mxl`. The importer reports counts for parts, measures, notes/chords, voices, lyrics, text/directions, metadata, unsupported elements, warnings, and fatal errors. It uses MusicXML duration/divisions, chord, backup, and forward timing rather than screen order.

## Closing the application

Close with the title-bar X, **File → Exit**, or the operating-system close command.

- **Save** writes the current score and closes only after a successful save.
- **Discard** closes without saving the current changes.
- **Cancel** leaves the application open.

During approved shutdown, playback and preview notes stop, MIDI receives all-notes-off, autosave/timers stop, workspace preferences save, owned dialogs/panels close, document locks release, and Electron exits through its normal event loop. If cleanup times out, the application remains open and writes shutdown diagnostics rather than forcing destructive termination.

## Windows installation note

The release-candidate installer is unsigned. Windows may display SmartScreen. Verify the published SHA-256 before running it. Real Windows shutdown behavior must still be confirmed during testing.
