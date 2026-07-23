# Checkpoint ledger and current decision

## Checkpoint 0 — 2026-07-22 — Audit initialized

Repository: `ktheagent/Airmonlink-composer-2`  
Branch: `main`  
Release under review: Airmonlink Composer 1.1.0 Build 17 work in progress  
Decision: **RELEASE BLOCKED**

Established controls:

- Full conversation requirements consolidated into a persistent audit.
- Staff-covering bar is a mandatory visual checkpoint.
- Mouse drag-in/drag-out docking and menu grouping are mandatory checkpoints when in approved scope.
- All earlier corrections remain part of regression coverage.
- Every major stage must append and save a checkpoint.
- A written adversarial self-critique is mandatory before final release.
- Concept artwork is not implementation evidence.
- Compilation, CI success and artifact upload are not sufficient for approval.

Known incomplete or unverified areas:

- installed Windows interface and build identity;
- staff obstruction across layout/scaling states;
- full mouse docking;
- final menu grouping;
- live PDF/PNG operation and independent output inspection;
- startup/editing performance;
- old shortcut/installation replacement;
- artifact hashes;
- user acceptance.

Self-critique: earlier work focused too heavily on CI and publishing exposure, used a concept image containing unimplemented features, and discussed builds before complete visual/functional verification.

Next checkpoint: requirements reconciliation and complete current-source inventory.

# Current release decision

## RELEASE BLOCKED

Do not recommend another download until all mandatory source, test, Windows runtime, installed-application, visual, performance, PDF, PNG, upgrade, artifact and self-critique checks are PASS with recorded evidence.

## Checkpoint 1–2 — 2026-07-23 — Requirements and current-source inventory started

Repository access: authenticated as `ktheagent`; admin and push permission confirmed.  
Repository: `ktheagent/Airmonlink-composer-2`  
Branch: `main`  
Package candidate: Airmonlink Composer `1.1.0`, Build `17`  
Decision: **RELEASE BLOCKED**

Evidence recorded:

- `package.json` uses `src/bootstrap.js`, build number `17`, and Build 17 installer/portable naming.
- `src/ui/index.html` still contains visible `Print or PDF`, `PDF Print / PDF`, and `Airmonlink Composer 1.0.0 · Build 12`.
- `src/ui/app.js` shows panel Float/Redock controls and resize handlers. Full mouse drag-out/drag-in docking is not yet proven.
- Current source inventory includes `publishing-exposure.js` and `publishing-ui.js`; obsolete and duplicate runtime paths require reconciliation.
- The staff-covering-bar complaint has not yet been reproduced or corrected with compiled-app evidence.
- No new Windows build was triggered during this checkpoint.

Requirement status changes:

- A03 old build labels removed: `FAIL`.
- A04 obsolete Print/PDF labels removed: `FAIL`.
- C01–C05 mouse docking: `UNKNOWN` pending implementation/source proof.
- B01–B08 staff visibility: `UNKNOWN` pending reproduction and layout audit.
- D01–D08 menu grouping: `UNKNOWN` pending complete menu inventory.
- E01–E11 publishing controls: `UNKNOWN` pending source/runtime reconciliation.

Self-critique:

The current HTML proves that prior Build 17 publishing work did not remove all old visible interface content. Earlier claims about a visibly new build were therefore premature. Source inventory must be completed before any further release commit.

Next checkpoint:

Complete the source-to-requirement map for layout, menus, docking, publishing, performance, workflow, validator, and regression tests; then implement the staff obstruction and old-interface removal first.
