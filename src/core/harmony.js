(function (root, factory) {
  const theory = root.AirmonMusicTheory || (typeof require === 'function' ? require('./music-theory') : null);
  const model = root.AirmonScoreModel || (typeof require === 'function' ? require('./score-model') : null);
  const api = factory(theory, model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonHarmony = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (theory, model) {
  'use strict';

  const VOICES = ['soprano', 'alto', 'tenor', 'bass'];
  const RANGES = { soprano: [60, 81], alto: [55, 74], tenor: [48, 69], bass: [40, 64] };
  const COMMON_PROGRESSIONS = {
    hymn: [1, 4, 1, 5, 1, 4, 5, 1], classical: [1, 2, 5, 1, 4, 2, 5, 1],
    gospel: [1, 6, 2, 5, 1, 4, 2, 5], worship: [1, 5, 6, 4, 1, 5, 4, 4], simple: [1, 4, 5, 1, 1, 4, 5, 1]
  };

  function voices() { return [...VOICES]; }
  function roman(degree) { return ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'][degree - 1] || 'I'; }
  function chordForMelody(midi, key, preferredDegree, mode) {
    const pc = theory.mod(midi, 12); const candidates = [];
    for (let degree = 1; degree <= 7; degree += 1) { const triad = theory.diatonicTriad(degree, key, mode); if (triad.includes(pc)) candidates.push({ degree, triad }); }
    return candidates.find(candidate => candidate.degree === preferredDegree) || candidates.find(candidate => [1, 4, 5].includes(candidate.degree)) || candidates[0] || { degree: 1, triad: theory.diatonicTriad(1, key, mode) };
  }
  function chooseChordTone(triad, voice, index, variantIndex) {
    if (voice === 'bass') return triad[(variantIndex + index) % 3 === 1 ? 1 : (variantIndex + index) % 3 === 2 ? 2 : 0];
    const patterns = [[1, 2, 0, 1, 2, 1], [2, 0, 1, 2, 0, 2], [0, 2, 1, 0, 1, 2]];
    return triad[patterns[variantIndex % patterns.length][index % 6]];
  }
  function buildVoicing(melodyMidi, triad, previous = {}, options = {}) {
    const melodyVoice = options.melodyVoice || 'soprano'; const variantIndex = Number(options.variantIndex) || 0; const chordIndex = Number(options.chordIndex) || 0;
    const target = { soprano: previous.soprano ?? 69, alto: previous.alto ?? 64, tenor: previous.tenor ?? 57, bass: previous.bass ?? 48 };
    const result = { [melodyVoice]: melodyMidi };
    VOICES.forEach(voice => {
      if (voice === melodyVoice) return;
      const [min, max] = RANGES[voice]; const pc = chooseChordTone(triad, voice, chordIndex + VOICES.indexOf(voice), variantIndex);
      let note = theory.nearestPitchClass(pc, target[voice], min, max);
      if (variantIndex === 1 && voice !== 'bass' && chordIndex % 2 === 1 && note + 12 <= max) note += 12;
      result[voice] = note;
    });
    if (result.alto >= result.soprano) result.alto = theory.nearestPitchClass(theory.mod(result.alto, 12), result.soprano - 4, ...RANGES.alto);
    if (result.tenor >= result.alto) result.tenor = theory.nearestPitchClass(theory.mod(result.tenor, 12), result.alto - 5, ...RANGES.tenor);
    if (result.bass >= result.tenor) result.bass = theory.nearestPitchClass(theory.mod(result.bass, 12), result.tenor - 8, ...RANGES.bass);
    VOICES.forEach(voice => { result[voice] = theory.clamp(result[voice], RANGES[voice][0], RANGES[voice][1]); });
    return result;
  }

  function sourceMelodyEvents(score, sourcePart, options = {}) {
    const sourceVoice = options.sourceVoice == null ? null : Number(options.sourceVoice);
    const sourceStaff = options.sourceStaff == null || options.sourceStaff === 'all' ? null : options.sourceStaff;
    let notes = sourcePart.events.filter(event => event.type === 'note' && event.generatedBy !== 'gap-fill');
    if (sourceVoice != null) notes = notes.filter(event => (event.voice || 1) === sourceVoice);
    if (sourceStaff != null) notes = notes.filter(event => (event.staff || null) === sourceStaff);
    const authored = notes.filter(event => !event.generated && event.generatedBy !== 'harmony');
    return (authored.length ? authored : notes).map(event => ({ ...event, lyrics: Array.isArray(event.lyrics) ? event.lyrics.map(item => ({ ...item })) : undefined })).sort((a, b) => a.start - b.start || a.midi - b.midi);
  }

  function generateVariant(score, options = {}) {
    const sourcePart = score.parts.find(part => part.id === options.sourcePartId) || score.parts[0];
    const melodyEvents = sourceMelodyEvents(score, sourcePart, options);
    if (!melodyEvents.length) throw new Error('The selected staff/layer has no melody notes.');
    const style = options.style || 'hymn'; const progression = COMMON_PROGRESSIONS[style] || COMMON_PROGRESSIONS.hymn;
    const melodyVoice = options.melodyVoice || 'soprano'; const variantIndex = Number(options.variantIndex) || 0; const generationGroupId = model.uid('harmony');
    let previous = {}; const eventsByVoice = { soprano: [], alto: [], tenor: [], bass: [] }; const chords = [];
    melodyEvents.forEach((event, index) => {
      const key = model.effectiveKey(score, model.measureIndexAt(score, event.start));
      const preferredDegree = progression[(index + variantIndex) % progression.length];
      const chord = chordForMelody(event.midi, key, preferredDegree, /m$/.test(key) ? 'minor' : score.settings.mode);
      const voicing = buildVoicing(event.midi, chord.triad, previous, { melodyVoice, variantIndex, chordIndex: index }); previous = voicing;
      VOICES.forEach(voice => {
        const melody = voice === melodyVoice; const midi = melody ? event.midi : voicing[voice];
        eventsByVoice[voice].push({
          ...(melody ? event : {}), id: model.uid(melody ? 'melody-preview' : 'generated-preview'), type: 'note', midi,
          pitch: melody ? event.pitch : theory.spellMidiForKey(midi, key), writtenPitch: melody ? event.writtenPitch || null : null,
          staff: melody ? event.staff || null : null, start: event.start, duration: event.duration,
          velocity: melody ? event.velocity || 94 : 76, voice: melody ? event.voice || 1 : 1,
          lyric: melody ? event.lyric || '' : '', lyrics: melody && Array.isArray(event.lyrics) ? event.lyrics.map(item => ({ ...item })) : [],
          generated: !melody, generatedBy: melody ? null : 'harmony', generationGroupId: melody ? null : generationGroupId, sourceEventId: event.id
        });
      });
      chords.push({ id: model.uid('chord-preview'), start: event.start, degree: chord.degree, symbol: roman(chord.degree), pitches: chord.triad, generated: true, generatedBy: 'harmony', generationGroupId });
    });
    const variant = {
      id: model.uid('variant'), style, variantIndex, melodyVoice, sourcePartId: sourcePart.id, sourcePartName: sourcePart.name,
      sourceVoice: options.sourceVoice == null ? null : Number(options.sourceVoice), sourceStaff: options.sourceStaff || null,
      destination: options.destination || 'satb-parts', sourceEvents: melodyEvents, generationGroupId, eventsByVoice, chords
    };
    variant.issues = inspectVoicing(eventsByVoice); variant.signature = VOICES.map(voice => eventsByVoice[voice].map(event => event.midi).join(',')).join('|'); return variant;
  }

  function inspectVoicing(eventsByVoice) {
    const issues = []; const count = Math.max(...VOICES.map(voice => eventsByVoice[voice]?.length || 0), 0);
    for (let index = 0; index < count; index += 1) {
      const current = Object.fromEntries(VOICES.map(voice => [voice, eventsByVoice[voice]?.[index]]));
      if (current.soprano && current.alto && current.soprano.midi - current.alto.midi > 12) issues.push({ index, severity: 'warning', message: 'Excessive spacing between soprano and alto.' });
      if (current.alto && current.tenor && current.alto.midi - current.tenor.midi > 12) issues.push({ index, severity: 'warning', message: 'Excessive spacing between alto and tenor.' });
      if (current.soprano && current.alto && current.soprano.midi < current.alto.midi) issues.push({ index, severity: 'warning', message: 'Soprano and alto cross.' });
      if (current.alto && current.tenor && current.alto.midi < current.tenor.midi) issues.push({ index, severity: 'warning', message: 'Alto and tenor cross.' });
      if (current.tenor && current.bass && current.tenor.midi < current.bass.midi) issues.push({ index, severity: 'warning', message: 'Tenor and bass cross.' });
      if (!index) continue;
      const previous = Object.fromEntries(VOICES.map(voice => [voice, eventsByVoice[voice]?.[index - 1]]));
      for (let a = 0; a < VOICES.length; a += 1) for (let b = a + 1; b < VOICES.length; b += 1) {
        const first = VOICES[a]; const second = VOICES[b]; if (!previous[first] || !previous[second] || !current[first] || !current[second]) continue;
        const oldInterval = Math.abs(previous[first].midi - previous[second].midi) % 12; const newInterval = Math.abs(current[first].midi - current[second].midi) % 12;
        const moveA = Math.sign(current[first].midi - previous[first].midi); const moveB = Math.sign(current[second].midi - previous[second].midi);
        if (moveA !== 0 && moveA === moveB && oldInterval === 7 && newInterval === 7) issues.push({ index, severity: 'warning', message: `Parallel fifth between ${first} and ${second}.` });
        if (moveA !== 0 && moveA === moveB && oldInterval === 0 && newInterval === 0) issues.push({ index, severity: 'warning', message: `Parallel octave between ${first} and ${second}.` });
      }
    }
    return issues;
  }

  function generateAlternatives(score, options = {}) {
    const requested = options.style || 'hymn'; const styles = [requested, requested === 'classical' ? 'hymn' : 'classical', requested === 'worship' ? 'gospel' : 'worship'];
    const alternatives = styles.map((style, variantIndex) => generateVariant(score, { ...options, style, variantIndex }));
    for (let index = 1; index < alternatives.length; index += 1) if (alternatives[index].signature === alternatives[0].signature) {
      alternatives[index].eventsByVoice.bass.forEach((event, eventIndex) => { if (eventIndex % 2 === index % 2 && event.midi + 12 <= RANGES.bass[1]) event.midi += 12; event.pitch = theory.spellMidiForKey(event.midi, model.effectiveKey(score, model.measureIndexAt(score, event.start))); });
      alternatives[index].signature = VOICES.map(voice => alternatives[index].eventsByVoice[voice].map(event => event.midi).join(',')).join('|'); alternatives[index].issues = inspectVoicing(alternatives[index].eventsByVoice);
    }
    return alternatives;
  }

  function locateVoiceParts(score, createMissing = true) {
    const map = {};
    score.parts.forEach(part => { const role = String(part.harmonyRole || part.instrumentKey || part.name).toLowerCase(); VOICES.forEach(voice => { if (!map[voice] && role.includes(voice)) map[voice] = part; }); });
    if (createMissing) VOICES.forEach(voice => { if (!map[voice]) { map[voice] = model.createPart(voice, { bracketGroup: 'choir' }); score.parts.push(map[voice]); } });
    return map;
  }

  function removePreviousHarmony(score, options = {}) {
    score.parts.forEach(part => {
      part.events = part.events.filter(event => {
        if (event.generatedBy !== 'harmony') return true;
        if (options.sourcePartId && event.harmonySourcePartId && event.harmonySourcePartId !== options.sourcePartId) return true;
        return false;
      }); model.normalizeEvents(part);
    });
    score.parts = score.parts.filter(part => !(part.generatedBy === 'harmony' && (!options.sourcePartId || part.harmonySourcePartId === options.sourcePartId)));
    score.chordSymbols = (score.chordSymbols || []).filter(chord => !(chord.generatedBy === 'harmony' && (!options.sourcePartId || !chord.harmonySourcePartId || chord.harmonySourcePartId === options.sourcePartId)));
  }

  function cloneGenerated(event, variant, voice, patch = {}) {
    return {
      ...event, ...patch, id: model.uid('generated'), generated: true, generatedBy: 'harmony', generationGroupId: variant.generationGroupId,
      harmonyVoice: voice, harmonySourcePartId: variant.sourcePartId, sourceEventId: event.sourceEventId || event.id,
      lyric: voice === variant.melodyVoice ? event.lyric || '' : '', lyrics: voice === variant.melodyVoice ? event.lyrics || [] : []
    };
  }

  function applyToSatbParts(score, variant) {
    const map = locateVoiceParts(score, true);
    VOICES.forEach(voice => {
      const target = map[voice];
      const preserved = target.events.filter(event => event.generatedBy !== 'harmony');
      const sourceIsTargetMelody = target.id === variant.sourcePartId && voice === variant.melodyVoice;
      const generated = sourceIsTargetMelody ? [] : (variant.eventsByVoice[voice] || []).map(event => cloneGenerated(event, variant, voice, { voice: 1, staff: null }));
      target.events = [...preserved, ...generated];
      target.harmonyRole = voice; model.activateVoice(target, 1); model.normalizeEvents(target);
    });
    return { changedVoices: 4, destination: 'SATB staves' };
  }


  function layerMapForVariant(variant) {
    const sourceLayer = Math.max(1, Number(variant.sourceVoice) || Number(variant.sourceEvents[0]?.voice) || 1);
    const remaining = [1, 2, 3, 4, 5, 6, 7, 8].filter(value => value !== sourceLayer);
    const map = {}; map[variant.melodyVoice] = sourceLayer;
    VOICES.filter(voice => voice !== variant.melodyVoice).forEach((voice, index) => { map[voice] = remaining[index]; });
    return map;
  }

  function applyToSamePartLayers(score, variant, splitGrandStaff = false) {
    const target = score.parts.find(part => part.id === variant.sourcePartId); if (!target) throw new Error('Source part no longer exists.');
    const layerMap = layerMapForVariant(variant);
    target.events = target.events.filter(event => event.generatedBy !== 'harmony');
    VOICES.forEach(voice => {
      if (voice === variant.melodyVoice) return;
      const staff = splitGrandStaff && model.isMultiStaff(target) ? (voice === 'tenor' || voice === 'bass' ? 'bass' : 'treble') : (variant.sourceStaff && variant.sourceStaff !== 'all' ? variant.sourceStaff : variant.sourceEvents[0]?.staff || (model.isMultiStaff(target) ? model.defaultStaff(target, 72) : null));
      (variant.eventsByVoice[voice] || []).forEach(event => target.events.push(cloneGenerated(event, variant, voice, { voice: layerMap[voice], staff })));
      model.activateVoice(target, layerMap[voice]);
    });
    model.normalizeEvents(target); return { changedVoices: 3, destination: splitGrandStaff ? 'same piano grand staff' : 'layers on current staff' };
  }

  function applyToNewParts(score, variant) {
    const group = `harmony-${variant.generationGroupId}`;
    VOICES.forEach(voice => {
      const target = model.createPart(voice, {
        name: `${voice[0].toUpperCase()}${voice.slice(1)} Harmony`, shortName: `${voice[0].toUpperCase()}H.`,
        bracketGroup: group, harmonyRole: voice, generated: true, generatedBy: 'harmony',
        generationGroupId: variant.generationGroupId, harmonySourcePartId: variant.sourcePartId
      });
      target.events = (variant.eventsByVoice[voice] || []).map(event => cloneGenerated(event, variant, voice, { voice: 1, staff: null }));
      score.parts.push(target);
    });
    return { changedVoices: 4, destination: 'new harmony staves' };
  }


  function applyVariant(score, variant, options = {}) {
    if (!variant?.eventsByVoice) throw new Error('Invalid harmony variant.');
    removePreviousHarmony(score, { sourcePartId: variant.sourcePartId });
    const destination = options.destination || variant.destination || 'satb-parts';
    let result;
    if (destination === 'same-layers') result = applyToSamePartLayers(score, variant, false);
    else if (destination === 'same-grand') result = applyToSamePartLayers(score, variant, true);
    else if (destination === 'new-staves') result = applyToNewParts(score, variant);
    else result = applyToSatbParts(score, variant);
    score.chordSymbols = [...(score.chordSymbols || []).filter(chord => !(chord.generatedBy === 'harmony' && chord.harmonySourcePartId === variant.sourcePartId)), ...variant.chords.map(chord => ({ ...chord, id: model.uid('chord'), generated: true, generatedBy: 'harmony', generationGroupId: variant.generationGroupId, harmonySourcePartId: variant.sourcePartId }))];
    score.arrangement = {
      engine: 'Airmonlink Harmony 0.3', activeVariantId: variant.id, generationGroupId: variant.generationGroupId,
      sourcePartId: variant.sourcePartId, sourceVoice: variant.sourceVoice, sourceStaff: variant.sourceStaff,
      melodyVoice: variant.melodyVoice, style: variant.style, destination, appliedAt: new Date().toISOString(),
      issues: variant.issues.map(issue => ({ ...issue })), voiceEventCounts: Object.fromEntries(VOICES.map(voice => [voice, variant.eventsByVoice[voice]?.length || 0]))
    };
    if (score.settings.autoFillRests !== false) model.regenerateAutoRests(score); model.touch(score);
    return { groupId: variant.generationGroupId, style: variant.style, ...result };
  }

  return { COMMON_PROGRESSIONS, commonProgressions: COMMON_PROGRESSIONS, chordForMelody, buildVoicing, sourceMelodyEvents, inspectVoicing, generateVariant, generateAlternatives, removePreviousHarmony, applyVariant, voices };
});
