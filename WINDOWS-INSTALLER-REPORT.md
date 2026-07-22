# Windows Installer Report — Airmonlink Composer 1.0.0 Phase 2

## Artifact

`Airmonlink-Composer-1.0.0-Phase-2-Windows-x64-Setup.exe`

- Type: native PE32+ Windows x64 GUI Setup program
- SHA-256: `5460a132fd9ff296a02a799b5c5e1005d1df67e068ee9f55c36bd99d5d59d6fe`
- Embedded application: Electron 37.10.3 Windows x64 runtime with Airmonlink Composer 1.0.0 Build 12 `app.asar`
- Embedded payload files: 78
- Application ID: `com.airmonlink.composer`
- Project extension: `.airscore`

## Installer safeguards

- Verifies embedded application and uninstaller SHA-256 values
- Refuses installation while `Airmonlink Composer.exe` is running
- Extracts to a staging directory
- Atomically activates the new installation
- Preserves/rolls back the previous directory on activation failure
- Uses current-user registry and install location by default
- Writes an installation log

## Integration

- Desktop shortcut
- Start Menu application and uninstall shortcuts
- Add/Remove Programs entry
- `.airscore` description, icon, and open command
- Official installed executable icon
- Optional launch after successful installation

## Uninstaller

- Native Windows x64 GUI executable
- Refuses removal while the application is running
- Removes shortcuts, uninstall registration, and `.airscore` association
- Schedules application-directory removal after its own process exits
- Does not delete user score files or the application user-data folder

## Verification performed

- Go source formatted and cross-compiled
- Setup/uninstaller recognized as PE32+ x86-64 Windows GUI
- Embedded hashes match final artifacts
- Application payload ZIP integrity passed
- `app.asar` package metadata verified as 1.0.0 Build 12
- Expected registry/file-association/install strings present

## Not performed

- Running Setup on Windows
- Testing upgrade over 0.9.1
- Testing uninstall on Windows
- SmartScreen/user-account-control behavior
- Add/Remove Programs visual inspection
- File-association launch
- Code-signing verification; artifacts are unsigned

This is a genuine installer containing the desktop Electron application, not a browser-hosted launcher. It remains a device-test candidate until the Windows matrix passes.
