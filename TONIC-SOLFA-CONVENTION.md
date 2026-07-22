# Airmonlink Traditional Tonic Sol-fa Convention v1

Convention identifier: `airmonlink-traditional-v1`

The parser stores every item as a structured musical event with onset, duration, measure, beat, voice, rest status, octave, source range and continuation information.

## Syllables

- Diatonic: `d r m f s l t`
- Supported chromatic forms include `di ra me fi se le te`.
- `ti` may be shown as a display preference while the public system remains Tonic Sol-fa.

## Context-aware symbols

| Symbol | Meaning | Context |
|---|---|---|
| `'` | Raise the attached syllable by one octave | Suffix attached to a syllable |
| `,` | Lower octave, rhythmic subdivision, or shortened duration | Meaning depends on attachment and position |
| `.` | Half-pulse onset grid or half-pulse duration | Prefix versus suffix context |
| `:` | Move to the next pulse grid | Standalone rhythm prefix |
| `-` or `—` | Extend the preceding sounding event by one pulse | Standalone continuation |
| `_` | Non-sounding melisma/continuation marker | After a note or lyric |
| `|` | Close the current measure and start the next | Measure boundary |
| `0` or `z` | Timed rest | Musical event |
| `( )` | Slur or phrase start and stop | Around musical events |
| Line break | Visual line break only | It does not create a measure in v1 |

## Important distinctions

- A lyric hyphen belongs to lyric data and never changes note duration.
- An attached octave comma does not consume rhythmic time.
- A standalone sustain dash does not create another playback attack.
- A repeated syllable creates a new onset even when its pitch equals the previous note.
- An underscore does not generate pitch or playback.
- Bars do not create hidden notes or rests.

## Measure validation

Each voice/layer is totalled independently against the active time signature. Pickup measures use their configured capacity. Tuplet duration fields are supported in the event model, but an explicit public text syntax for all tuplet forms is not complete in 0.9.0.
