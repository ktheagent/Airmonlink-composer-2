(function (root, factory) {
  const model = root.AirmonScoreModel || (typeof require === 'function' ? require('./score-model') : null);
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonLayoutEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model) {
  'use strict';

  const EPSILON = 1e-8;

  function eventIntersects(bounds, event) {
    return Number(event.start) < bounds.end - EPSILON && Number(event.start) + Number(event.duration || 0) > bounds.start + EPSILON;
  }

  function visibleEvents(score, measureIndex) {
    const bounds = model.measureBounds(score, measureIndex);
    return (score.parts || []).flatMap(part => (part.events || [])
      .filter(event => !event.hidden && eventIntersects(bounds, event))
      .map(event => ({ part, event })));
  }

  function textAtMeasure(score, measureIndex) {
    const bounds = model.measureBounds(score, measureIndex);
    const annotations = (score.annotations || []).filter(item => {
      const beat = Number(item.start ?? item.tick ?? bounds.start);
      return beat >= bounds.start - EPSILON && beat < bounds.end - EPSILON;
    });
    const chords = (score.chordSymbols || []).filter(item => {
      const beat = Number(item.start ?? item.tick ?? bounds.start);
      return beat >= bounds.start - EPSILON && beat < bounds.end - EPSILON;
    });
    return [...annotations, ...chords];
  }

  function eventClearance(event) {
    let left = 6;
    let right = 7;
    if (event.type === 'note') {
      if (/[#bx♯♭𝄪𝄫]/.test(String(event.pitch || event.writtenPitch || ''))) left += 10;
      if (Number(event.dots) > 0 || [1.5, .75, .375, 3, 6].some(value => Math.abs(Number(event.duration) - value) < EPSILON)) right += 7;
      if ((event.articulations || []).length) right += 3;
      const lyrics = Array.isArray(event.lyrics) ? event.lyrics : [];
      const longest = Math.max(0, ...lyrics.map(item => String(item.text || '').length));
      if (longest) right += Math.min(42, longest * 2.6);
    } else {
      right += 3;
    }
    return { left, right };
  }

  function measureContentProfile(score, measureIndex) {
    const bounds = model.measureBounds(score, measureIndex);
    const refs = visibleEvents(score, measureIndex);
    const starts = new Map();
    let lyricVerses = 0;
    let lyricCharacters = 0;
    let maxChordSize = 1;
    let shortest = bounds.capacity || 1;

    for (const { part, event } of refs) {
      const localStart = Math.max(bounds.start, Number(event.start));
      const key = localStart.toFixed(8);
      if (!starts.has(key)) starts.set(key, { beat: localStart, refs: [] });
      starts.get(key).refs.push({ part, event });
      shortest = Math.min(shortest, Math.max(.0625, Number(event.duration) || 1));
      const lyrics = Array.isArray(event.lyrics) ? event.lyrics : [];
      lyricVerses = Math.max(lyricVerses, ...lyrics.map(item => Number(item.verse) || 1), 0);
      lyricCharacters = Math.max(lyricCharacters, ...lyrics.map(item => String(item.text || '').length), 0);
    }

    for (const segment of starts.values()) {
      const groups = new Map();
      for (const { part, event } of segment.refs) {
        if (event.type !== 'note') continue;
        const key = `${part.id}|${event.staff || ''}|${event.voice || 1}|${Number(event.duration).toFixed(8)}`;
        groups.set(key, (groups.get(key) || 0) + 1);
      }
      maxChordSize = Math.max(maxChordSize, ...groups.values(), 1);
    }

    const textItems = textAtMeasure(score, measureIndex);
    const rhythmicDensity = starts.size;
    const durationDensity = bounds.capacity ? Math.max(1, bounds.capacity / Math.max(.0625, shortest)) : 1;
    const minWidth = Math.max(
      118,
      68 + rhythmicDensity * 19 + Math.sqrt(durationDensity) * 10 + Math.min(52, lyricCharacters * 2.8) + (lyricVerses > 1 ? (lyricVerses - 1) * 8 : 0) + (maxChordSize - 1) * 7 + textItems.length * 10
    );

    return {
      measureIndex,
      bounds,
      refs,
      segments: Array.from(starts.values()).sort((a, b) => a.beat - b.beat),
      lyricVerses,
      lyricCharacters,
      maxChordSize,
      shortest,
      textItems,
      minWidth
    };
  }

  function buildSystemPlan(score, options = {}) {
    const staffX = Number(options.staffX) || 132;
    const rightPadding = Number(options.rightPadding) || 28;
    const availableWidth = Math.max(220, Number(options.availableWidth) || 650);
    const minMeasures = Math.max(1, Number(options.minMeasures) || 1);
    const maxMeasures = Math.max(minMeasures, Number(options.maxMeasures) || 8);
    const profiles = score.measures.map((_, measureIndex) => measureContentProfile(score, measureIndex));
    const systems = [];
    let current = [];
    let currentMinimum = 0;

    function flush() {
      if (!current.length) return;
      const available = availableWidth;
      const firstMeasureIndex = current[0].measureIndex;
      const firstMeasure = score.measures[firstMeasureIndex] || {};
      const totalMinimum = current.reduce((sum, item) => sum + item.minWidth, 0);
      const extra = Math.max(0, available - totalMinimum);
      const totalWeight = current.reduce((sum, item) => sum + Math.max(1, item.minWidth), 0);
      let x = staffX;
      const frames = current.map((profile, index) => {
        const width = profile.minWidth + (index === current.length - 1 ? available - totalMinimum - current.slice(0, -1).reduce((sum, item) => sum + extra * (Math.max(1, item.minWidth) / totalWeight), 0) : extra * (Math.max(1, profile.minWidth) / totalWeight));
        const frame = { measureIndex: profile.measureIndex, x, width: Math.max(96, width), right: x + Math.max(96, width), profile };
        x = frame.right;
        return frame;
      });
      systems.push({
        index: systems.length,
        measureIndices: current.map(item => item.measureIndex),
        frames,
        minimumWidth: totalMinimum,
        usedWidth: x - staffX,
        manualBreakBefore: firstMeasureIndex > 0 && Boolean(firstMeasure.newSystem || firstMeasure.newPage),
        newPage: firstMeasureIndex > 0 && Boolean(firstMeasure.newPage)
      });
      current = [];
      currentMinimum = 0;
    }

    for (const profile of profiles) {
      const measure = score.measures[profile.measureIndex] || {};
      const forcedBreak = profile.measureIndex > 0 && Boolean(measure.newSystem || measure.newPage);
      if (forcedBreak && current.length) flush();
      const wouldOverflow = current.length >= minMeasures && (currentMinimum + profile.minWidth > availableWidth || current.length >= maxMeasures);
      if (wouldOverflow) flush();
      current.push(profile);
      currentMinimum += profile.minWidth;
    }
    flush();

    return { staffX, rightPadding, availableWidth, profiles, systems };
  }

  function rhythmicPosition(frame, beat, insetValue = 14) {
    const profile = frame.profile;
    const bounds = profile.bounds;
    const inset = Math.max(0, Number(insetValue) || 0);
    const usable = Math.max(24, frame.width - inset - 10);
    const target = Math.max(bounds.start, Math.min(bounds.end - EPSILON, Number(beat) || bounds.start));
    const segmentPoints = [bounds.start, ...profile.segments.map(item => item.beat).filter(value => value > bounds.start + EPSILON && value < bounds.end - EPSILON), bounds.end];
    const unique = Array.from(new Set(segmentPoints.map(value => Number(value.toFixed(8))))).sort((a, b) => a - b);
    if (unique.length <= 2) {
      const fraction = bounds.capacity ? (target - bounds.start) / bounds.capacity : 0;
      return frame.x + inset + Math.max(0, Math.min(.9999, fraction)) * usable;
    }

    const intervals = [];
    let totalWeight = 0;
    for (let index = 0; index < unique.length - 1; index += 1) {
      const start = unique[index];
      const end = unique[index + 1];
      const duration = Math.max(.0001, end - start);
      const weight = Math.max(.35, Math.sqrt(duration));
      intervals.push({ start, end, duration, weight });
      totalWeight += weight;
    }
    let x = frame.x + inset;
    for (const interval of intervals) {
      const width = usable * interval.weight / totalWeight;
      if (target < interval.end - EPSILON) return x + ((target - interval.start) / interval.duration) * width;
      x += width;
    }
    return frame.right - 10;
  }

  function beatForX(frame, x, insetValue = 14) {
    const profile = frame.profile;
    const bounds = profile.bounds;
    const inset = Math.max(0, Number(insetValue) || 0);
    const usable = Math.max(24, frame.width - inset - 10);
    const local = Math.max(0, Math.min(usable, Number(x) - frame.x - inset));
    const segmentPoints = [bounds.start, ...profile.segments.map(item => item.beat).filter(value => value > bounds.start + EPSILON && value < bounds.end - EPSILON), bounds.end];
    const unique = Array.from(new Set(segmentPoints.map(value => Number(value.toFixed(8))))).sort((a, b) => a - b);
    if (unique.length <= 2) return bounds.start + (local / usable) * bounds.capacity;
    const intervals = [];
    let totalWeight = 0;
    for (let index = 0; index < unique.length - 1; index += 1) {
      const start = unique[index];
      const end = unique[index + 1];
      const duration = Math.max(.0001, end - start);
      const weight = Math.max(.35, Math.sqrt(duration));
      intervals.push({ start, end, duration, weight });
      totalWeight += weight;
    }
    let consumed = 0;
    for (const interval of intervals) {
      const width = usable * interval.weight / totalWeight;
      if (local <= consumed + width + EPSILON) return interval.start + Math.max(0, Math.min(1, (local - consumed) / width)) * interval.duration;
      consumed += width;
    }
    return bounds.end - EPSILON;
  }


  function chordNoteheadOffsets(entries, stemUp = true, distance = 7) {
    const notes = (entries || []).filter(item => item && item.id != null && Number.isFinite(Number(item.step)))
      .map(item => ({ ...item, step: Number(item.step) }))
      .sort((a, b) => a.step - b.step || String(a.id).localeCompare(String(b.id)));
    const offsets = Object.create(null);
    notes.forEach(item => { offsets[item.id] = 0; });
    if (notes.length < 2) return offsets;
    const ordered = stemUp ? notes : [...notes].reverse();
    let previous = ordered[0];
    for (let index = 1; index < ordered.length; index += 1) {
      const current = ordered[index];
      if (Math.abs(current.step - previous.step) === 1) {
        offsets[current.id] = offsets[previous.id] === 0 ? (stemUp ? Math.abs(distance) : -Math.abs(distance)) : 0;
      } else {
        offsets[current.id] = 0;
      }
      previous = current;
    }
    return offsets;
  }

  function voiceUnisonOffset(entries, targetId, stemUp, distance = 3) {
    const notes = (entries || []).filter(item => item && item.id != null && Number.isFinite(Number(item.step)));
    const target = notes.find(item => String(item.id) === String(targetId));
    if (!target) return 0;
    const collision = notes.some(item => String(item.id) !== String(target.id) && Number(item.voice) !== Number(target.voice) && Number(item.step) === Number(target.step));
    if (!collision) return 0;
    return stemUp ? -Math.abs(distance) : Math.abs(distance);
  }

  function accidentalColumns(entries, minimumStepGap = 4) {
    const notes = (entries || []).filter(item => item && item.id != null && item.accidental && Number.isFinite(Number(item.step)))
      .map(item => ({ ...item, step: Number(item.step) }))
      .sort((a, b) => b.step - a.step || String(a.id).localeCompare(String(b.id)));
    const columns = Object.create(null);
    const occupied = [];
    for (const note of notes) {
      let column = 0;
      while ((occupied[column] || []).some(step => Math.abs(step - note.step) < minimumStepGap)) column += 1;
      if (!occupied[column]) occupied[column] = [];
      occupied[column].push(note.step);
      columns[note.id] = column;
    }
    return columns;
  }

  function staffVerticalRequirements(score, part, staff = null) {
    const events = (part.events || []).filter(event => !event.hidden && (!staff || (event.staff || null) === staff));
    let lyricVerses = 0;
    let below = 10;
    let above = 10;
    for (const event of events) {
      const lyrics = Array.isArray(event.lyrics) ? event.lyrics : [];
      lyricVerses = Math.max(lyricVerses, ...lyrics.map(item => Number(item.verse) || 1), 0);
      if ((event.articulations || []).some(item => ['fermata', 'strong-accent'].includes(item))) above = Math.max(above, 18);
      if (event.tuplet) above = Math.max(above, 20);
    }
    below += lyricVerses * 14;
    if (score.settings.showSolfa && (!score.settings.solfaStaffVisibility || score.settings.solfaStaffVisibility[`${part.id}:${staff || 'single'}`] !== false)) {
      const solfaHeight = (Number(score.settings.solfaFontSize) || 8) + (Number(score.settings.solfaVerticalSpacing) || 12) + 6;
      if (score.settings.solfaOverlayPosition === 'above') above += solfaHeight;
      else below += solfaHeight;
    }
    const annotations = (score.annotations || []).filter(item => !item.partId || item.partId === part.id);
    if (annotations.some(item => item.placement === 'below')) below += 16;
    if (annotations.some(item => item.placement !== 'below')) above += 16;
    if ((score.chordSymbols || []).some(item => !item.partId || item.partId === part.id)) above += 18;
    return { above, below, lyricVerses };
  }

  return { measureContentProfile, buildSystemPlan, rhythmicPosition, beatForX, staffVerticalRequirements, visibleEvents, chordNoteheadOffsets, voiceUnisonOffset, accidentalColumns };
});
