# Requirements A–E

### A. Release identity and removal of old software

| ID | Requirement | Current status | Required evidence |
|---|---|---:|---|
| A01 | Installed application is unmistakably the new build, not an old shortcut or cached executable. | UNKNOWN | Process path, executable hash, install path, About version, visible build badge. |
| A02 | Package version, build number, workflow, validator, installer name, portable name, documentation, About dialog, and visible badge agree. | UNKNOWN | Cross-file audit and compiled-app screenshots. |
| A03 | No visible Build 12, Build 15, or Build 16 labels remain in the new release. | UNKNOWN | Live renderer text scan and screenshots. |
| A04 | No obsolete “Print / PDF” or “Print or PDF” labels remain. | UNKNOWN | Live menu/export dialog inspection. |
| A05 | Legacy printing is clearly labelled **System Print** and presented only as a fallback. | UNKNOWN | Live UI screenshot and click behavior. |
| A06 | No duplicated, hidden-but-focusable, inactive, or stale publishing controls remain. | UNKNOWN | DOM/runtime verification plus keyboard navigation inspection. |
| A07 | Retired runtime injectors, stale bootstrap paths, and obsolete release checks are not used by the packaged entry point. | UNKNOWN | Package entry point, ASAR/source inspection, executable runtime proof. |
| A08 | Concept artwork is never represented as an implementation screenshot. | PASS | This audit explicitly distinguishes concepts from evidence. |

### B. Staff visibility and obstructing-bar correction

| ID | Requirement | Current status | Required evidence |
|---|---|---:|---|
| B01 | No toolbar, floating bar, menu, ribbon, header, overlay, dock, or status element covers the top staff. | UNKNOWN | Actual compiled-app screenshots in all listed states. |
| B02 | Clefs, key signatures, time signatures, notes, lyrics, measure numbers, and top staff lines remain fully visible. | UNKNOWN | Visual inspection on real scores. |
| B03 | Score content resizes or scrolls correctly when left/right/bottom panels open. | UNKNOWN | Before/after screenshots and interaction video or observations. |
| B04 | Normal, maximized, narrow, and restored windows keep the score reachable. | UNKNOWN | Window-size matrix screenshots. |
| B05 | Display scaling does not place controls over the staff. | BLOCKED | Test on available Windows scaling values. |
| B06 | Zooming Staff and Tonic Sol-fa views does not create permanent obstruction. | UNKNOWN | Compiled-app zoom tests. |
| B07 | Floating panels can be moved away from the score and restored safely. | UNKNOWN | Human interaction evidence. |
| B08 | The user’s specific complaint about “the bar which covers the staff” is reproduced, corrected, and demonstrated with before/after evidence. | UNKNOWN | Reproduction notes and screenshots. |

Required layout states:

- first launch;
- new score;
- existing `.airscore`;
- maximized;
- normal window;
- narrow window;
- common display-scaling values when available;
- zoom in/out;
- right dock open/closed;
- piano panel open/closed;
- Composition panel open/collapsed/floating/docked;
- Inspector open/collapsed/floating/docked;
- Tonic Sol-fa panel open/collapsed/floating/docked;
- Export dialog open/closed;
- menu open over the first staff;
- full-screen or presentation mode where supported.

### C. Mouse drag-in, drag-out, docking, and panel state

| ID | Requirement | Current status | Required evidence |
|---|---|---:|---|
| C01 | Panels can be grabbed and moved with the mouse without jumping. | UNKNOWN | Human interaction test. |
| C02 | Panels can be dragged out of a dock to become floating. | UNKNOWN | Human interaction test and screenshot. |
| C03 | Floating panels show valid docking targets. | UNKNOWN | Screenshot during drag. |
| C04 | Panels can be dropped back into a valid dock with the mouse. | UNKNOWN | Human interaction test. |
| C05 | Drag docking does not rely only on Float/Redock buttons when mouse docking was promised. | UNKNOWN | Source and live behavior. |
| C06 | Docked panels do not cover the score. | UNKNOWN | Layout screenshots. |
| C07 | Floating and docked dimensions remain safe and usable. | UNKNOWN | Resize/dock tests. |
| C08 | Panel state persists after application restart. | UNKNOWN | Close/reopen evidence. |
| C09 | Off-screen saved panels recover to a safe visible default. | UNKNOWN | Simulated unsafe workspace test. |
| C10 | Menu or tool groups are not falsely presented as mouse-reorderable unless that behavior exists. | UNKNOWN | Design-to-implementation comparison. |

### D. Menu and tool grouping

| ID | Requirement | Current status | Required evidence |
|---|---|---:|---|
| D01 | File, Edit, View, Score, Play, Tools, Export, and Help commands are grouped logically. | UNKNOWN | Menu inventory and screenshots. |
| D02 | Publishing commands are immediately discoverable. | UNKNOWN | First-time-user inspection. |
| D03 | Related commands are grouped; unrelated controls are not mixed. | UNKNOWN | Approved grouping matrix. |
| D04 | Obsolete and duplicate commands are removed. | UNKNOWN | Menu/DOM audit. |
| D05 | Menu labels match current behavior and current build. | UNKNOWN | Live menu inspection. |
| D06 | Keyboard shortcuts and menu commands execute the same operation. | UNKNOWN | Functional tests. |
| D07 | The final interface matches the approved design requirements, not merely a concept image. | UNKNOWN | Approved design checklist versus screenshots. |
| D08 | Any left Publish group, right Publishing panel, or other pictured element is implemented only if approved as a requirement; otherwise the final report states it was not implemented. | UNKNOWN | User-approved design scope. |

### E. Visible publishing controls and action wiring

| ID | Requirement | Current status | Required evidence |
|---|---|---:|---|
| E01 | **Dedicated PDF** is visible in the Export dialog. | UNKNOWN | Compiled renderer screenshot. |
| E02 | **PNG Pages** is visible in the Export dialog. | UNKNOWN | Compiled renderer screenshot. |
| E03 | **System Print** fallback is visible and separate. | UNKNOWN | Compiled renderer screenshot. |
| E04 | Dedicated PDF is visible in the Export menu. | UNKNOWN | Menu screenshot. |
| E05 | PNG Pages is visible in the Export menu. | UNKNOWN | Menu screenshot. |
| E06 | Current build badge is visible. | UNKNOWN | Screenshot. |
| E07 | Publishing-ready status is visible. | UNKNOWN | Screenshot. |
| E08 | Clicking each publishing control invokes the intended real action. | UNKNOWN | Human click tests and resulting dialogs/files. |
| E09 | Publishing initialization failure produces an explicit useful error rather than silent old behavior. | UNKNOWN | Failure-injection test. |
| E10 | Controls do not duplicate after navigation, view changes, dialogs, or repeated use. | UNKNOWN | Repetition test and DOM count. |
| E11 | Controls remain available after switching Staff/Tonic Sol-fa and reopening Export. | UNKNOWN | Human interaction test. |

