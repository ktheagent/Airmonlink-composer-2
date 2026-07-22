# Airmonlink Composer 0.9.1 Performance Audit

Date: 2026-07-20  
Release: 0.9.1, build 10  
Base release: 0.9.0, build 9

## Objective

Remove the severe delay experienced after installing 0.9.0 without changing Airmonlink Composer's existing interface, branding, notation appearance, Tonic Sol-fa page, navigation, controls, window behaviour, package identity, or project format.

## Root causes found

1. `renderAll()` reconstructed the score, Tonic Sol-fa publication, Mixer, Inspector, statistics, parts, and layers after many small actions.
2. The score renderer discarded and recreated the complete SVG tree, including note/rest/lyric/spanner nodes and their individual event handlers.
3. Hidden heavy pages were rendered even when the user had not opened them.
4. Selection and layer changes triggered full engraving work even though musical data had not changed.
5. Measure position and event lookup repeatedly scanned arrays that could be indexed.
6. Playback highlighting repeatedly searched the whole rendered score.
7. Dirty-state checking and autosave performed avoidable whole-project serialization during active editing.

## Implemented corrections

### Derived score indexes

`src/core/score-model.js` now maintains derived-only caches using `WeakMap`:

- Measure start positions and capacities
- Effective time signatures and keys
- Total score duration
- Stable event-ID lookup

The caches are invalidated whenever musical structure changes. Measure lookup now uses binary search rather than repeated linear accumulation.

### Incremental render scheduling

`src/ui/app.js` now distinguishes:

- Musical/layout changes that require a full score render
- Selection, active-layer, playback, caret, ghost-note, and measure-highlight changes that require only a fast refresh
- Hidden heavy views that should remain unrendered until opened

Tonic Sol-fa and Mixer views are now lazy. The Staff view does not calculate either one at startup.

### Delegated interaction handling

One delegated SVG interaction handler replaces individual listeners attached repeatedly to every note, rest, lyric, tie, and slur node.

### Indexed playback highlighting

Rendered events are indexed by beat and stable ID. Playback highlighting uses binary lookup and a small time window instead of rescanning the complete score.

### Idle autosave

Autosave is scheduled after editing becomes idle, with a 60-second safety interval and a short debounce. Active note entry no longer performs recovery-file work every 12 seconds.

### Lightweight dirty-state tracking

The document revision is compared with the save checkpoint. The app no longer serializes and hashes the entire score for every small edit merely to decide whether the file is modified.

## Controlled comparison

The same 0.9.0 and 0.9.1 application data, browser engine, viewport, and interaction script were used.

| Scenario | 0.9.0 | 0.9.1 | Improvement |
|---|---:|---:|---:|
| Initial score readiness | 984.5 ms | 543.2 ms | 44.8% |
| Ten note selections | 2175.6 ms | 7.5 ms | 99.7% |
| Eight layer switches | 227.2 ms | 9.1 ms | 96.0% |

After the optimized benchmark the renderer reported:

- Full score renders: 1
- Fast score refreshes: 42
- Tonic Sol-fa renders while hidden: 0
- Mixer renders while hidden: 0

The raw data is stored in `PERFORMANCE-COMPARISON.json`.

## UI and branding protection verification

No visual redesign was performed.

The following files/assets are byte-identical to 0.9.0:

| Protected item | SHA-256 |
|---|---|
| `src/ui/index.html` | `d1155c3d393a7993b054298eb2579ed10e175447b2171b8b85ed7a5ae6815112` |
| `src/ui/styles.css` | `95d8f3595dc63a768669ec9ceccd196cf0b9ad99c828a8d5f4b4957151bebda1` |
| `assets/official-logo.png` | `02394ae851777a4678b53936c120599c4c75d866b9cbb4081ef7dc5004bc18eb` |

Before/after screenshots are both 1600×861. Pixel comparison found:

- Difference bounding box: none
- Changed pixels: 0

See `UI-BEFORE-0.9.0.png` and `UI-AFTER-0.9.1.png`.

## Files changed

- `package.json` — version/build only
- `package-lock.json` — version metadata only
- `src/core/score-model.js` — derived caches and invalidation
- `src/ui/app.js` — render scheduling, indexing, delegated events, idle autosave, state binding
- `scripts/browser_smoke.py` — performance regression checks
- `scripts/performance_compare.py` — controlled before/after benchmark
- `test/v091-performance.test.js` — deterministic cache and large-score tests
- Release documentation and generated reports

No visible UI file was replaced or redesigned.

## Remaining risks

- A real Windows computer is still required to measure cold startup under Windows Defender, GPU acceleration, slower disks, and very large user scores.
- Full system/page virtualization is not yet implemented; extremely large multi-page scores can still require substantial engraving work when the musical model changes.
- Browser synthesis and advanced engraving remain separate known limitations.
