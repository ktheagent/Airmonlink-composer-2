(function (root, factory) {
  const theory = root.AirmonMusicTheory || (typeof require === 'function' ? require('./music-theory') : null);
  const model = root.AirmonScoreModel || (typeof require === 'function' ? require('./score-model') : null);
  const api = factory(theory, model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonSolfaParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (theory, model) {
  'use strict';

  const EPSILON = 1e-8;
  const CURWEN_NAMES = ['d', 'r', 'm', 'f', 's', 'l', 't'];
  const LONG_NAMES = ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'];
  const RAISED = ['di', 'ri', 'ma', 'fi', 'si', 'li', 'ta'];
  const LOWERED = ['de', 'ra', 'me', 'fe', 'se', 'le', 'te'];

  /**
   * Versioned, configurable grammar used by both the dedicated Tonic Sol-fa
   * page and the optional staff lane. Musical meaning never comes from text
   * width or screen position.
   */
  const CONVENTIONS = Object.freeze({
    'airmonlink-traditional-v1': Object.freeze({
      id: 'airmonlink-traditional-v1',
      name: 'Airmonlink Traditional Tonic Sol-fa',
      version: 1,
      measureBoundary: '|',
      pulseBoundary: ':',
      halfPulse: '.',
      quarterPulse: ',',
      arbitrarySubdivision: '·',
      sustain: ['-', '—'],
      melisma: '_',
      upperOctave: ["'", '⁺'],
      lowerOctave: [',', '₋'],
      rests: ['0', 'z'],
      lineBreakCreatesMeasure: false,
      leadingAttachedComma: 'lower-octave',
      suffixDot: 'half-pulse-duration',
      suffixComma: 'fractional-duration',
      standaloneDash: 'continue-previous-sound',
      standaloneUnderscore: 'non-sounding-melisma',
      description: 'Bars divide measures; colons mark pulse positions; dots and standalone commas mark subdivisions; suffix dots/commas shorten duration; dashes sustain; attached leading commas lower octaves; apostrophes raise octaves.'
    }),
    'airmonlink-legacy-v0': Object.freeze({
      id: 'airmonlink-legacy-v0',
      name: 'Airmonlink Legacy Interpretation',
      version: 0,
      measureBoundary: '|', pulseBoundary: ':', halfPulse: '.', quarterPulse: ',', arbitrarySubdivision: '·',
      sustain: ['-', '—'], melisma: '_', upperOctave: ["'", '⁺'], lowerOctave: [',', '₋'], rests: ['0', 'z'],
      lineBreakCreatesMeasure: false, leadingAttachedComma: 'contextual', suffixDot: 'legacy-short-duration', suffixComma: 'legacy-short-duration',
      standaloneDash: 'continue-previous-sound', standaloneUnderscore: 'non-sounding-melisma',
      description: 'Compatibility convention matching projects created before the formal grammar was introduced.'
    })
  });

  function convention(id = 'airmonlink-traditional-v1') {
    return CONVENTIONS[id] || CONVENTIONS['airmonlink-traditional-v1'];
  }

  function locationFor(text, index) {
    const before = String(text || '').slice(0, Math.max(0, index));
    const lines = before.split(/\r?\n/);
    return { line: lines.length, column: lines.at(-1).length + 1, index };
  }

  function diagnostic(code, message, token, context = {}, severity = 'error', suggestion = '') {
    return {
      code, severity, message,
      measure: Math.max(1, Number(context.measureIndex ?? 0) + 1),
      beat: Number(context.beat ?? 1),
      voice: Math.max(1, Number(context.voice) || 1),
      symbol: token?.raw ?? '',
      interpretation: context.interpretation || '',
      suggestion,
      source: token ? { start: token.start, end: token.end, line: token.line, column: token.column } : null
    };
  }

  function tokenize(source, options = {}) {
    const text = String(source || '');
    const active = convention(options.convention);
    const tokens = [];
    let index = 0;
    const push = (type, raw, start, extra = {}) => {
      const loc = locationFor(text, start);
      tokens.push({ type, raw, value: raw, start, end: start + raw.length, line: loc.line, column: loc.column, ...extra });
    };
    while (index < text.length) {
      const char = text[index];
      if (char === '\r') { index += 1; continue; }
      if (char === '\n') { push('line-break', char, index); index += 1; continue; }
      if (/\s/.test(char) || char === '\u00a0') { index += 1; continue; }
      if (char === active.measureBoundary) { push('measure-boundary', char, index); index += 1; continue; }
      if (char === '(') { push('slur-start', char, index); index += 1; continue; }
      if (char === ')') { push('slur-stop', char, index); index += 1; continue; }
      if (active.sustain.includes(char)) { push('sustain', char, index); index += 1; continue; }
      if (char === active.melisma) { push('melisma', char, index); index += 1; continue; }
      if (char === active.pulseBoundary) { push('pulse-boundary', char, index); index += 1; continue; }
      if (char === active.halfPulse) { push('half-pulse', char, index); index += 1; continue; }
      if (char === active.arbitrarySubdivision) { push('arbitrary-subdivision', char, index); index += 1; continue; }

      // A comma attached directly before a syllable is an octave mark in this
      // convention. A standalone comma remains a rhythmic subdivision.
      if (char === active.quarterPulse) {
        const attached = /^[,]+(?=[A-Za-z0-9])/.exec(text.slice(index));
        if (!attached) { push('quarter-pulse', char, index); index += 1; continue; }
      }

      const word = /^(?<lower>[,₋]*)(?<name>[A-Za-z]+|0)(?<upper>['⁺]*)(?<suffix>\.{1}|,{1,4})?/.exec(text.slice(index));
      if (word?.[0]) {
        const raw = word[0];
        push('event', raw, index, {
          lowerMarks: word.groups.lower || '', name: word.groups.name || '', upperMarks: word.groups.upper || '', durationSuffix: word.groups.suffix || ''
        });
        index += raw.length;
        continue;
      }
      push('unknown', char, index); index += 1;
    }
    return tokens;
  }

  function parsePitchToken(value) {
    const raw = typeof value === 'object' ? value.raw : String(value || '');
    const text = raw.trim().toLowerCase();
    const match = /^(?<lower>[,₋]*)(?<name>[a-z]+|0)(?<upper>['⁺]*)(?<suffix>\.{1}|,{1,4})?$/.exec(text);
    if (!match) throw new Error(`Unrecognised tonic sol-fa syllable: ${raw}`);
    const nameAliases = { so: 'sol', si: 'ti' };
    const name = nameAliases[match.groups.name] || match.groups.name;
    const octaveShift = (match.groups.upper || '').length - (match.groups.lower || '').length;
    if (name === '0' || name === 'z') return { rest: true, degree: 0, accidental: 0, octaveShift, name, durationSuffix: match.groups.suffix || '' };
    let index = CURWEN_NAMES.indexOf(name);
    if (index < 0) index = LONG_NAMES.indexOf(name);
    if (index >= 0) return { rest: false, degree: index + 1, accidental: 0, octaveShift, name, durationSuffix: match.groups.suffix || '' };
    index = RAISED.indexOf(name);
    if (index >= 0) return { rest: false, degree: index + 1, accidental: 1, octaveShift, name, durationSuffix: match.groups.suffix || '' };
    index = LOWERED.indexOf(name);
    if (index >= 0) return { rest: false, degree: index + 1, accidental: -1, octaveShift, name, durationSuffix: match.groups.suffix || '' };
    throw new Error(`Unsupported chromatic tonic sol-fa syllable: ${raw}`);
  }

  function durationFromSuffix(suffix, pulse) {
    if (!suffix) return pulse;
    if (suffix === '.') return pulse / 2;
    if (/^,+$/.test(suffix)) return pulse / Math.pow(2, suffix.length + 1);
    return pulse;
  }

  function nextGridPosition(position, step) {
    const ratio = position / step;
    const rounded = Math.round(ratio);
    if (Math.abs(ratio - rounded) < EPSILON) return (rounded + 1) * step;
    return Math.ceil(ratio - EPSILON) * step;
  }

  function measureDefinition(options, index) {
    if (options.score && model) {
      const bounded = Math.max(0, Math.min(index, options.score.measures.length - 1));
      const bounds = model.measureBounds(options.score, bounded);
      const info = model.timeSignatureInfo(bounds.timeSignature);
      return { index, start: bounds.start, capacity: bounds.capacity, timeSignature: bounds.timeSignature, info };
    }
    const signatures = Array.isArray(options.timeSignatures) ? options.timeSignatures : [options.timeSignature || '4/4'];
    const signature = signatures[Math.min(index, signatures.length - 1)] || '4/4';
    const info = model ? model.timeSignatureInfo(signature) : fallbackTimeSignatureInfo(signature);
    const pickup = index === 0 ? Math.max(0, Number(options.pickupBeats) || 0) : 0;
    const capacity = pickup || info.measureQuarterBeats;
    let start = 0;
    for (let cursor = 0; cursor < index; cursor += 1) {
      const priorSignature = signatures[Math.min(cursor, signatures.length - 1)] || signature;
      const priorInfo = model ? model.timeSignatureInfo(priorSignature) : fallbackTimeSignatureInfo(priorSignature);
      start += cursor === 0 && Number(options.pickupBeats) > 0 ? Number(options.pickupBeats) : priorInfo.measureQuarterBeats;
    }
    return { index, start, capacity, timeSignature: signature, info };
  }

  function fallbackTimeSignatureInfo(value) {
    const match = /^(\d+)\/(\d+)$/.exec(String(value));
    if (!match) throw new Error(`Unsupported time signature: ${value}`);
    const numerator = Number(match[1]); const denominator = Number(match[2]);
    const beatUnitQuarter = 4 / denominator;
    const compound = denominator >= 8 && numerator > 3 && numerator % 3 === 0;
    return { numerator, denominator, beatUnitQuarter, measureQuarterBeats: numerator * beatUnitQuarter, compound, pulseQuarterBeats: compound ? beatUnitQuarter * 3 : beatUnitQuarter };
  }

  function parsePassage(source, options = {}) {
    const active = convention(options.convention);
    const tokens = tokenize(source, { convention: active.id });
    const voice = Math.max(1, Math.min(4, Number(options.voice) || 1));
    const events = [];
    const diagnostics = [];
    const measures = [];
    let measureIndex = 0;
    let measure = measureDefinition(options, measureIndex);
    let localCursor = 0;
    let pendingPosition = null;
    let slurDepth = 0;
    let lastSounding = null;
    let explicitBoundary = false;

    const refreshMeasure = () => { measure = measureDefinition(options, measureIndex); };
    const absoluteCursor = () => measure.start + localCursor;
    const currentBeat = () => 1 + localCursor / Math.max(EPSILON, measure.info.beatUnitQuarter);
    const ensureMeasureRecord = () => {
      if (!measures[measureIndex]) measures[measureIndex] = { index: measureIndex, number: measureIndex + 1, timeSignature: measure.timeSignature, capacity: measure.capacity, used: 0, complete: false, overfilled: false, underfilled: false, voice };
      return measures[measureIndex];
    };
    const closeMeasure = token => {
      const record = ensureMeasureRecord();
      record.used = Math.max(record.used, localCursor);
      record.complete = Math.abs(record.used - record.capacity) < EPSILON;
      record.overfilled = record.used > record.capacity + EPSILON;
      record.underfilled = record.used < record.capacity - EPSILON;
      if (record.overfilled) diagnostics.push(diagnostic('MEASURE_OVERFILLED', `Measure ${record.number} exceeds ${record.capacity} quarter beats by ${(record.used - record.capacity).toFixed(3)}.`, token, { measureIndex, beat: currentBeat(), voice, interpretation: 'measure boundary' }, 'error', 'Shorten events, move material to the next measure, or change the time signature.'));
      else if (record.underfilled && options.allowIncompleteMeasures !== true) diagnostics.push(diagnostic('MEASURE_UNDERFILLED', `Measure ${record.number} contains ${record.used} of ${record.capacity} quarter beats.`, token, { measureIndex, beat: currentBeat(), voice, interpretation: 'measure boundary' }, 'warning', 'Add a timed rest or continuation, or mark the measure as a pickup.'));
      measureIndex += 1; refreshMeasure(); localCursor = 0; pendingPosition = null; explicitBoundary = true;
    };

    for (const token of tokens) {
      if (token.type === 'line-break') {
        if (active.lineBreakCreatesMeasure || options.lineBreakCreatesMeasure === true) closeMeasure(token);
        continue;
      }
      if (token.type === 'measure-boundary') { closeMeasure(token); continue; }
      if (token.type === 'slur-start') { slurDepth += 1; continue; }
      if (token.type === 'slur-stop') {
        if (slurDepth <= 0) diagnostics.push(diagnostic('UNMATCHED_SLUR_STOP', 'A closing slur mark has no matching opening mark.', token, { measureIndex, beat: currentBeat(), voice }, 'warning', 'Remove the mark or add an opening parenthesis.'));
        else slurDepth -= 1;
        if (lastSounding) lastSounding.slurStop = true;
        continue;
      }
      if (token.type === 'pulse-boundary' || token.type === 'half-pulse' || token.type === 'quarter-pulse' || token.type === 'arbitrary-subdivision') {
        const pulse = measure.info.compound ? measure.info.pulseQuarterBeats : measure.info.beatUnitQuarter;
        const step = token.type === 'pulse-boundary' ? pulse : token.type === 'half-pulse' ? pulse / 2 : token.type === 'quarter-pulse' ? pulse / 4 : pulse / 8;
        pendingPosition = nextGridPosition(localCursor, step);
        if (pendingPosition > measure.capacity + EPSILON) diagnostics.push(diagnostic('INVALID_BEAT_SUBDIVISION', 'The subdivision points beyond the current measure.', token, { measureIndex, beat: currentBeat(), voice, interpretation: `${step} quarter-beat grid` }, 'error', 'Insert a measure boundary before this subdivision.'));
        continue;
      }
      if (token.type === 'sustain') {
        if (!lastSounding || lastSounding.measureIndex !== measureIndex) {
          diagnostics.push(diagnostic('CONTINUATION_WITHOUT_NOTE', 'A sustain mark has no preceding sounding note in this measure.', token, { measureIndex, beat: currentBeat(), voice, interpretation: 'sustain continuation' }, 'error', 'Place the dash after a note, or enter a timed rest instead.'));
          continue;
        }
        const pulse = measure.info.compound ? measure.info.pulseQuarterBeats : measure.info.beatUnitQuarter;
        lastSounding.duration += pulse;
        lastSounding.continuations.push({ symbol: token.raw, duration: pulse, source: { start: token.start, end: token.end, line: token.line, column: token.column } });
        localCursor += pulse;
        ensureMeasureRecord().used = Math.max(ensureMeasureRecord().used, localCursor);
        continue;
      }
      if (token.type === 'melisma') {
        if (!lastSounding) diagnostics.push(diagnostic('MELISMA_WITHOUT_NOTE', 'An underscore has no preceding note to extend.', token, { measureIndex, beat: currentBeat(), voice, interpretation: 'non-sounding melisma' }, 'warning', 'Attach the underscore to a lyric syllable or place it after a note.'));
        else lastSounding.melisma = true;
        continue;
      }
      if (token.type === 'unknown') {
        diagnostics.push(diagnostic('UNKNOWN_SYMBOL', `Unknown tonic sol-fa symbol “${token.raw}”.`, token, { measureIndex, beat: currentBeat(), voice }, 'error', 'Replace it with a supported syllable, duration mark, rest, boundary or octave mark.'));
        continue;
      }
      if (token.type !== 'event') continue;

      if (pendingPosition != null) {
        if (pendingPosition < localCursor - EPSILON) diagnostics.push(diagnostic('BACKWARD_SUBDIVISION', 'The rhythm prefix points behind the current musical cursor.', token, { measureIndex, beat: currentBeat(), voice }, 'warning', 'Remove the prefix or insert a measure boundary.'));
        else localCursor = pendingPosition;
        pendingPosition = null;
      }
      if (localCursor >= measure.capacity - EPSILON && events.length && !explicitBoundary) {
        closeMeasure(token);
      }
      explicitBoundary = false;
      let parsed;
      try { parsed = parsePitchToken(token); }
      catch (error) {
        diagnostics.push(diagnostic('UNSUPPORTED_SYLLABLE', error.message, token, { measureIndex, beat: currentBeat(), voice }, 'error', 'Use d r m f s l t, a supported chromatic syllable, or 0 for a rest.'));
        continue;
      }
      const pulse = measure.info.compound ? measure.info.pulseQuarterBeats : measure.info.beatUnitQuarter;
      const duration = durationFromSuffix(parsed.durationSuffix, pulse);
      const event = {
        id: null, type: parsed.rest ? 'rest' : 'note', syllable: parsed.rest ? '' : parsed.name,
        degree: parsed.degree, accidental: parsed.accidental, octaveShift: parsed.octaveShift,
        start: absoluteCursor(), localStart: localCursor, duration, measureIndex, measure: measureIndex + 1,
        beat: currentBeat(), voice, staff: options.staff ?? null, rest: parsed.rest,
        tieStart: false, tieStop: false, slurStart: slurDepth > 0, slurStop: false, melisma: false,
        continuations: [], tuplet: options.tuplet || null,
        source: { raw: token.raw, start: token.start, end: token.end, line: token.line, column: token.column }
      };
      events.push(event);
      if (!parsed.rest) lastSounding = event;
      localCursor += duration;
      const record = ensureMeasureRecord(); record.used = Math.max(record.used, localCursor);
      if (localCursor > measure.capacity + EPSILON) diagnostics.push(diagnostic('EVENT_CROSSES_MEASURE', `The ${parsed.rest ? 'rest' : 'note'} crosses the end of measure ${measureIndex + 1}.`, token, { measureIndex, beat: event.beat, voice, interpretation: `${duration} quarter beats` }, 'error', 'Split the event and tie it across a barline, or shorten its duration.'));
    }

    if (slurDepth > 0) diagnostics.push(diagnostic('UNCLOSED_SLUR', 'A slur was opened but not closed.', tokens.at(-1), { measureIndex, beat: currentBeat(), voice }, 'warning', 'Add a closing parenthesis.'));
    if (!(explicitBoundary && localCursor < EPSILON)) {
      const finalRecord = ensureMeasureRecord();
      finalRecord.used = Math.max(finalRecord.used, localCursor);
      finalRecord.complete = Math.abs(finalRecord.used - finalRecord.capacity) < EPSILON;
      finalRecord.overfilled = finalRecord.used > finalRecord.capacity + EPSILON;
      finalRecord.underfilled = finalRecord.used < finalRecord.capacity - EPSILON;
      if (options.validateFinalMeasure !== false) {
        if (finalRecord.overfilled && !diagnostics.some(item => item.code === 'EVENT_CROSSES_MEASURE' && item.measure === finalRecord.number)) diagnostics.push(diagnostic('MEASURE_OVERFILLED', `Measure ${finalRecord.number} exceeds its expected duration.`, tokens.at(-1), { measureIndex, beat: currentBeat(), voice }, 'error', 'Correct the final measure duration.'));
        else if (finalRecord.underfilled && options.allowIncompleteMeasures !== true) diagnostics.push(diagnostic('MEASURE_UNDERFILLED', `Measure ${finalRecord.number} contains ${finalRecord.used} of ${finalRecord.capacity} quarter beats.`, tokens.at(-1), { measureIndex, beat: currentBeat(), voice }, 'warning', 'Add a timed rest or mark this as a pickup measure.'));
      }
    }

    return {
      convention: active.id,
      conventionVersion: active.version,
      source: String(source || ''), tokens, events, measures: measures.filter(Boolean), diagnostics,
      valid: !diagnostics.some(item => item.severity === 'error')
    };
  }

  function symbolTable(id = 'airmonlink-traditional-v1') {
    const item = convention(id);
    return [
      { symbol: 'd r m f s l t', meaning: 'Diatonic scale syllables', context: 'event token' },
      { symbol: 'di/ra/me/fi/se/le/te', meaning: 'Chromatic syllables', context: 'event token' },
      { symbol: "'", meaning: 'Raise the attached note by one octave', context: 'suffix attached to syllable' },
      { symbol: ',', meaning: 'Lower octave when attached before a syllable; quarter-pulse subdivision when standalone; short duration when suffixed', context: 'position-dependent' },
      { symbol: '.', meaning: 'Half-pulse subdivision when preceding an event; half-pulse duration when suffixed', context: 'position-dependent' },
      { symbol: ':', meaning: 'Advance to the next pulse grid', context: 'rhythm prefix' },
      { symbol: '- / —', meaning: 'Extend the preceding sounding note by one pulse without retriggering', context: 'standalone continuation' },
      { symbol: '_', meaning: 'Melisma/continuation marker with no sounding pitch', context: 'after note or lyric' },
      { symbol: '|', meaning: 'Close current measure and begin the next', context: 'measure boundary' },
      { symbol: '0 / z', meaning: 'Timed rest', context: 'event token' },
      { symbol: '( )', meaning: 'Slur/phrase start and stop', context: 'around events' },
      { symbol: 'line break', meaning: item.lineBreakCreatesMeasure ? 'Measure boundary' : 'Visual line break only', context: 'editor layout' }
    ];
  }

  return {
    CONVENTIONS, convention, symbolTable, tokenize, parsePitchToken, durationFromSuffix, parsePassage, diagnostic
  };
});
