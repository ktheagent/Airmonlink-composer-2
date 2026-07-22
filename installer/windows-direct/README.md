# Direct Windows Setup source

This folder contains the source for the Phase 2 current-user Windows x64 Setup and uninstaller.

The installer embeds two generated files at build time:

- `installer-assets/windows-app.zip` — complete verified Electron Windows application payload
- `installer-assets/Uninstall Airmonlink Composer.exe` — compiled uninstaller

The embedded SHA-256 constants must be updated whenever either generated file changes. Build with a Windows-targeting Go toolchain, for example:

```text
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -H windowsgui" -o "Airmonlink-Composer-1.0.0-Phase-2-Windows-x64-Setup.exe" installer.go
```

The setup is intentionally current-user and writes under `%LOCALAPPDATA%`/HKCU. It does not require or bundle MuseScore source.
