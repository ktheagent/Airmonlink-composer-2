(function (root, factory) {
  const model = root.AirmonScoreModel || (typeof require === 'function' ? require('./score-model') : null);
  const theory = root.AirmonMusicTheory || (typeof require === 'function' ? require('./music-theory') : null);
  const api = factory(model, theory);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonEditing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model, theory) {
  'use strict';

  const EPSILON = 1e-8;

  function selectedEntries(score, selection) {
    if (selection?.eventEntries) return selection.eventEntries(score);
    const ids = new Set(Array.isArray(selection) ? selection.map(String) : []);
    return (score.parts || []).flatMap(part => (part.events || []).filter(event => ids.has(String(event.id))).map(event => ({ part, event })));
  }

  function makeClipboard(score, selection) {
    const entries = selectedEntries(score, selection);
    if (!entries.length) return null;
    const origin = Math.min(...entries.map(({ event }) => Number(event.start) || 0));
    const selectedIds = new Set(entries.map(({ event }) => String(event.id)));
    return {
      type: 'airmonlink-event-clipboard',
      version: 2,
      origin,
      span: Math.max(...entries.map(({ event }) => (Number(event.start) || 0) + (Number(event.duration) || 0))) - origin,
      events: entries.map(({ part, event }, index) => ({
        clipboardId: `clip-${index + 1}`,
        sourceEventId: event.id,
        sourcePartId: part.id,
        sourcePartName: part.name,
        sourceStaff: event.staff || null,
        event: cloneWithoutIdentity(event)
      })),
      spanners: (score.spanners || []).filter(item => selectedIds.has(String(item.startEventId)) && selectedIds.has(String(item.endEventId))).map(item => ({
        type: item.type,
        startSourceEventId: item.startEventId,
        endSourceEventId: item.endEventId,
        direction: item.direction || 'auto',
        placementOffset: Number(item.placementOffset) || 0
      }))
    };
  }

  function cloneWithoutIdentity(event) {
    const clone = JSON.parse(JSON.stringify(event));
    delete clone.id;
    clone.generated = false;
    clone.generatedBy = null;
    clone.generationGroupId = null;
    if (Array.isArray(clone.lyrics)) clone.lyrics = clone.lyrics.map(lyric => {
      const item = { ...lyric };
      delete item.id;
      delete item.noteId;
      return item;
    });
    return clone;
  }

  function eventEnd(event) { return (Number(event.start) || 0) + (Number(event.duration) || 0); }

  function eventConflicts(part, candidate) {
    return (part.events || []).filter(event => event.generatedBy !== 'gap-fill'
      && (event.voice || 1) === (candidate.voice || 1)
      && (event.staff || null) === (candidate.staff || null)
      && event.start < eventEnd(candidate) - EPSILON
      && candidate.start < eventEnd(event) - EPSILON);
  }

  function deleteSelection(score, selection) {
    const entries = selectedEntries(score, selection);
    const affected = new Set();
    const deletedIds = new Set(entries.map(({ event }) => String(event.id)));
    let count = 0;
    for (const { part, event } of entries) {
      const before = part.events.length;
      part.events = part.events.filter(item => item.id !== event.id);
      if (part.events.length !== before) { count += 1; affected.add(part.id); }
    }
    if (deletedIds.size) score.spanners = (score.spanners || []).filter(item => !deletedIds.has(String(item.startEventId)) && !deletedIds.has(String(item.endEventId)));
    for (const partId of affected) {
      const part = score.parts.find(item => item.id === partId); if (part) model.normalizeChordIds(part);
      if (score.settings.autoFillRests !== false) model.regenerateAutoRests(score, partId);
    }
    if (count) model.touch(score);
    return count;
  }

  function prepareClipboardEvent(item, clipboard, targetStart, options) {
    const event = JSON.parse(JSON.stringify(item.event));
    event.start = targetStart + ((Number(event.start) || 0) - Number(clipboard.origin || 0));
    if (options.voice != null) event.voice = Math.max(1, Math.min(4, Number(options.voice) || 1));
    if (options.staff !== undefined) event.staff = options.staff;
    if (options.includeLyrics === false) { event.lyrics = []; event.lyric = ''; event.melisma = false; }
    if (options.includeMarkings === false) { event.articulations = []; event.dynamics = []; event.tieStart = false; event.tieStop = false; event.slurStart = false; event.slurStop = false; }
    return event;
  }

  function ensureScoreLength(score, endBeat) {
    while (model.totalBeats(score) < endBeat - EPSILON) model.appendMeasures(score, 1);
  }

  function applyConflictStrategy(score, part, candidate, options, clipboard) {
    const mode = options.conflictMode || 'merge';
    const conflicts = eventConflicts(part, candidate);
    if (!conflicts.length) return;
    if (mode === 'cancel') throw new Error(`Layer ${candidate.voice || 1} already contains music in the destination range.`);
    if (mode === 'replace-conflicts' || mode === 'replace') {
      const conflictIds = new Set(conflicts.map(event => event.id));
      part.events = part.events.filter(event => !conflictIds.has(event.id));
      score.spanners = (score.spanners || []).filter(item => !conflictIds.has(item.startEventId) && !conflictIds.has(item.endEventId));
      return;
    }
    if (mode === 'shift-existing') {
      const shift = Math.max(.0625, Number(clipboard.span) || Number(candidate.duration) || 1);
      const threshold = Math.min(...conflicts.map(event => event.start));
      for (const event of part.events) {
        if (event.generatedBy === 'gap-fill') continue;
        if ((event.voice || 1) !== (candidate.voice || 1) || (event.staff || null) !== (candidate.staff || null)) continue;
        if (event.start >= threshold - EPSILON) event.start += shift;
      }
      ensureScoreLength(score, Math.max(...part.events.map(eventEnd), eventEnd(candidate)));
      return;
    }
    // Merge is valid for chords at the same onset, but not for overlapping sequential notes.
    const chordCompatible = candidate.type === 'note' && conflicts.every(event => event.type === 'note' && Math.abs(event.start - candidate.start) < EPSILON && Math.abs(event.duration - candidate.duration) < EPSILON);
    if (!chordCompatible) throw new Error('The destination layer contains overlapping music. Choose Replace conflicts or Shift existing notes.');
    candidate.allowChord = true;
  }

  function pasteClipboard(score, clipboard, options = {}) {
    if (!clipboard || clipboard.type !== 'airmonlink-event-clipboard') throw new Error('Clipboard does not contain Airmonlink Composer events.');
    const targetStart = Math.max(0, Number(options.start) || 0);
    const targetPartId = options.partId || null;
    const created = [];
    const sourceToTargetPart = new Map();
    const sourceEventMap = new Map();
    const affected = new Set();
    ensureScoreLength(score, targetStart + Math.max(.0625, Number(clipboard.span) || 0));
    for (const item of clipboard.events || []) {
      let part = targetPartId ? score.parts.find(candidate => candidate.id === targetPartId) : score.parts.find(candidate => candidate.id === item.sourcePartId);
      if (!part) {
        if (!sourceToTargetPart.has(item.sourcePartId)) sourceToTargetPart.set(item.sourcePartId, score.parts[0]?.id || null);
        part = score.parts.find(candidate => candidate.id === sourceToTargetPart.get(item.sourcePartId));
      }
      if (!part) continue;
      const event = prepareClipboardEvent(item, clipboard, targetStart, options);
      applyConflictStrategy(score, part, event, options, clipboard);
      const inserted = event.type === 'rest' ? model.addRest(score, part.id, event) : addNoteAcrossBarlines(score, part.id, event);
      const insertedEvents = Array.isArray(inserted) ? inserted : [inserted];
      created.push(...insertedEvents.map(value => ({ partId: part.id, event: value })));
      sourceEventMap.set(String(item.sourceEventId), { first: insertedEvents[0], last: insertedEvents.at(-1), partId: part.id });
      affected.add(part.id);
    }
    if (options.includeMarkings !== false) for (const sourceSpanner of clipboard.spanners || []) {
      const start = sourceEventMap.get(String(sourceSpanner.startSourceEventId));
      const end = sourceEventMap.get(String(sourceSpanner.endSourceEventId));
      if (!start || !end || start.partId !== end.partId) continue;
      const startEvent = start.last || start.first;
      const endEvent = end.first || end.last;
      if (sourceSpanner.type === 'tie') model.addTie(score, startEvent.id, endEvent.id, sourceSpanner);
      else if (sourceSpanner.type === 'slur') model.addSlur(score, startEvent.id, endEvent.id, sourceSpanner);
    }
    for (const partId of affected) {
      const part = score.parts.find(item => item.id === partId); if (part) model.normalizeChordIds(part);
      if (score.settings.autoFillRests !== false) model.regenerateAutoRests(score, partId);
    }
    return created;
  }

  function duplicateSelection(score, selection, options = {}) {
    const clipboard = makeClipboard(score, selection);
    if (!clipboard) return [];
    const entries = selectedEntries(score, selection);
    const spanEnd = Math.max(...entries.map(({ event }) => (Number(event.start) || 0) + (Number(event.duration) || 0)));
    const offset = Number(options.offset);
    const start = Number.isFinite(offset) ? clipboard.origin + offset : spanEnd;
    while (start >= model.totalBeats(score) - EPSILON) model.appendMeasures(score, 1);
    return pasteClipboard(score, clipboard, { start });
  }

  function transposeSelection(score, selection, semitones) {
    const amount = Number(semitones) || 0;
    let count = 0;
    const affected = new Set();
    for (const { part, event } of selectedEntries(score, selection)) {
      if (event.type !== 'note') continue;
      event.midi = theory.clamp(Math.round((Number(event.midi) || 60) + amount), 0, 127);
      event.writtenPitch = null;
      event.pitch = theory.spellMidiForKey(event.midi, model.effectiveKey(score, model.measureIndexAt(score, event.start)));
      count += 1;
      affected.add(part.id);
    }
    for (const partId of affected) model.regenerateAutoRests(score, partId);
    if (count) model.touch(score);
    return count;
  }

  function moveSelection(score, selection, options = {}) {
    const targetPart = options.partId ? score.parts.find(part => part.id === options.partId) : null;
    const affected = new Set();
    const moved = [];
    for (const entry of selectedEntries(score, selection)) {
      const { part, event } = entry;
      const destination = targetPart || part;
      const clone = JSON.parse(JSON.stringify(event));
      clone.voice = options.voice != null ? Math.max(1, Math.min(4, Number(options.voice) || 1)) : clone.voice;
      if (options.staff !== undefined) clone.staff = options.staff;
      if (options.startDelta) clone.start = Math.max(0, Number(clone.start) + Number(options.startDelta));
      part.events = part.events.filter(item => item.id !== event.id);
      destination.events.push(clone);
      affected.add(part.id); affected.add(destination.id);
      moved.push({ partId: destination.id, event: clone });
    }
    for (const partId of affected) model.regenerateAutoRests(score, partId);
    if (moved.length) model.touch(score);
    return moved;
  }

  function addNoteAcrossBarlines(score, partId, note) {
    const duration = Math.max(.0625, Number(note.duration) || 1);
    let cursor = Math.max(0, Number(note.start) || 0);
    let remaining = duration;
    const segments = [];
    while (remaining > EPSILON) {
      let measureIndex = model.measureIndexAt(score, cursor);
      let bounds = model.measureBounds(score, measureIndex);
      if (cursor >= bounds.end - EPSILON) {
        if (measureIndex >= score.measures.length - 1) model.appendMeasures(score, 1);
        measureIndex = Math.min(measureIndex + 1, score.measures.length - 1);
        bounds = model.measureBounds(score, measureIndex);
        cursor = bounds.start;
      }
      const available = Math.max(0, bounds.end - cursor);
      const segmentDuration = Math.min(remaining, available);
      if (segmentDuration <= EPSILON) throw new Error('The note could not be placed in the selected measure.');
      const segment = {
        ...JSON.parse(JSON.stringify(note)),
        start: cursor,
        duration: segmentDuration,
        tieStop: segments.length > 0,
        tieStart: remaining > segmentDuration + EPSILON
      };
      if (segments.length > 0) {
        segment.lyrics = [];
        segment.lyric = '';
        segment.melisma = false;
      }
      const validation = model.canPlaceEvent(score, partId, { ...segment, allowAcrossBarline: false });
      if (!validation.ok) throw new Error(validation.reason);
      segments.push(model.addNote(score, partId, segment));
      cursor += segmentDuration;
      remaining -= segmentDuration;
    }
    if (segments.length > 1) {
      const tieGroupId = `tie-${segments[0].id}`;
      for (const segment of segments) segment.tieGroupId = tieGroupId;
      for (let index = 0; index < segments.length - 1; index += 1) model.addTie(score, segments[index].id, segments[index + 1].id, { generated: true });
    }
    return segments;
  }

  function copySelectionToLayer(score, selection, targetVoice, options = {}) {
    const clipboard = makeClipboard(score, selection);
    if (!clipboard) throw new Error('Select one or more notes or rests first.');
    const entries = selectedEntries(score, selection);
    const partId = options.partId || entries[0]?.part?.id || null;
    return pasteClipboard(score, clipboard, {
      start: Number.isFinite(Number(options.start)) ? Number(options.start) : clipboard.origin,
      partId,
      staff: options.staff !== undefined ? options.staff : entries[0]?.event?.staff,
      voice: Math.max(1, Math.min(4, Number(targetVoice) || 1)),
      conflictMode: options.conflictMode || 'replace-conflicts',
      includeLyrics: options.includeLyrics !== false,
      includeMarkings: options.includeMarkings !== false
    });
  }

  function replaceRange(score, selection, clipboard, options = {}) {
    const destination = selectedEntries(score, selection);
    if (!destination.length) throw new Error('Select the destination notes or rests to replace.');
    const start = Math.min(...destination.map(({ event }) => Number(event.start) || 0));
    const partId = options.partId || destination[0].part.id;
    const voice = options.voice != null ? options.voice : destination[0].event.voice || 1;
    const staff = options.staff !== undefined ? options.staff : destination[0].event.staff || null;
    const contentMode = options.contentMode || 'all';
    if (contentMode === 'pitch-only') {
      const sourceNotes = (clipboard.events || []).map(item => item.event).filter(event => event.type === 'note');
      const targetNotes = destination.filter(({ event }) => event.type === 'note').sort((a, b) => a.event.start - b.event.start);
      if (!sourceNotes.length || !targetNotes.length) throw new Error('Pitch-only replacement requires notes in both source and destination.');
      targetNotes.forEach(({ event }, index) => {
        const source = sourceNotes[index % sourceNotes.length];
        event.midi = source.midi;
        event.pitch = source.pitch;
        event.writtenPitch = source.writtenPitch || null;
      });
      model.touch(score);
      return targetNotes.map(({ part, event }) => ({ partId: part.id, event }));
    }
    let prepared = clipboard;
    if (contentMode === 'rhythm-only') {
      const targetPitches = destination.filter(({ event }) => event.type === 'note').map(({ event }) => ({ midi: event.midi, pitch: event.pitch, writtenPitch: event.writtenPitch || null }));
      if (!targetPitches.length) throw new Error('Rhythm-only replacement requires destination notes whose pitches can be preserved.');
      prepared = JSON.parse(JSON.stringify(clipboard));
      let pitchIndex = 0;
      for (const item of prepared.events || []) if (item.event.type === 'note') Object.assign(item.event, targetPitches[(pitchIndex++) % targetPitches.length]);
    }
    deleteSelection(score, selection);
    return pasteClipboard(score, prepared, {
      ...options, start, partId, voice, staff,
      conflictMode: 'replace-conflicts'
    });
  }

  return {
    selectedEntries, makeClipboard, deleteSelection, pasteClipboard, duplicateSelection,
    transposeSelection, moveSelection, addNoteAcrossBarlines, copySelectionToLayer, replaceRange
  };
});
