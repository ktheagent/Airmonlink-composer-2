# Building Airmonlink Composer for Windows

## Requirements

- Windows 10 or 11 x64
- Node.js 22
- npm with access to the locked dependencies in `package-lock.json`

## Validate

```powershell
npm ci
npm run lint
npm test
```

The Build 14 release gate requires at least 141 tests with zero failures. The current candidate contains 143 tests.

## Build installer and portable executable

```powershell
npm run dist:win
```

Expected files in `release\`:

- `Airmonlink-Composer-1.1.0-Build14-Setup.exe`
- `Airmonlink-Composer-1.1.0-Build14-Portable.exe`

## Automated Windows validation

Run:

```powershell
./scripts/windows-release-validation.ps1
```

The script checks PE signatures and sizes, product/file-version metadata, silent installation, installed and portable renderer startup, Start Menu and desktop shortcuts, `.airscore` registration and opening, silent uninstall, user-score preservation, SHA-256 checksums, and machine-readable PASS/FAIL/BLOCKED summaries.

The GitHub Actions workflow is `.github/workflows/windows-build.yml`, named **Validate and Build Windows Release**. It supports pull requests to `main` and manual dispatch after the workflow exists on the default branch.

## Build identity

- Product: Airmonlink Composer
- Version: 1.1.0
- Build: 14
- Windows file version: 1.1.0.14
- Application ID: `com.airmonlink.composer`
- Icon: `assets/icon.ico`
- Installer: NSIS x64, selectable installation directory
- Portable target: Windows x64
- File association: `.airscore`

## Release restrictions

Do not regenerate the project or replace its UI, assets, schema, identity, or user-data behavior. Do not publish a GitHub Release automatically during initial validation. Do not report Windows, signing, SmartScreen, upgrade, printing, MIDI/device, or physical GUI checks as passed without the corresponding evidence.
