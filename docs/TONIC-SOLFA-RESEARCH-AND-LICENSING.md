# Tonic Sol-fa Research, Grammar, and Licensing

## Scope

This document records the musical and licensing basis for Airmonlink Composer's structured Tonic Sol-fa model, parser, layout, conversion, and export behaviour. It is not a claim that every historical dialect of tonic sol-fa is interchangeable. The project uses a versioned convention and preserves legacy project behaviour through an explicit compatibility mode.

## Adopted convention

The canonical convention is `airmonlink-traditional-v1`. It is stored with the score when tonic sol-fa text is parsed so that saving, reopening, printing, playback, and conversion do not depend on undocumented guessing.

The adopted grammar uses:

- `d r m f s l t` for the seven diatonic scale degrees.
- Movable-do functional mapping: `d` is the major key tonic. Minor-mode interpretation must be stored explicitly and not inferred from spelling alone.