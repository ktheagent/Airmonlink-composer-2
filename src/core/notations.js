(function (root, factory) {
  const model = root.AirmonScoreModel || (typeof require === 'function' ? require('./score-model') : null);
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonNotations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model) {
  'use strict';

  function noteEntries(score, entries) {
    const supplied = Array.isArray(entries) ? entries : [];
    return supplied.map(entry => {
      if (entry?.event && entry?.part) return entry;
      const ref = model.findEvent(score, entry?.eventId || entry?.id || entry);
      return ref ? { part: ref.part, event: ref.event } : null;
    }).filter(entry => entry?.event?.type === 'note').sort((a, b) => a.event.start - b.event.start || a.event.midi - b.event.midi);
  }

  function createTie(score, entries, options = {}) {
    const notes = noteEntries(score, entries);
    if (notes.length !== 2) throw new Error('Select exactly two notes to create a tie.');
    if (notes[0].part.id !== notes[1].part.id) throw new Error('A tie must remain within one part.');
    if ((notes[0].event.voice || 1) !== (notes[1].event.voice || 1)) throw new Error('A tie must remain in the same layer.');
    if ((notes[0].event.staff || null) !== (notes[1].event.staff || null)) throw new Error('Use cross-staff notation before tying notes on different staves.');
    return model.addTie(score, notes[0].event.id, notes[1].event.id, options);
  }

  function createSlur(score, entries, options = {}) {
    const notes = noteEntries(score, entries);
    if (notes.length < 2) throw new Error('Select two or more notes to create a slur.');
    if (notes[0].part.id !== notes.at(-1).part.id) throw new Error('A slur must remain within one part.');
    return model.addSlur(score, notes[0].event.id, notes.at(-1).event.id, options);
  }

  function removeSpanners(score, entries, type = null) {
    const ids = new Set(noteEntries(score, entries).map(entry => entry.event.id));
    const before = (score.spanners || []).length;
    score.spanners = (score.spanners || []).filter(spanner => {
      if (type && spanner.type !== type) return true;
      return !(ids.has(spanner.startEventId) || ids.has(spanner.endEventId));
    });
    if (score.spanners.length !== before) {
      model.normalizeSpanners(score);
      model.touch(score);
    }
    return before - score.spanners.length;
  }

  function flipSpanners(score, entries, type = null) {
    const ids = new Set(noteEntries(score, entries).map(entry => entry.event.id));
    let count = 0;
    for (const spanner of score.spanners || []) {
      if (type && spanner.type !== type) continue;
      if (!ids.has(spanner.startEventId) && !ids.has(spanner.endEventId)) continue;
      spanner.direction = spanner.direction === 'above' ? 'below' : 'above';
      count += 1;
    }
    if (count) model.touch(score);
    return count;
  }

  function resetSpannerPositions(score, entries, type = null) {
    const ids = new Set(noteEntries(score, entries).map(entry => entry.event.id));
    let count = 0;
    for (const spanner of score.spanners || []) {
      if (type && spanner.type !== type) continue;
      if (!ids.has(spanner.startEventId) && !ids.has(spanner.endEventId)) continue;
      spanner.direction = 'auto';
      spanner.placementOffset = 0;
      count += 1;
    }
    if (count) model.touch(score);
    return count;
  }

  function setArticulation(score, entries, articulation, enabled = true) {
    let count = 0;
    for (const { event } of noteEntries(score, entries)) {
      event.articulations = Array.isArray(event.articulations) ? event.articulations : [];
      const has = event.articulations.includes(articulation);
      if (enabled && !has) { event.articulations.push(articulation); count += 1; }
      if (!enabled && has) { event.articulations = event.articulations.filter(item => item !== articulation); count += 1; }
    }
    if (count) model.touch(score);
    return count;
  }

  function layerCapacityReport(score, partId, measureIndex, staff = null) {
    const part = score.parts.find(item => item.id === partId);
    if (!part) throw new Error('Part not found.');
    return [1, 2, 3, 4].map(voice => model.layerCapacity(score, part, measureIndex, voice, staff));
  }

  function erase(score, target) {
    if (!target) return false;
    if (target.type === 'tie' || target.type === 'slur') return model.removeSpanner(score, target.id);
    if (target.type === 'lyric') {
      const ref = model.findEvent(score, target.noteId);
      if (!ref) return false;
      const before = (ref.event.lyrics || []).length;
      ref.event.lyrics = (ref.event.lyrics || []).filter(item => item.id !== target.id);
      model.normalizeEventLyrics(ref.event, ref.part);
      if (before !== ref.event.lyrics.length) { model.touch(score); return true; }
      return false;
    }
    if (target.partId && target.eventId) return model.deleteEvent(score, target.partId, target.eventId);
    return false;
  }

  return {
    noteEntries, createTie, createSlur, removeSpanners, flipSpanners, resetSpannerPositions,
    setArticulation, layerCapacityReport, erase
  };
});
