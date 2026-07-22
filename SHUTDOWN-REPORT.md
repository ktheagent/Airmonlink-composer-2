# Critical Shutdown Defect Report — Airmonlink Composer 1.0.0

## Defect classification

Release-blocking regression: closing the main window could fail to terminate the Electron application.

## Exact root cause

The renderer used a dirty-document `beforeunload` return value as if it were a normal browser confirmation. In Electron, this could cancel the close event without completing the application's Save/Discard/Cancel and resource-cleanup lifecycle. The main window could appear to close or refuse closure while Electron/background resources remained alive.

Additional lifecycle risks included duplicate close requests, autosave still pending, playback/audio nodes, MIDI ports/callbacks, document locks, managed floating panels, and a quit request arriving while a save dialog was open.

## Files and lifecycle handlers changed

- `src/main.js`: window close, before-quit, native unsaved prompt, coordinator, logs, final close
- `src/preload.js`: shutdown request/response IPC and close-command bridge
- `src/desktop/shutdown-controller.js`: deduplication, bounded wait, timeout extension, approval/cancel/reset
- `src/ui/app.js`: renderer cleanup sequence and File → Exit wiring
- `src/core/playback.js`: deterministic interval/oscillator/AudioContext cleanup
- MIDI and file-lock cleanup integrated through existing services
- `scripts/shutdown_benchmark.py`: deterministic cleanup benchmark
- `test/v092-shutdown-lifecycle.test.js`: lifecycle regressions

## Shutdown flow

OS title-bar X / File → Exit / app quit
→ main-window close intercept
→ duplicate-request guard
→ dirty-score state query
→ native Save/Discard/Cancel
→ renderer cleanup IPC
→ block new edits
→ stop/cancel autosave
→ stop playback and audio preview nodes
→ MIDI all-notes-off/all-sound-off and port close
→ persist workspace/preferences
→ close owned dialogs/menus/floating states
→ release document locks with bounded wait
→ renderer approves
→ main process allows window close
→ Electron event loop exits normally

## Bounded waits

- Renderer coordinator default: 15 seconds
- Save dialog extension: up to 5 minutes while the user selects a path
- Post-save cleanup: 15 seconds
- Autosave settle: 1.2 seconds
- Playback/audio shutdown: 1.8 seconds
- MIDI port close: 1.8 seconds
- Workspace persistence: 2.2 seconds
- File-lock release: bounded by main-process coordinator

A timeout or cleanup error leaves the application open and reports the failed stage. Forced process termination is not the normal solution.

## Unsaved choices

- Save: closes only after successful save and cleanup
- Discard: closes without saving current changes
- Cancel: resets the close coordinator and keeps the application open
- Save failure: keeps application open

## Panel-specific behavior

Managed Composition Notepad, Inspector, Tonic Sol-fa, and Piano panels are application-owned workspace panels. Shutdown closes dialogs/menus, cancels drags, clears managed floating state, and then persists/tears down in deterministic order. Compact layouts redock floating state before normal use.

## Automated/source tests performed

- No score / unchanged score coordinator path
- Dirty score Save/Discard/Cancel state machine
- Duplicate close request
- Save-dialog timeout extension
- Cleanup timeout/error abort
- Playback active and sounding-note cleanup
- MIDI all-notes-off and port-close path
- Autosave/timer cancellation
- Workspace save ordering
- Dialog/menu/floating-state cleanup
- Title-bar close/File Exit shared path
- Document lock bounded release
- Repeated shutdown request safety

## Measured controlled shutdown time

`SHUTDOWN-BENCHMARK.json` records a 210.7 ms renderer cleanup request in a deterministic browser harness, including a 40 ms playback warm-up. Individual cleanup stages were sub-millisecond apart from harness/setup overhead.

This is **not** a Windows Task Manager process-exit measurement.

## Windows process confirmation

Not performed. The Windows Setup and application payload were compiled, but this Linux environment cannot run them. Therefore final confirmation that `Airmonlink Composer.exe` disappears from Task Manager after X/File Exit/Save/Discard remains outstanding.

## Scenarios not device-tested

- Real Windows title-bar X
- Real File → Exit
- Save/Discard/Cancel with native Windows dialogs
- Closing during real MIDI/audio device use
- Multiple monitors/floating native windows
- OS shutdown/logoff
- Reopening and workspace restoration after an actual installed close

## Completion assessment

The source defect is corrected and automated/browser lifecycle validation passes. The issue must remain marked **device verification pending** until the Windows process-termination matrix passes on a real Windows installation.
