# Build Report — Airmonlink Composer 1.0.0 Phase 2

Date: 2026-07-21  
Version: 1.0.0  
Build: 12  
Target: Windows x64

## Source validation

Command:

```text
npm run validate:full
python scripts/shutdown_benchmark.py
```

Results:

- JavaScript syntax: 40 files passed
- Automated tests: 119 passed, 0 failed
- Browser interaction checks: 70 passed, 0 failed
- Runtime JavaScript exceptions: 0
- Browser console errors: 0
- Preview generation: passed
- Controlled renderer shutdown cleanup: 210.7 ms

## Standard Electron build attempt

`npm run dist:win` was attempted. The shell could not resolve `github.com` while electron-builder attempted to download Electron, producing `getaddrinfo EAI_AGAIN github.com`.

This network failure was not reported as a successful electron-builder build.

## Windows application payload

A previously verified official Electron 37.10.3 Windows x64 runtime was reused. Its `resources/app.asar` was replaced with the validated 1.0.0 Build 12 application archive.

Payload verification:

- Windows payload files: 78
- Application executable: PE32+ Windows x86-64 GUI
- `resources/app.asar` files: 33
- Embedded package version: 1.0.0
- Embedded build number: 12
- Embedded app ID: `com.airmonlink.composer`
- Payload ZIP integrity: passed
- Payload ZIP SHA-256: `2bd78a729c4828286b02a6c87b7690a403804d41b7f69f41cdfbe9f28858da83`

## Installer compiler

A native Windows x64 Setup program and uninstaller were cross-compiled from audited Go source. The Setup program embeds the complete Electron application payload and validates the payload and uninstaller checksums before installation.

Setup behavior:

- Current-user installation
- Default `%LOCALAPPDATA%\Programs\Airmonlink Composer`
- Optional installation parent selection
- Running-process check
- Staged extraction and atomic activation
- Desktop and Start Menu shortcuts
- Add/Remove Programs registration
- `.airscore` file association and open command
- Official installed application icon for shortcuts/file association
- Launch-after-install option
- Installation log
- Separate uninstaller that preserves user scores and application data

Artifacts:

- Setup: `Airmonlink-Composer-1.0.0-Phase-2-Windows-x64-Setup.exe`
- Setup SHA-256: `5460a132fd9ff296a02a799b5c5e1005d1df67e068ee9f55c36bd99d5d59d6fe`
- Uninstaller SHA-256: `4f75e73dffc02c1aefb5fe22151f811a47ff8d2a5dee29dfd26c8bf0a88cd8a2`
- Portable ZIP SHA-256: `bf9226500da27905cee62ea5c5770f2168a782b3ccc411e7b150918fee9d7984`

## Structural verification

- Setup executable: PE32+ Windows 6.1+ GUI, x86-64
- Uninstaller: PE32+ Windows 6.1+ GUI, x86-64
- Payload ZIP archive test: passed
- Embedded `app.asar` package metadata: passed
- Setup embedded SHA constants: matched final payload/uninstaller

## Important runtime status

The installer, uninstaller, and application could not be executed in this Linux environment. Therefore the following are **not yet validated**:

- Physical Windows installation and uninstallation
- SmartScreen behavior
- Title-bar X and File → Exit on Windows
- Save/Discard/Cancel on Windows
- Task Manager process termination
- Real MIDI/audio/microphone cleanup
- Floating panel and multiple-monitor shutdown
- Reopening after installation and workspace restoration

The Windows artifact is a genuine desktop installer test candidate, not a browser launcher, but it remains unsigned and device-unverified.
