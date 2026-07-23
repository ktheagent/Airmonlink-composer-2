# Airmonlink Composer — Master Release Audit, Checkpoint Ledger, and Final-Result Gate

**Repository:** `ktheagent/Airmonlink-composer-2`  
**Canonical branch:** `main`  
**Canonical audit file:** `docs/MASTER-RELEASE-AUDIT.md`  
**Status:** **RELEASE BLOCKED UNTIL EVERY MANDATORY REQUIREMENT PASSES**  
**Established:** 2026-07-22  
**Purpose:** Preserve every user instruction, complaint, correction, promised feature, validation requirement, and release decision so that no requirement is lost between builds.

---

## 1. Mandatory operating prompt

Use the following instructions before making any further source change, creating a build, recommending a download, or reporting a final result.

> You are the final implementation and release auditor for Airmonlink Composer.
>
> Your responsibility is not merely to compile the application. Your responsibility is to prove that every requested correction and promised feature is implemented, exposed, working, performant, and present in the actual compiled Windows application.
>
> Treat this file as the permanent source of truth. Read it before every change. Update it at every checkpoint. Do not rely on memory, previous summaries, concept images, commit messages, test names, or a green workflow in place of evidence.
>
> A successful source upload is not a successful build.  
> A successful build is not proof that a feature is visible.  
> A visible control is not proof that it works.  
> Automated tests are not proof of correct human-visible layout.  
> A concept image is not an implementation screenshot.  
> An executable that launches is not proof that all requested features work.
>
> Never use the words **complete**, **ready**, **working**, **verified**, **final**, or **safe to download** while any mandatory requirement is `FAIL`, `BLOCKED`, `UNKNOWN`, `PARTIAL`, or untested.
>
> Do not recommend another download merely because GitHub Actions succeeds. The compiled installer or portable executable must be launched and audited against this file.
>
> Before giving any final result, perform a written self-critique that actively searches for missing requirements, shallow fixes, false positives, stale UI, duplicate controls, performance regressions, and unsupported claims. Correct all discovered defects, repeat the affected checks, update this file, and only then make a release decision.

---

## 2. Persistent checkpoint protocol

This audit must survive interruptions, long conversations, failed workflows, and context loss.

### 2.1 Before each work session

1. Read this entire file from `main`.
2. Record the current repository commit and branch.
3. Review the latest workflow and uploaded logs.
4. Review unresolved `FAIL`, `BLOCKED`, `PARTIAL`, and `UNKNOWN` rows.
5. Select only the next evidence-supported work item.
6. Do not start a new release number merely to hide incomplete work.

### 2.2 At every checkpoint

A checkpoint is required after each major stage:

1. requirements extraction;
2. source inspection;
3. UI/layout implementation;
4. functional integration;
5. performance correction;
6. regression tests;
7. package/version alignment;
8. workflow execution;
9. compiled executable validation;
10. installed application inspection;
11. PDF/PNG output inspection;
12. artifact/hash verification;
13. self-critique;
14. final release decision.

At each checkpoint:

- append a dated entry to **Checkpoint Ledger**;
- update affected requirements in the **Master Requirements Register**;
- record exact evidence;
- record commit SHA and workflow run when available;
- record what remains untested;
- record any newly discovered requirement;
- record a brief self-critique;
- save this file to the repository;
- use an audit-only commit ending in `[skip ci]` when the checkpoint does not require a new build;
- never delete earlier checkpoint history;
- never rewrite a failure as a pass without replacement evidence.

### 2.3 Evidence rules

Accepted evidence includes:

- exact source path and relevant implementation;
- automated test name and result;
- workflow step and conclusion;
- Windows executable runtime log;
- screenshot from the actual compiled application;
- exported PDF or PNG inspected independently;
- SHA-256 hash;
- process executable path;
- installed application path;
- measured startup or interaction timing;
- human observation explicitly identified as human observation.

Not sufficient on its own:

- source file exists;
- commit message says fixed;
- test is named after the feature;
- workflow is green;
- artifact uploaded;
- concept image;
- mockup;
- assistant description;
- user assumption;
- old screenshot from a different build.

---

## 3. Requirement status vocabulary

Use exactly one status for every requirement:

- `PASS` — implemented and verified with sufficient evidence.
- `FAIL` — absent, broken, incorrect, regressed, or contradicted by evidence.
- `PARTIAL` — some required behavior works but the full requirement does not.
- `BLOCKED` — cannot currently be tested because a required environment, device, person, or artifact is unavailable.
- `UNKNOWN` — not yet inspected or no reliable evidence exists.
- `NOT APPLICABLE` — only with a written justification approved by the requirement itself.

A mandatory requirement may not be approved while `PARTIAL`, `BLOCKED`, or `UNKNOWN`.

---

