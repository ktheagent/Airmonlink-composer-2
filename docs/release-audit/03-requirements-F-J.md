# Requirements F–J

## F. Dedicated PDF
PASS requires a real compiled Windows build to export a valid multi-page PDF with correct page size, orientation, notation, lyrics, headers, footers, harmony and Tonic Sol-fa; no UI may appear in output. Cancellation, overwrite, temporary-file cleanup and failure reporting must be tested. The PDF must be opened independently and every page inspected.

## G. Numbered PNG pages
PASS requires one valid, ordered PNG per rendered page, with sufficient resolution, no duplicates, omissions or UI contamination. Batch rollback and cleanup must be tested. Every PNG must be opened and inspected.

## H. Performance
Measure cold/warm startup, score opening, note/lyric entry, dragging, scrolling, view switching, panel movement, Export opening, undo and redo. Reject permanent whole-document observers, repeated injection, duplicate listeners, runaway timers, continuous rescans or higher idle CPU. Do not approve a release that feels slower.

## I. Publishing and file safety
Re-test strict publishing URL parsing, full query preservation, invalid-command rejection, PDF/PNG signature validation, atomic single-file writes, atomic PNG rollback, concurrent-request rejection, cancellation and renderer restoration.

## J. Earlier corrected application behavior
Re-test Windows `.airscore` association and open, lyric suffix repair and verse metadata, multiple verses/hyphens/melismas, note/chord/harmony entry, undo/redo, Tonic Sol-fa, playback, page layout and breaks, workspace state, safe panel dimensions and shutdown. All statuses remain UNKNOWN until evidence is recorded.
