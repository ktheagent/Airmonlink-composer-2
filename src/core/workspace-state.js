(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonWorkspaceState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RIGHT_PANELS = Object.freeze(['composition', 'inspector', 'tonic']);

  function defaults() {
    return {
      schemaVersion: 2,
      composition: false,
      inspector: false,
      tonic: false,
      piano: false,
      playback: true,
      activeRight: null,
      rightCollapsed: true,
      floating: { composition: false, inspector: false, tonic: false },
      rightWidth: 300,
      pianoHeight: 126
    };
  }

  function migrateStored(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    if (Number(source.schemaVersion) >= 2) return { ...source, schemaVersion: 2 };
    return { ...source, schemaVersion: 2, composition: false, inspector: false, tonic: false, activeRight: null, rightCollapsed: true, floating: { composition: false, inspector: false, tonic: false } };
  }

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, finite(value, minimum)));
  }

  function viewportMetrics(viewport = {}) {
    const width = Math.max(320, finite(viewport.width, 1280));
    const height = Math.max(320, finite(viewport.height, 800));
    const leftWidth = width <= 900 ? 0 : width <= 1200 ? 190 : 220;
    const minimumCanvas = width < 700 ? 210 : width < 1000 ? 300 : 420;
    const rightMinimum = width < 900 ? 220 : 240;
    const rightMaximum = Math.max(
      rightMinimum,
      Math.min(width * 0.45, width - leftWidth - minimumCanvas)
    );
    const pianoMaximum = Math.max(72, Math.min(height * 0.44, height - 300));
    return {
      width,
      height,
      leftWidth,
      minimumCanvas,
      rightMinimum,
      rightMaximum,
      pianoMaximum,
      compact: width < 720,
      autoCollapseRight: width < 560
    };
  }

  function sanitize(input = {}, viewport = {}) {
    const base = defaults();
    const source = input && typeof input === 'object' ? input : {};
    const metrics = viewportMetrics(viewport);
    const floatingSource = source.floating && typeof source.floating === 'object' ? source.floating : {};
    const result = {
      schemaVersion: 2,
      composition: source.composition == null ? base.composition : Boolean(source.composition),
      inspector: source.inspector == null ? base.inspector : Boolean(source.inspector),
      tonic: source.tonic == null ? base.tonic : Boolean(source.tonic),
      piano: source.piano == null ? base.piano : Boolean(source.piano),
      playback: source.playback == null ? base.playback : Boolean(source.playback),
      activeRight: RIGHT_PANELS.includes(source.activeRight) ? source.activeRight : base.activeRight,
      rightCollapsed: Boolean(source.rightCollapsed),
      floating: {},
      rightWidth: clamp(source.rightWidth, metrics.rightMinimum, metrics.rightMaximum),
      pianoHeight: clamp(source.pianoHeight, 72, metrics.pianoMaximum)
    };

    for (const name of RIGHT_PANELS) {
      // Floating panels are redocked on compact displays so that they cannot cover
      // the score or be restored outside a newly connected monitor's work area.
      result.floating[name] = metrics.compact ? false : Boolean(floatingSource[name]);
    }

    const open = RIGHT_PANELS.filter(name => result[name]);
    if (!open.includes(result.activeRight)) result.activeRight = open[0] || null;
    return result;
  }

  function layout(state, viewport = {}) {
    const safe = sanitize(state, viewport);
    const metrics = viewportMetrics(viewport);
    const open = RIGHT_PANELS.filter(name => safe[name]);
    const docked = open.filter(name => !safe.floating[name]);
    const rightVisible = docked.length > 0;
    return {
      state: safe,
      metrics,
      rightVisible,
      effectiveRightCollapsed: rightVisible && (safe.rightCollapsed || metrics.autoCollapseRight),
      docked,
      open
    };
  }

  return { RIGHT_PANELS, defaults, migrateStored, viewportMetrics, sanitize, layout, clamp };
});
