(function (root, factory) {
  const theory = root.AirmonMusicTheory || (typeof require === 'function' ? require('./music-theory') : null);
  const model = root.AirmonScoreModel || (typeof require === 'function' ? require('./score-model') : null);
  const parser = root.AirmonSolfaParser || (typeof require === 'function' ? require('./solfa-parser') : null);
  const api = factory(theory, model, parser);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonSolfa = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (theory, model, parser) {
  'use strict';

  const DEGREE_NAMES = ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'];
  const CURWEN_NAMES = ['d', 'r', 'm', 'f', 's', 'l', 't'];
  const RAISED = ['di', 'ri', 'ma', 'fi', 'si', 'li', 'ta'];
  const LOWERED = ['de', 'ra', 'me', 'fe', 'se', 'le', 'te'];
  const LA_MINOR_DEGREE_TO_SOLFA_INDEX = [5, 6, 0, 1, 2, 3, 4];
  const LA_MINOR_SOLFA_TO_DEGREE = [3, 4, 5, 6, 7, 1, 2];

  function activeConvention(score, options = {}) {
    return parser.convention(options.convention || score?.settings?.solfaConvention || 'airmonlink-traditional-v1');
  }

  function rhythmContext(score, event) {
    const measureIndex = model.measureIndexAt(score, event.start || 0);
    const bounds = model.measureBounds(score, measureIndex);
    const info = model.timeSignatureInfo(bounds.timeSignature);
    const position = Math.max(0, Number(event.start) - bounds.start);
    const pulse = info.compound ? info.pulseQuarterBeats : info.beatUnitQuarter;
    const withinPulse = pulse ? ((position % pulse) + pulse) % pulse : 0;
    return { measureIndex, bounds, info, position, pulse, withinPulse };
  }

  function rhythmPrefix(event, score) {
    const context = rhythmContext(score, event);
    if (context.position < 1e-8) return '';
    if (context.withinPulse < 1e-8) return ': ';
    if (Math.abs(context.withinPulse - context.pulse / 2) < 1e-8) return '. ';
    if (Math.abs(context.withinPulse - context.pulse / 4) < 1e-8 || Math.abs(context.withinPulse - context.pulse * 3 / 4) < 1e-8) return ', ';
    return '· ';
  }

  function rhythmMark(duration, options = {}) {
    if (options.showRhythm === false) return '';
    const value = Math.max(.0625, Number(duration) || 1);
    const pulse = Math.max(.0625, Number(options.pulse) || 1);
    const extraPulses = Math.max(0, Math.ceil(value / pulse - 1e-8) - 1);
    if (extraPulses) return ` ${Array.from({ length: extraPulses }, () => '—').join(' ')}`;
    if (value >= pulse - 1e-8) return '';
    const ratio = value / pulse;
    if (ratio >= .5 - 1e-8) return '.';
    if (ratio >= .25 - 1e-8) return ',';
    if (ratio >= .125 - 1e-8) return ',,';
    return ',,,';
  }

  function traditionalToken(event, score, syllable, options = {}) {
    const context = rhythmContext(score, event);
    const prefix = rhythmPrefix(event, score);
    const mark = rhythmMark(event.duration, { ...options, pulse: context.pulse });
    return `${prefix}${syllable}${mark}`;
  }

  function effectiveKey(score, part, eventOrMeasure = 0) {
    const measureIndex = typeof eventOrMeasure === 'object' ? model.measureIndexAt(score, eventOrMeasure.start || 0) : Number(eventOrMeasure) || 0;
    const scoreKey = model.effectiveKey(score, measureIndex);
    if (score.settings.concertPitch !== false || !part?.transpose) return scoreKey;
    return theory.transposeKey(scoreKey, Number(part.transpose) + (part.clef === 'treble-8' ? 12 : 0));
  }

  function eventPitch(event, score, part) {
    return theory.writtenPitchForEvent(event, part, effectiveKey(score, part, event), score.settings.concertPitch !== false);
  }

  function eventLyrics(event) {
    if (Array.isArray(event.lyrics) && event.lyrics.length) return event.lyrics.map(item => ({ ...item, verse: Math.max(1, Number(item.verse) || 1), text: item.text || '' }));
    if (event.lyric) return [{ verse: Math.max(1, Number(event.lyricVerse) || 1), text: event.lyric, syllabic: event.syllabic || null, melisma: Boolean(event.melisma) }];
    return [];
  }

  function lyricPublicationText(lyric, fallback = '') {
    if (!lyric) return fallback;
    const base = String(lyric.text || fallback || '');
    if (!base) return '';
    const elision = lyric.elision && !base.endsWith('‿') ? '‿' : '';
    const suffix = lyric.melisma ? (base.endsWith('_') ? '' : '_') :
      (['begin', 'middle'].includes(lyric.syllabic) && !base.endsWith('-') ? '-' : '');
    return `${base}${elision}${suffix}`;
  }

  function normalizeAccidental(value) {
    let accidental = Number(value) || 0;
    while (accidental > 6) accidental -= 12;
    while (accidental < -6) accidental += 12;
    return accidental;
  }

  function degreeInfoForPitch(pitch, key, options = {}) {
    const parsed = theory.parsePitch(pitch);
    const pitchSystem = options.pitchSystem || options.solfaPitchSystem || 'movable-do';
    if (pitchSystem === 'fixed-do') {
      const degree = theory.LETTERS.indexOf(parsed.letter) + 1;
      return { degree, solfaIndex: degree - 1, accidental: parsed.accidental, pitchSystem, mode: 'fixed' };
    }
    const tonic = theory.keyRoot(key);
    const tonicLetterIndex = theory.LETTERS.indexOf(tonic.letter);
    const pitchLetterIndex = theory.LETTERS.indexOf(parsed.letter);
    const degree = theory.mod(pitchLetterIndex - tonicLetterIndex, 7) + 1;
    const actualPc = theory.mod(theory.pitchToMidi(pitch), 12);
    const isMinor = theory.isMinorKey(key, options.mode);
    const minorSystem = options.minorSystem || options.minorSolfaSystem || 'do-based';
    if (isMinor && minorSystem === 'la-based') {
      const expectedPc = theory.mod(tonic.pc + theory.NATURAL_MINOR_SCALE[degree - 1], 12);
      return { degree, solfaIndex: LA_MINOR_DEGREE_TO_SOLFA_INDEX[degree - 1], accidental: normalizeAccidental(actualPc - expectedPc), pitchSystem, mode: 'minor', minorSystem };
    }
    const expectedPc = theory.mod(tonic.pc + theory.MAJOR_SCALE[degree - 1], 12);
    return { degree, solfaIndex: degree - 1, accidental: normalizeAccidental(actualPc - expectedPc), pitchSystem, mode: isMinor ? 'minor' : 'major', minorSystem };
  }

  function syllableForInfo(info, options = {}) {
    const long = options.labelStyle === 'long' || options.notationMode === 'modern';
    const base = info.solfaIndex;
    if (info.accidental === 0) return long ? DEGREE_NAMES[base] : CURWEN_NAMES[base];
    let result = info.accidental > 0 ? RAISED[base] : LOWERED[base];
    const excess = Math.max(0, Math.abs(info.accidental) - 1);
    if (excess) result += (info.accidental > 0 ? '↑' : '↓').repeat(excess);
    return result;
  }

  function notationSyllable(pitch, key, options = {}) {
    if (options.noteNames) return pitch;
    const info = degreeInfoForPitch(pitch, key, options);
    if (options.scaleDegrees) {
      const accidental = info.accidental > 0 ? '↑'.repeat(Math.abs(info.accidental)) : info.accidental < 0 ? '↓'.repeat(Math.abs(info.accidental)) : '';
      return `${accidental}${info.degree}`;
    }
    return syllableForInfo(info, options);
  }

  function octaveMarksForEvent(pitch, key, options = {}) {
    if (options.showOctaveMarks === false) return '';
    const midi = theory.pitchToMidi(pitch);
    const reference = theory.tonicReferenceMidi(key);
    const shift = Math.round((midi - reference) / 12);
    if (shift > 0) return "'".repeat(shift);
    if (shift < 0) return ','.repeat(-shift);
    return '';
  }

  function eventToSolfa(event, score, part, options = {}) {
    const lyrics = eventLyrics(event);
    const common = {
      eventId: event.id, duration: event.duration, start: event.start,
      beatInMeasure: model.beatInMeasure(score, event.start), measureIndex: model.measureIndexAt(score, event.start),
      voice: event.voice || 1, staff: event.staff || null,
      lyrics, lyric: lyrics.find(item => item.verse === (Number(options.verse) || 1))?.text || lyrics[0]?.text || ''
    };
    if (event.type === 'rest') {
      const restSymbol = options.restSymbol || '0';
      return { ...common, text: traditionalToken(event, score, restSymbol, options), syllable: '', octaveMarks: '', rest: true, valid: true, ariaLabel: `Rest for ${event.duration} quarter beats` };
    }
    const key = effectiveKey(score, part, event);
    const pitch = eventPitch(event, score, part);
    const displayMidi = theory.displayMidiForPart(event.midi, part, score.settings.concertPitch !== false);
    const valid = theory.pitchToMidi(pitch) === displayMidi;
    const modeOptions = {
      ...options,
      mode: score.settings.mode,
      pitchSystem: options.pitchSystem || score.settings.solfaPitchSystem || 'movable-do',
      minorSystem: options.minorSystem || score.settings.minorSolfaSystem || 'do-based'
    };
    const syllable = notationSyllable(pitch, key, modeOptions);
    const octaveMarks = octaveMarksForEvent(pitch, key, modeOptions);
    const attached = (score.spanners || []).filter(item => item.startEventId === event.id || item.endEventId === event.id);
    const tiedContinuation = Boolean(event.tieStop || attached.some(item => item.type === 'tie' && item.endEventId === event.id));
    const slurStart = Boolean(event.slurStart || attached.some(item => item.type === 'slur' && item.startEventId === event.id));
    const slurStop = Boolean(event.slurStop || attached.some(item => item.type === 'slur' && item.endEventId === event.id));
    const tokenSyllable = tiedContinuation ? '—' : `${syllable}${octaveMarks}`;
    const tokenText = traditionalToken(event, score, tokenSyllable, options);
    return {
      ...common,
      text: `${slurStart ? '(' : ''}${tokenText}${slurStop ? ')' : ''}`, syllable, octaveMarks, pitch, midi: event.midi, displayMidi, key,
      tiedContinuation, slurStart, slurStop,
      lyricOffsetX: Number(event.lyricOffsetX) || 0, lyricOffsetY: Number(event.lyricOffsetY) || 0,
      rest: false, valid
    };
  }

  function partToSolfa(part, score, options = {}) {
    model.ensureMeasures(score);
    const voice = options.voice == null ? null : Number(options.voice);
    const staff = options.staff == null ? null : options.staff;
    const bars = score.measures.map((measure, index) => {
      const bounds = model.measureBounds(score, index);
      return { index, start: bounds.start, capacity: bounds.capacity, timeSignature: bounds.timeSignature, key: bounds.key, measure, items: [] };
    });
    part.events.filter(event => options.includeAutoRests !== false || event.generatedBy !== 'gap-fill').forEach(event => {
      if (voice != null && (event.voice || 1) !== voice) return;
      if (staff != null && (event.staff || null) !== staff) return;
      const index = model.measureIndexAt(score, event.start);
      bars[index].items.push(eventToSolfa(event, score, part, options));
    });
    bars.forEach(bar => bar.items.sort((a, b) => a.start - b.start || a.voice - b.voice || String(a.eventId).localeCompare(String(b.eventId))));
    return bars.map(bar => {
      const items = bar.items;
      const usage = model.layerCapacity(score, part, bar.index, voice || 1, staff);
      Object.assign(items, { index: bar.index, start: bar.start, capacity: bar.capacity, timeSignature: bar.timeSignature, key: bar.key, measure: bar.measure, used: usage.used, remaining: usage.remaining, complete: usage.complete });
      return items;
    });
  }

  function voiceLabel(part, voice, staff = null) {
    const name = String(part?.name || '').trim();
    if (/^(Soprano|Alto|Tenor|Bass)$/i.test(name) && Number(voice) === 1) return name;
    const staffName = staff ? String(staff).replace(/^staff-/, 'Staff ').replace(/^treble$/, 'Treble').replace(/^bass$/, 'Bass') : '';
    return [name || 'Part', staffName, `Layer ${Number(voice) || 1}`].filter(Boolean).join(' · ');
  }

  function publicationVoiceLabel(part, voice, style = 'short') {
    const name = String(part?.harmonyRole || part?.name || '').toLowerCase();
    const voices = [
      ['soprano', style === 'long' ? 'Soprano' : 'S'],
      ['alto', style === 'long' ? 'Alto' : 'A'],
      ['tenor', style === 'long' ? 'Tenor' : 'T'],
      ['bass', style === 'long' ? 'Bass' : 'B']
    ];
    const found = voices.find(([key]) => name.includes(key));
    if (found) return Number(voice) === 1 ? found[1] : `${found[1]}${Number(voice)}`;
    return style === 'long' ? `Layer ${Number(voice) || 1}` : `L${Number(voice) || 1}`;
  }

  function partLayersToSolfa(part, score, options = {}) {
    const layers = [1, 2, 3, 4];
    const staffs = model.isMultiStaff(part) ? (Array.isArray(part.staffDefinitions) && part.staffDefinitions.length ? part.staffDefinitions.map(item => String(item.id)) : ['treble', 'bass']) : [null];
    return staffs.flatMap(staff => layers.map(voice => ({ voice, staff, label: voiceLabel(part, voice, staff), bars: partToSolfa(part, score, { ...options, voice, staff }) })));
  }

  function parseSyllable(value) { return parser.parsePitchToken(String(value || '').trim()); }

  function pitchForSyllable(value, key = 'C', options = {}) {
    const parsed = parseSyllable(value);
    if (parsed.rest) return null;
    const pitchSystem = options.pitchSystem || options.solfaPitchSystem || 'movable-do';
    const isMinor = theory.isMinorKey(key, options.mode);
    const minorSystem = options.minorSystem || options.minorSolfaSystem || 'do-based';
    let tonic = theory.keyRoot(key);
    let scaleDegree = parsed.degree;
    let baseInterval;
    if (pitchSystem === 'fixed-do') {
      tonic = theory.keyRoot('C');
      baseInterval = theory.MAJOR_SCALE[parsed.degree - 1];
    } else if (isMinor && minorSystem === 'la-based') {
      scaleDegree = LA_MINOR_SOLFA_TO_DEGREE[parsed.degree - 1];
      baseInterval = theory.NATURAL_MINOR_SCALE[scaleDegree - 1];
    } else {
      baseInterval = theory.MAJOR_SCALE[parsed.degree - 1];
    }
    const tonicLetterIndex = theory.LETTERS.indexOf(tonic.letter);
    const absoluteLetterIndex = tonicLetterIndex + scaleDegree - 1;
    const letter = theory.LETTERS[theory.mod(absoluteLetterIndex, 7)];
    const centralTonic = theory.tonicReferenceMidi(pitchSystem === 'fixed-do' ? 'C' : key);
    const unshiftedTarget = centralTonic + baseInterval + parsed.accidental;
    const referenceMidi = Number.isFinite(Number(options.referenceMidi)) ? Number(options.referenceMidi) : unshiftedTarget;
    const registerCycle = Math.round((referenceMidi - unshiftedTarget) / 12);
    const midi = unshiftedTarget + registerCycle * 12 + parsed.octaveShift * 12;
    let octave = Math.floor(midi / 12) - 1;
    let naturalMidi = theory.pitchToMidi(`${letter}${octave}`);
    if (naturalMidi - midi > 6) { octave -= 1; naturalMidi -= 12; }
    else if (midi - naturalMidi > 6) { octave += 1; naturalMidi += 12; }
    const alteration = normalizeAccidental(midi - naturalMidi);
    return `${letter}${theory.accidentalText(alteration)}${octave}`;
  }

  function updateEventFromSolfa(score, partId, eventId, syllable, options = {}) {
    const part = score.parts.find(item => item.id === partId);
    const event = part?.events.find(item => item.id === eventId);
    if (!event || event.type !== 'note') throw new Error('Select a note before editing tonic sol-fa.');
    const key = effectiveKey(score, part, event);
    const currentPitch = eventPitch(event, score, part);
    const pitch = pitchForSyllable(syllable, key, {
      referenceMidi: theory.pitchToMidi(currentPitch), mode: score.settings.mode,
      pitchSystem: score.settings.solfaPitchSystem || 'movable-do', minorSystem: score.settings.minorSolfaSystem || 'do-based', ...options
    });
    if (!pitch) throw new Error('Use the staff editor to convert a note into a rest.');
    model.updateEvent(score, partId, eventId, { writtenPitch: pitch });
    return pitch;
  }

  function parsePassage(text, score, options = {}) {
    return parser.parsePassage(text, {
      score,
      timeSignature: options.timeSignature || score?.settings?.timeSignature || '4/4',
      pickupBeats: options.pickupBeats ?? score?.settings?.pickupBeats ?? 0,
      convention: options.convention || score?.settings?.solfaConvention || 'airmonlink-traditional-v1',
      voice: options.voice || 1, staff: options.staff ?? null,
      allowIncompleteMeasures: options.allowIncompleteMeasures === true,
      lineBreakCreatesMeasure: options.lineBreakCreatesMeasure === true
    });
  }

  function previewSolfaToStaff(score, text, options = {}) {
    const parsed = parsePassage(text, score, options);
    const part = score?.parts?.find(item => item.id === options.partId) || score?.parts?.[0] || null;
    const preview = parsed.events.map(item => {
      if (item.rest) return { ...item, pitch: null, midi: null };
      const key = score ? effectiveKey(score, part, item.measureIndex) : options.key;
      if (!key) return { ...item, pitch: null, midi: null, uncertain: true };
      const pitch = pitchForSyllable(`${item.source.raw.replace(/[.,]+$/, '')}`, key, {
        mode: options.mode || score?.settings?.mode,
        pitchSystem: options.pitchSystem || score?.settings?.solfaPitchSystem || 'movable-do',
        minorSystem: options.minorSystem || score?.settings?.minorSolfaSystem || 'do-based',
        referenceMidi: options.referenceMidi
      });
      return { ...item, pitch, midi: theory.pitchToMidi(pitch), key };
    });
    const diagnostics = [...parsed.diagnostics];
    if (!score && !options.key) diagnostics.push({ code: 'MISSING_TONIC', severity: 'error', message: 'A tonic/key is required before conversion.', measure: 1, beat: 1, voice: options.voice || 1, symbol: '', interpretation: '', suggestion: 'Choose a tonic/key and mode.' });
    return { ...parsed, events: preview, diagnostics, valid: !diagnostics.some(item => item.severity === 'error') };
  }

  function applySolfaPassage(score, partId, text, options = {}) {
    const part = score.parts.find(item => item.id === partId);
    if (!part) throw new Error('Choose a destination part before applying tonic sol-fa.');
    const result = previewSolfaToStaff(score, text, { ...options, partId });
    if (!result.valid) throw new Error('Correct the tonic sol-fa errors before replacing staff notation.');
    const voice = Math.max(1, Math.min(4, Number(options.voice) || 1));
    const staff = options.staff ?? null;
    const starts = result.events.map(item => item.start);
    const ends = result.events.map(item => item.start + item.duration);
    const rangeStart = starts.length ? Math.min(...starts) : 0;
    const rangeEnd = ends.length ? Math.max(...ends) : rangeStart;
    if (options.replace !== false) {
      part.events = part.events.filter(event => event.generatedBy === 'gap-fill' || (event.voice || 1) !== voice || (staff != null && (event.staff || null) !== staff) || event.start >= rangeEnd - 1e-8 || event.start + event.duration <= rangeStart + 1e-8);
    }
    const created = [];
    result.events.forEach(item => {
      if (item.rest) created.push(model.addRest(score, partId, { start: item.start, duration: item.duration, voice, staff, generatedBy: null }));
      else created.push(model.addNote(score, partId, { pitch: item.pitch, midi: item.midi, start: item.start, duration: item.duration, voice, staff, generatedBy: null }));
    });
    if (score.settings.autoFillRests !== false) model.regenerateAutoRests(score);
    score.solfaLastImport = { convention: result.convention, appliedAt: new Date().toISOString(), partId, voice, staff, source: text, diagnostics: result.diagnostics };
    model.touch(score);
    return { ...result, created };
  }

  function verifyScoreSolfa(score) {
    const issues = [];
    score.parts.forEach(part => part.events.filter(event => event.type === 'note').forEach(event => {
      const converted = eventToSolfa(event, score, part, { notationMode: 'traditional' });
      if (!converted.valid) issues.push({ partId: part.id, eventId: event.id, severity: 'error', message: `${part.name}: displayed staff pitch, playback pitch and tonic sol-fa disagree.` });
      if (/[#♯b♭]/.test(converted.syllable)) issues.push({ partId: part.id, eventId: event.id, severity: 'error', message: `${part.name}: tonic sol-fa contains an accidental sign instead of a chromatic syllable.` });
    }));
    return issues;
  }

  function scoreToSolfaText(score, options = {}) {
    const mode = options.notationMode || 'traditional';
    const openingKey = model.effectiveKey(score, 0);
    const metadata = score.metadata || {};
    const active = activeConvention(score, options);
    const header = [
      metadata.title || 'Untitled Score',
      metadata.subtitle ? `Subtitle: ${metadata.subtitle}` : null,
      metadata.composer ? `Composer: ${metadata.composer}` : 'Composer: —',
      metadata.arranger ? `Arranger: ${metadata.arranger}` : null,
      metadata.lyricist ? `Lyricist: ${metadata.lyricist}` : null,
      `Key is ${openingKey} ${/m$/.test(openingKey) ? 'minor' : 'major'} | Time is ${model.effectiveTimeSignature(score, 0)} | Tempo: ♩ = ${score.settings.tempo}`,
      `${active.name} (${active.id}).`,
      metadata.copyright || null
    ].filter(Boolean);
    const renderOptions = {
      notationMode: mode, labelStyle: score.settings.solfaLabels || 'short', showRhythm: score.settings.solfaShowRhythm !== false,
      showOctaveMarks: score.settings.solfaShowOctaveMarks !== false,
      pitchSystem: score.settings.solfaPitchSystem || 'movable-do', minorSystem: score.settings.minorSolfaSystem || 'do-based', ...options
    };
    const body = score.parts.flatMap(part => partLayersToSolfa(part, score, renderOptions).map(layer => {
      const notes = layer.bars.map(bar => bar.map(item => item.text).join(' ')).join(' | ');
      const verses = new Set(layer.bars.flatMap(bar => bar.flatMap(item => item.lyrics || []).map(item => item.verse)));
      const lyricLines = Array.from(verses).sort((a, b) => a - b).map(verse => `Verse ${verse}: ${layer.bars.map(bar => bar.map(item => lyricPublicationText((item.lyrics || []).find(lyric => lyric.verse === verse), item.rest ? '·' : '—')).join(' ')).join(' | ')}`);
      const label = score.settings.solfaShowVoiceLabels === true ? `\n${publicationVoiceLabel(part, layer.voice, options.voiceLabelStyle || 'short')}` : '';
      return [label, notes || '(calculated rests only)', ...(score.settings.solfaShowLyrics === false ? [] : lyricLines)].filter(Boolean);
    })).flat();
    return [...header, ...body].join('\n');
  }

  return {
    DEGREE_NAMES, CURWEN_NAMES, RAISED, LOWERED,
    rhythmMark, rhythmContext, rhythmPrefix, traditionalToken, effectiveKey, eventPitch, eventLyrics,
    degreeInfoForPitch, notationSyllable, octaveMarksForEvent, eventToSolfa, partToSolfa, voiceLabel, publicationVoiceLabel,
    lyricPublicationText, partLayersToSolfa, parseSyllable, pitchForSyllable, updateEventFromSolfa,
    parsePassage, previewSolfaToStaff, applySolfaPassage, verifyScoreSolfa, scoreToSolfaText,
    activeConvention, symbolTable: parser.symbolTable, CONVENTIONS: parser.CONVENTIONS
  };
});
