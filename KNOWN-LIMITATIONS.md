# Known Limitations — Airmonlink Composer 1.0.0 Phase 2

## Release-candidate status

The Windows installer is compiled and structurally verified, but it has not been run on a Windows computer in this environment. Windows process termination after the final window closes therefore remains unverified on a real device. Under the Phase 2 completion rule, this prevents declaring the shutdown defect and Phase 2 production-final.

## Windows packaging

- The installer is unsigned and may trigger SmartScreen.
- The reused Electron runtime executable originated from the verified 0.9.1 runtime. The embedded application, UI About information, installer registration, and project package are version 1.0.0 Build 12, but Windows Explorer's executable-resource file version may still show the older runtime resource version until a freshly downloaded/signable runtime executable is stamped on Windows.
- The custom current-user installer is a genuine native Windows x64 setup program, but it is not electron-builder's NSIS output because the build environment could not resolve GitHub during the Electron download.

## Shutdown validation

- Renderer cleanup, coordinator behavior, bounded waits, and source tests passed.
- Real Task Manager process disappearance, real MIDI/audio driver release, real modal-dialog behavior, and operating-system shutdown remain untested.
- No microphone/pitch-detection engine is currently active in this release; the cleanup coordinator contains extension points for future services.

## Engraving and page layout

- The layout engine now uses rhythmic segments and vertical content profiles, but it is not yet a complete professional SMuFL engraving engine.
- Advanced automatic beaming, nested tuplets, complex cross-staff notation, multi-column frames, full skyline geometry for every engraving item, and all collision edge cases remain incomplete.
- Floating panels are managed in-window floating workspaces rather than independent native OS windows; true multi-monitor native floating-window behavior is not implemented or tested.
- Full linked-part extraction and independent part layouts remain incomplete.

## MusicXML

- Common metadata, lyrics, directions, harmony, voices, chords, pickup measures, page setup, breaks, ties/slurs, tuplets, and MXL are covered.
- Some uncommon MusicXML 4.0 elements, exact typography, all technical/ornament variants, figured bass, complete percussion/tab semantics, every offset/default-x/default-y rule, and lossless preservation of unsupported XML are not complete.
- Import reports unsupported elements, but a complete opaque round-trip preservation store is still future work.

## Playback, MIDI, and audio

- Playback uses browser/Electron synthesis rather than a complete sampled/SoundFont engine.
- Real-time MIDI recording and advanced quantization preview are incomplete.
- WAV/MP3 rendering is incomplete.
- Full articulation-aware performance and professional mixer effects are incomplete.

## Publishing and plugins

- Dedicated multi-page PDF/PNG publishing remains incomplete; system print/PDF printing and SVG export are available foundations.
- Secure executable plugin hosting is incomplete.
- The harmony generator is not yet a complete constraint-search orchestration engine.
