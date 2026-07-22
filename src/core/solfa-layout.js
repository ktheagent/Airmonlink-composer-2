(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./score-model') : root.AirmonScoreModel
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonSolfaLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model) {
  'use strict';

  const PAGE_SIZES_MM = Object.freeze({ A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6], A3: [297, 420] });
  const PX_PER_MM = 3.78;

  function pageDimensions(score) {
    const base = PAGE_SIZES_MM[score?.settings?.pageSize] || PAGE_SIZES_MM.A4;
    const dimensions = score?.settings?.orientation === 'landscape' ? [base[1], base[0]] : base;
    return { width: Math.round(dimensions[0] * PX_PER_MM), height: Math.round(dimensions[1] * PX_PER_MM) };
  }

  function eventLyrics(event) {
    return Array.isArray(event?.lyrics) && event.lyrics.length
      ? event.lyrics
      : event?.lyric ? [{ verse: event.lyricVerse || 1, text: event.lyric }] : [];
  }

  function measureWeight(score, index) {
    const bounds = model.measureBounds(score, index);
    const authored = score.parts.flatMap(part => part.events.filter(event => event.generatedBy !== 'gap-fill' && event.start >= bounds.start - 1e-8 && event.start < bounds.end - 1e-8));
    const lyricCharacters = authored.reduce((sum, event) => sum + eventLyrics(event).reduce((inner, lyric) => inner + String(lyric.text || '').length, 0), 0);
    return Math.max(1.35, Math.min(3.4, 1.15 + authored.length * .16 + lyricCharacters * .012));
  }

  function buildSystems(score, options = {}) {
    const budget = Math.max(3, Number(options.horizontalBudget) || 8.7);
    const systems = [];
    let indices = [], used = 0, startsNewPage = false;
    score.measures.forEach((measure, index) => {
      const weight = measureWeight(score, index);
      const forcedBreak = indices.length && (measure.newSystem || measure.newPage);
      if (indices.length && (forcedBreak || used + weight > budget)) {
        systems.push({ measureIndices: indices, weight: used, newPage: startsNewPage });
        indices = []; used = 0; startsNewPage = Boolean(measure.newPage);
      }
      indices.push(index); used += weight;
    });
    if (indices.length) systems.push({ measureIndices: indices, weight: used, newPage: startsNewPage });
    return systems;
  }

  function rowMetrics(score, measureIndices) {
    const first = model.measureBounds(score, measureIndices[0]).start;
    const last = model.measureBounds(score, measureIndices[measureIndices.length - 1]).end;
    let rows = 0, maximumVerses = 0;
    for (const part of score.parts) {
      const staves = part.staves?.length ? part.staves.map(staff => staff.id || staff.clef) : [null];
      for (const staff of staves) for (let voice = 1; voice <= 4; voice += 1) {
        const events = part.events.filter(event => event.generatedBy !== 'gap-fill' && (Number(event.voice) || 1) === voice && (staves.length === 1 || (event.staff || null) === staff) && event.start >= first - 1e-8 && event.start < last - 1e-8);
        if (!events.length && score.settings.solfaShowEmptyLayers !== true) continue;
        rows += 1;
        const verses = new Set(events.flatMap(event => eventLyrics(event).filter(lyric => String(lyric.text || '')).map(lyric => Math.max(1, Number(lyric.verse) || 1))));
        maximumVerses = Math.max(maximumVerses, verses.size);
      }
    }
    return { rows, maximumVerses };
  }

  function estimateSystemHeight(score, system) {
    const metrics = rowMetrics(score, system.measureIndices);
    const lyricHeight = score.settings.solfaShowLyrics === false ? 0 : Math.max(0, metrics.maximumVerses - 1) * 14;
    return 24 + metrics.rows * (48 + lyricHeight) + Math.max(0, score.parts.length - 1) * 3;
  }

  function activeContext(score, measureIndex) {
    const bounds = model.measureBounds(score, measureIndex);
    return { measure: measureIndex + 1, key: bounds.key, timeSignature: bounds.timeSignature };
  }

  function paginate(score, options = {}) {
    const dimensions = pageDimensions(score);
    const margin = Math.max(5, Number(score.settings.margins) || 15) * PX_PER_MM;
    const firstHeader = Math.max(100, Number(options.firstHeaderHeight) || 154);
    const continuationHeader = Math.max(36, Number(options.continuationHeaderHeight) || 58);
    const footer = Math.max(20, Number(options.footerHeight) || 32);
    const systems = buildSystems(score, options).map(system => ({ ...system, estimatedHeight: estimateSystemHeight(score, system) }));
    const pages = [];
    let page = null;
    function startPage(system) {
      const index = pages.length;
      const headerHeight = index === 0 ? firstHeader : continuationHeader;
      page = { index, systems: [], context: activeContext(score, system.measureIndices[0]), usedHeight: headerHeight, headerHeight, availableHeight: dimensions.height - margin * 2 - footer };
      pages.push(page);
    }
    for (const system of systems) {
      if (!page || system.newPage || (page.systems.length && page.usedHeight + system.estimatedHeight > page.availableHeight)) startPage(system);
      page.systems.push(system);
      page.usedHeight += system.estimatedHeight;
    }
    pages.forEach(item => { item.overflow = item.usedHeight > item.availableHeight + 1e-8; });
    return { dimensions, margin, footerHeight: footer, pages, systems };
  }

  function fitScale(mode, viewport, page, manualScale = 1) {
    const width = Math.max(1, Number(viewport?.width) || page.width);
    const height = Math.max(1, Number(viewport?.height) || page.height);
    if (mode === 'width') return Math.min(1.45, Math.max(.25, (width - 24) / page.width));
    if (mode === 'page') return Math.min(1.45, Math.max(.25, Math.min((width - 24) / page.width, (height - 24) / page.height)));
    if (mode === 'actual') return 1;
    return Math.min(1.45, Math.max(.25, Number(manualScale) || 1));
  }

  return { PAGE_SIZES_MM, PX_PER_MM, pageDimensions, measureWeight, buildSystems, rowMetrics, estimateSystemHeight, activeContext, paginate, fitScale };
});
