# Airmonlink Composer 1.1.0 Build 14 Release Notes

Build 14 completes the multi-page tonic-solfa, publication-layout, command-group, workspace, automatic-chord, and lyric-isolation work while preparing an evidence-driven Windows release candidate.

## Composition and publication

- Tonic-solfa output is paginated into physical sheets without splitting systems.
- Manual page breaks, SATB layouts, and multiple lyric verses are preserved.
- Fit Width, Fit Page, 100%, and manual zoom account for both viewport dimensions.
- Title, subtitle, dedication, composer, composition date, arranger, lyricist, source, supporting text, and copyright remain editable.
- Staff and tonic-solfa publication placement are independent and persist through `.airscore` and MusicXML data.
- Hidden staff or mixer views are isolated from tonic-solfa print output.

## Commands and workspace

- Sixteen named functional command groups use compact vertical labels and three-column expanded lists.
- Open right-side panels consume available layout width instead of covering the staff.
- Legacy workspace state migrates to a safe, unobstructed layout.

## Musical entry and lyrics

- Compatible pitches entered at one onset form one semantic chord automatically.
- Mouse, computer keyboard, on-screen piano, MIDI, paste, and import paths preserve the same chord semantics.
- Duplicate pitches are ignored without an unnecessary icon or error workflow.
- Lyric verse numbers remain numeric metadata and never become part of lyric text.
- Verses 1–24, Unicode, hyphens, melismas, paste, copy, search/replace, `.airscore`, MusicXML, and tonic-solfa output remain covered.

## Windows release-candidate work

- Declares `.airscore` association in electron-builder configuration.
- Handles associated-file startup and second-instance document opening.
- Uses a renderer-ready handshake so automated startup evidence is emitted only after the document-open listener is registered.
- Sets explicit Build 14 installer, portable, and Windows file-version metadata.
- Adds a Windows x64 workflow with Node.js 22, locked dependency installation, lint, test-count proof, NSIS/portable builds, PE and metadata validation, clean install, bounded launch, association test, uninstall, checksums, logs, and machine-readable PASS/FAIL/BLOCKED summaries.
- Keeps workflow permissions at `contents: read` and does not publish a GitHub Release automatically.

## Validation

- JavaScript syntax: 50 files passed
- Automated tests: 143 passed, 0 failed
- Windows workflow YAML: parsed successfully as YAML 1.2

## Remaining gates

No Windows installer or portable executable is claimed from this source-only checkpoint. Actual Windows build, artifact hashes, clean install, launch, `.airscore` association, uninstall, and artifact inspection require a successful GitHub Actions run. Human Windows GUI, printing, MIDI/device, SmartScreen, signing, and upgrade checks remain `BLOCKED` until tested.
