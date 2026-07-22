# Build 14 Visual Validation

Date: 2026-07-21

## Verified scenarios

- Staff notation at 1600×1000: score remains unobstructed at startup; opened docks consume workspace width instead of overlaying the paper.
- Compact viewport: floating state is redocked, the right dock collapses safely, and the score canvas retains usable width.
- Tonic sol-fa: physical sheet DOM, publication hierarchy, left musical facts, right credits, complete lyric rows, page footer, and Fit Width rendering are visible.
- Publication editing: title, subtitle, dedication, composer, date, arranger, lyricist, source, supporting text, and copyright are editable. Blank optional credit fields no longer clutter the page; they reveal their labels on hover/focus.
- Transcription dialog: all four selectors remain visible and the body has no horizontal overflow. Preview, diagnostics, and documented symbol table render.
- New-score wizard: four steps and the live publication preview render without clipping.
- Print: inactive staff and mixer views are excluded. A single tonic-sol-fa DOM sheet produces one Letter PDF page; the browser PDF begins with a valid PDF header.

## Automated browser result

Every browser-smoke assertion passes, including application boot, renderer output, page-aware sol-fa sheets, functional UI controls, workspace migration, parser layout, MusicXML/MXL semantic round trips, shutdown cleanup, and print generation. Runtime exceptions: 0. Console errors: 0.

## Self-critique and corrections made

The first visual pass exposed a horizontally clipped Convention selector in the transcription dialog, excessive dashed placeholders for empty publication fields, and print CSS that leaked the hidden staff score into tonic-sol-fa output. Those defects were corrected and the browser/PDF checks were rerun successfully.

The current Linux environment cannot validate Windows installer behavior, file association, upgrade, SmartScreen presentation, or uninstall cleanup. Those are release blockers rather than presumed passes.
