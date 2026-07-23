# Requirements K–O

## K. File formats and data
Verify `.airscore` round trips without corruption; MusicXML, MXL and MIDI preserve their promised musical and layout data; migrations preserve user music and settings; schema, identity and file associations are not silently reset.

## L. Windows build and identity
Require JavaScript syntax and PowerShell parser checks, the complete test suite, installer and portable packaging, PE/size validation, executable launch, live renderer proof, installer upgrade testing, process path, install path, About version, visible badge, signing status and SmartScreen notes.

## M. Workflow and artifacts
Workflow must be `Validate and Build Windows Release` on the exact `main` commit. Record each step separately. Artifact names, version and build must agree. Verify `SHA256SUMS.txt`, downloaded hashes, sizes and validation evidence. Never claim artifacts before confirmed upload.

## N. Human acceptance
Human Windows testing must confirm the actual compiled app: visible new features, no old interface, no staff-covering bar, mouse dock-in/out when required, approved menu grouping, working PDF/PNG/System Print, acceptable performance, and correct build identity.

## O. Truthfulness
Always separate prepared, committed, built, artifact-generated, installed, visually inspected and hardware-tested states. List every untested item. Never present a concept image as implementation. Never recommend download while any mandatory row is FAIL, PARTIAL, BLOCKED or UNKNOWN. Current release decision: RELEASE BLOCKED.
