(function (root, factory) {
  const theory = root.AirmonMusicTheory || (typeof require === 'function' ? require('./music-theory') : null);
  const api = factory(theory);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonScoreModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (theory) {
  'use strict';

  let idCounter = 1;
  // Performance caches are derived-only and never serialized. They are keyed by the
  // score object plus its revision, so musical data remains the sole source of truth.
  const timelineCache = new WeakMap();
  const eventLookupCache = new WeakMap();
  function invalidateDerivedCaches(score) {
    if (!score || typeof score !== 'object') return;
    timelineCache.delete(score);
    eventLookupCache.delete(score);
  }
  function uid(prefix = 'item') {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
  }

  const DURATIONS = Object.freeze([
    { value: 8, name: 'Breve', symbol: '𝅜', key: '0' },
    { value: 6, name: 'Dotted whole', symbol: '𝅝.', key: null },
    { value: 4, name: 'Whole', symbol: '𝅝', key: '1' },
    { value: 3, name: 'Dotted half', symbol: '𝅗𝅥.', key: null },
    { value: 2, name: 'Half', symbol: '𝅗𝅥', key: '2' },
    { value: 1.5, name: 'Dotted quarter', symbol: '𝅘𝅥.', key: null },
    { value: 1, name: 'Quarter', symbol: '𝅘𝅥', key: '3' },
    { value: .75, name: 'Dotted eighth', symbol: '𝅘𝅥𝅮.', key: null },
    { value: .5, name: 'Eighth', symbol: '𝅘𝅥𝅮', key: '4' },
    { value: .375, name: 'Dotted sixteenth', symbol: '𝅘𝅥𝅯.', key: null },
    { value: .25, name: 'Sixteenth', symbol: '𝅘𝅥𝅯', key: '5' },
    { value: .125, name: 'Thirty-second', symbol: '𝅘𝅥𝅰', key: '6' },
    { value: .0625, name: 'Sixty-fourth', symbol: '𝅘𝅥𝅱', key: '7' }
  ]);

  const INSTRUMENTS = {
    soprano: { name: 'Soprano', shortName: 'S.', clef: 'treble', min: 60, max: 81, program: 52, role: 'soprano' },
    alto: { name: 'Alto', shortName: 'A.', clef: 'treble', min: 55, max: 74, program: 52, role: 'alto' },
    tenor: { name: 'Tenor', shortName: 'T.', clef: 'treble-8', min: 48, max: 69, program: 52, role: 'tenor' },
    bass: { name: 'Bass', shortName: 'B.', clef: 'bass', min: 40, max: 64, program: 52, role: 'bass' },
    piano: { name: 'Piano', shortName: 'Pno.', clef: 'grand', min: 21, max: 108, program: 0 },
    organ: { name: 'Organ', shortName: 'Org.', clef: 'grand', min: 24, max: 108, program: 19 },
    violin: { name: 'Violin', shortName: 'Vln.', clef: 'treble', min: 55, max: 103, program: 40 },
    viola: { name: 'Viola', shortName: 'Vla.', clef: 'alto', min: 48, max: 88, program: 41 },
    cello: { name: 'Cello', shortName: 'Vc.', clef: 'bass', min: 36, max: 76, program: 42 },
    contrabass: { name: 'Double Bass', shortName: 'Cb.', clef: 'bass', min: 28, max: 67, program: 43 },
    flute: { name: 'Flute', shortName: 'Fl.', clef: 'treble', min: 60, max: 96, program: 73 },
    oboe: { name: 'Oboe', shortName: 'Ob.', clef: 'treble', min: 58, max: 91, program: 68 },
    clarinet: { name: 'Clarinet in B♭', shortName: 'Cl.', clef: 'treble', min: 50, max: 94, program: 71, transpose: 2 },
    saxophone: { name: 'Alto Saxophone in E♭', shortName: 'A.Sax.', clef: 'treble', min: 49, max: 92, program: 65, transpose: 9 },
    bassoon: { name: 'Bassoon', shortName: 'Bsn.', clef: 'bass', min: 34, max: 75, program: 70 },
    trumpet: { name: 'Trumpet in B♭', shortName: 'Tpt.', clef: 'treble', min: 54, max: 82, program: 56, transpose: 2 },
    horn: { name: 'Horn in F', shortName: 'Hn.', clef: 'treble', min: 35, max: 77, program: 60, transpose: 7 },
    trombone: { name: 'Trombone', shortName: 'Tbn.', clef: 'bass', min: 40, max: 72, program: 57 },
    tuba: { name: 'Tuba', shortName: 'Tba.', clef: 'bass', min: 28, max: 58, program: 58 },
    guitar: { name: 'Guitar', shortName: 'Gtr.', clef: 'treble-8', min: 40, max: 88, program: 24 },
    percussion: { name: 'Percussion', shortName: 'Perc.', clef: 'percussion', min: 35, max: 81, program: 0 }
  };

  function createPart(key, overrides = {}) {
    const base = INSTRUMENTS[key] || { name: String(key || 'Instrument'), shortName: String(key || 'Ins.').slice(0, 4), clef: 'treble', min: 48, max: 84, program: 0 };
    return {
      id: uid('part'), instrumentKey: key, name: base.name, shortName: base.shortName, clef: base.clef,
      minPitch: base.min, maxPitch: base.max, midiProgram: base.program || 0, transpose: base.transpose || 0,
      harmonyRole: base.role || null, volume: 0.8, pan: 0, muted: false, solo: false, color: null,
      bracketGroup: null, braceGroup: base.clef === 'grand' ? uid('brace') : null,
      voiceLayers: [1, 2, 3, 4], activeVoice: 1, events: [], ...overrides
    };
  }

  function createMeasure(index, options = {}) {
    return {
      id: uid('measure'), number: index + 1,
      timeSignature: options.timeSignature || null,
      key: options.key || null,
      repeatStart: Boolean(options.repeatStart),
      repeatEnd: Boolean(options.repeatEnd),
      repeatTimes: Math.max(2, Number(options.repeatTimes) || 2),
      endings: Array.isArray(options.endings) ? options.endings.map(Number).filter(Number.isFinite) : [],
      rehearsalMark: options.rehearsalMark || '',
      barline: options.barline || 'regular',
      newSystem: Boolean(options.newSystem),
      newPage: Boolean(options.newPage)
    };
  }

  function templateParts(template, options = {}) {
    if (Array.isArray(options.instrumentKeys) && options.instrumentKeys.length) {
      return options.instrumentKeys.map((key, index) => createPart(key, { bracketGroup: options.bracketGroup || (options.instrumentKeys.length > 1 ? 'ensemble' : null), name: options.instrumentNames?.[index] || undefined }));
    }
    if (template === 'piano') return [createPart('piano', { bracketGroup: 'keyboard' })];
    if (template === 'organ') return [createPart('organ', { bracketGroup: 'keyboard' })];
    if (template === 'lead' || template === 'solo') return [createPart('soprano', { name: 'Melody', shortName: 'Mel.', harmonyRole: null })];
    if (template === 'voice-piano') return [
      createPart('soprano', { name: 'Voice', shortName: 'V.', bracketGroup: null, harmonyRole: null }),
      createPart('piano', { bracketGroup: 'keyboard' })
    ];
    if (template === 'ssa') return [
      createPart('soprano', { name: 'Soprano I', shortName: 'S.1', bracketGroup: 'choir' }),
      createPart('soprano', { name: 'Soprano II', shortName: 'S.2', bracketGroup: 'choir' }),
      createPart('alto', { bracketGroup: 'choir' })
    ];
    if (template === 'ttbb') return [
      createPart('tenor', { name: 'Tenor I', shortName: 'T.1', bracketGroup: 'choir' }),
      createPart('tenor', { name: 'Tenor II', shortName: 'T.2', bracketGroup: 'choir' }),
      createPart('bass', { name: 'Bass I', shortName: 'B.1', bracketGroup: 'choir' }),
      createPart('bass', { name: 'Bass II', shortName: 'B.2', bracketGroup: 'choir' })
    ];
    if (template === 'worship-band') return [
      createPart('soprano', { name: 'Lead Vocal', shortName: 'Vox', bracketGroup: 'voices', harmonyRole: null }),
      createPart('piano', { name: 'Keyboard', shortName: 'Keys', bracketGroup: 'rhythm' }),
      createPart('guitar', { name: 'Acoustic Guitar', shortName: 'A.Gtr.', bracketGroup: 'rhythm' }),
      createPart('guitar', { name: 'Electric Guitar', shortName: 'E.Gtr.', bracketGroup: 'rhythm' }),
      createPart('contrabass', { name: 'Bass Guitar', shortName: 'Bass', clef: 'bass', bracketGroup: 'rhythm', midiProgram: 33 }),
      createPart('percussion', { name: 'Drum Set', shortName: 'Dr.', bracketGroup: 'rhythm' })
    ];
    if (template === 'african-percussion') return [
      createPart('percussion', { name: 'Master Drum', shortName: 'M.Dr.', bracketGroup: 'percussion' }),
      createPart('percussion', { name: 'Supporting Drum', shortName: 'S.Dr.', bracketGroup: 'percussion' }),
      createPart('percussion', { name: 'Bell', shortName: 'Bell', bracketGroup: 'percussion' }),
      createPart('percussion', { name: 'Shaker', shortName: 'Sh.', bracketGroup: 'percussion' })
    ];
    if (template === 'brass-band') return [
      createPart('trumpet', { name: 'Cornet I', shortName: 'C.1', bracketGroup: 'brass' }),
      createPart('trumpet', { name: 'Cornet II', shortName: 'C.2', bracketGroup: 'brass' }),
      createPart('horn', { bracketGroup: 'brass' }), createPart('trombone', { bracketGroup: 'brass' }),
      createPart('tuba', { bracketGroup: 'brass' }), createPart('percussion', { bracketGroup: 'percussion' })
    ];
    if (template === 'concert-band') return [
      createPart('flute', { bracketGroup: 'woodwinds' }), createPart('oboe', { bracketGroup: 'woodwinds' }),
      createPart('clarinet', { bracketGroup: 'woodwinds' }), createPart('bassoon', { bracketGroup: 'woodwinds' }),
      createPart('trumpet', { bracketGroup: 'brass' }), createPart('horn', { bracketGroup: 'brass' }),
      createPart('trombone', { bracketGroup: 'brass' }), createPart('tuba', { bracketGroup: 'brass' }),
      createPart('percussion', { bracketGroup: 'percussion' })
    ];
    if (template === 'jazz-band') return [
      createPart('saxophone', { name: 'Alto Sax I', shortName: 'A.Sx.1', bracketGroup: 'saxes' }),
      createPart('saxophone', { name: 'Tenor Sax', shortName: 'T.Sx.', bracketGroup: 'saxes' }),
      createPart('trumpet', { name: 'Trumpet I', shortName: 'Tpt.1', bracketGroup: 'brass' }),
      createPart('trombone', { name: 'Trombone I', shortName: 'Tbn.1', bracketGroup: 'brass' }),
      createPart('piano', { bracketGroup: 'rhythm' }), createPart('guitar', { bracketGroup: 'rhythm' }),
      createPart('contrabass', { name: 'Bass', shortName: 'Bass', bracketGroup: 'rhythm' }),
      createPart('percussion', { name: 'Drum Set', shortName: 'Dr.', bracketGroup: 'rhythm' })
    ];
    if (template === 'string-quartet') return [
      createPart('violin', { name: 'Violin I', bracketGroup: 'strings' }),
      createPart('violin', { name: 'Violin II', bracketGroup: 'strings' }),
      createPart('viola', { bracketGroup: 'strings' }),
      createPart('cello', { bracketGroup: 'strings' })
    ];
    if (template === 'orchestra') return [
      createPart('flute', { bracketGroup: 'woodwinds' }), createPart('oboe', { bracketGroup: 'woodwinds' }),
      createPart('clarinet', { bracketGroup: 'woodwinds' }), createPart('bassoon', { bracketGroup: 'woodwinds' }),
      createPart('horn', { bracketGroup: 'brass' }), createPart('trumpet', { bracketGroup: 'brass' }),
      createPart('trombone', { bracketGroup: 'brass' }), createPart('tuba', { bracketGroup: 'brass' }),
      createPart('percussion', { bracketGroup: 'percussion' }),
      createPart('violin', { name: 'Violin I', bracketGroup: 'strings' }), createPart('violin', { name: 'Violin II', bracketGroup: 'strings' }),
      createPart('viola', { bracketGroup: 'strings' }), createPart('cello', { bracketGroup: 'strings' }), createPart('contrabass', { bracketGroup: 'strings' })
    ];
    if (template === 'custom') {
      const count = Math.max(1, Math.min(64, Number(options.staffCount) || 4));
      const keys = String(options.instrumentList || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
      return Array.from({ length: count }, (_, index) => {
        const key = keys[index] && INSTRUMENTS[keys[index]] ? keys[index] : 'soprano';
        return createPart(key, { name: options.instrumentNames?.[index] || (keys[index] && !INSTRUMENTS[keys[index]] ? keys[index] : undefined), bracketGroup: count > 1 ? 'custom' : null, harmonyRole: null });
      });
    }
    return [
      createPart('soprano', { bracketGroup: 'choir' }), createPart('alto', { bracketGroup: 'choir' }),
      createPart('tenor', { bracketGroup: 'choir' }), createPart('bass', { bracketGroup: 'choir' })
    ];
  }

  function createScore(options = {}) {
    const key = options.key || 'C';
    const timeSignature = options.timeSignature || '4/4';
    timeSignatureInfo(timeSignature);
    const measureCount = Math.max(1, Math.min(2000, Number(options.measures) || 8));
    const score = {
      format: 'airscore', formatVersion: 9, id: uid('score'),
      metadata: {
        title: options.title || 'Untitled Score', subtitle: options.subtitle || '', composer: options.composer || '',
        arranger: options.arranger || '', lyricist: options.lyricist || '', copyright: options.copyright || '',
        dedication: options.dedication || '', supportingText: options.supportingText || '', dateText: options.dateText || '',
        compositionDate: options.compositionDate || options.dateText || '', source: options.source || '', movementTitle: options.movementTitle || '',
        createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(), description: '', tags: []
      },
      settings: {
        key, mode: options.mode || (/m$/.test(key) ? 'minor' : 'major'), timeSignature,
        tempo: Number(options.tempo) || 96, measures: measureCount, pickupBeats: Math.max(0, Number(options.pickupBeats) || 0), pageSize: options.pageSize || 'A4', orientation: options.orientation || 'portrait',
        showSolfa: options.showSolfa === true, showLyrics: true, solfaShowVoiceLabels: false, concertPitch: options.concertPitch !== false, minorSolfaSystem: 'do-based', solfaPitchSystem: 'movable-do', solfaConvention: 'airmonlink-traditional-v1', solfaOverlayPosition: 'below', solfaOverlayScope: 'entire-score', solfaStaffVisibility: {}, solfaShowOctaveMarks: true, solfaShowMeasureDivisions: true, solfaShowTonicChanges: true, solfaShowWarnings: true, solfaFontSize: 8, solfaVerticalSpacing: 12, solfaLinkedEditing: true,
        autoFillRests: options.autoFillRests !== false, lyricAutoAdvance: options.lyricAutoAdvance !== false, entryLayerColors: options.entryLayerColors !== false, margins: Number(options.margins) || 15, staffSize: Number(options.staffSize) || 100,
        staffGap: Math.max(44, Number(options.staffGap) || 60), partGap: Math.max(28, Number(options.partGap) || 42), systemGap: Math.max(32, Number(options.systemGap) || 50)
      },
      measures: Array.from({ length: measureCount }, (_, index) => createMeasure(index, index === 0 ? { timeSignature, key } : {})),
      publicationTextLayout: {}, parts: templateParts(options.template || 'satb', options), chordSymbols: [], annotations: [], spanners: [], arrangement: null, importCompatibilityReport: null, revision: 1
    };
    return normalizeScore(score);
  }

  function cloneScore(score) { return JSON.parse(JSON.stringify(score)); }

  function timeSignatureInfo(value = '4/4') {
    const match = /^(\d{1,2})\/(1|2|4|8|16|32|64)$/.exec(String(value).trim());
    if (!match) throw new Error(`Unsupported time signature: ${value}`);
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    if (numerator < 1 || numerator > 64) throw new Error(`Invalid time-signature numerator: ${numerator}`);
    const beatUnitQuarter = 4 / denominator;
    const compound = denominator >= 8 && numerator > 3 && numerator % 3 === 0;
    return { numerator, denominator, beatUnitQuarter, measureQuarterBeats: numerator * beatUnitQuarter, compound, pulseQuarterBeats: compound ? beatUnitQuarter * 3 : beatUnitQuarter, subdivisionQuarterBeats: beatUnitQuarter };
  }

  function ensureMeasures(score) {
    score.settings = score.settings || {};
    if (!Array.isArray(score.measures)) score.measures = [];
    const current = score.measures;
    const count = Math.max(1, current.length || Number(score.settings.measures) || 1);
    while (current.length < count) current.push(createMeasure(current.length));
    current.forEach((measure, index) => {
      const normalized = { ...createMeasure(index), ...measure, number: index + 1 };
      if (index === 0 && !normalized.timeSignature) normalized.timeSignature = score.settings.timeSignature || '4/4';
      if (index === 0 && !normalized.key) normalized.key = score.settings.key || 'C';
      Object.assign(measure, normalized);
    });
    score.settings.measures = current.length;
    return current;
  }

  function timelineSignature(score) {
    const measureCount = Array.isArray(score?.measures) ? score.measures.length : Number(score?.settings?.measures) || 0;
    return `${score.revision || 0}|${measureCount}|${score.settings.timeSignature || '4/4'}|${score.settings.key || 'C'}|${Number(score.settings.pickupBeats) || 0}`;
  }

  function scoreTimeline(score) {
    const signature = timelineSignature(score);
    const cached = timelineCache.get(score);
    if (cached?.signature === signature) return cached;
    const measures = ensureMeasures(score);
    const starts = new Array(measures.length + 1).fill(0);
    const capacities = new Array(measures.length).fill(4);
    const timeSignatures = new Array(measures.length);
    const keys = new Array(measures.length);
    let activeTime = score.settings.timeSignature || '4/4';
    let activeKey = score.settings.key || 'C';
    let cursor = 0;
    for (let index = 0; index < measures.length; index += 1) {
      const measure = measures[index];
      if (measure.timeSignature) activeTime = measure.timeSignature;
      if (measure.key) activeKey = measure.key;
      let capacity = 4;
      try { capacity = timeSignatureInfo(activeTime).measureQuarterBeats; } catch (_) {}
      if (index === 0) {
        const pickup = Math.max(0, Number(score?.settings?.pickupBeats) || 0);
        if (pickup > 0 && pickup < capacity) capacity = pickup;
      }
      starts[index] = cursor;
      capacities[index] = capacity;
      timeSignatures[index] = activeTime;
      keys[index] = activeKey;
      cursor += capacity;
    }
    starts[measures.length] = cursor;
    const value = { signature, starts, capacities, timeSignatures, keys, total: cursor };
    timelineCache.set(score, value);
    return value;
  }

  function effectiveTimeSignature(score, measureIndex) {
    const timeline = scoreTimeline(score);
    const index = Math.max(0, Math.min(timeline.timeSignatures.length - 1, Number(measureIndex) || 0));
    return timeline.timeSignatures[index] || score.settings.timeSignature || '4/4';
  }

  function effectiveKey(score, measureIndex) {
    const timeline = scoreTimeline(score);
    const index = Math.max(0, Math.min(timeline.keys.length - 1, Number(measureIndex) || 0));
    return timeline.keys[index] || score.settings.key || 'C';
  }

  function beatsPerMeasure(score, measureIndex = 0) { return scoreTimeline(score).capacities[Math.max(0, Math.min(score.measures.length - 1, Number(measureIndex) || 0))] || 4; }
  function measureCapacity(score, measureIndex = 0) { return beatsPerMeasure(score, measureIndex); }
  function measureStartBeat(score, measureIndex) {
    const timeline = scoreTimeline(score);
    const index = Math.max(0, Math.min(timeline.starts.length - 1, Number(measureIndex) || 0));
    return timeline.starts[index];
  }
  function totalBeats(score) { return scoreTimeline(score).total; }
  function measureIndexAt(score, beat) {
    const timeline = scoreTimeline(score);
    const value = Math.max(0, Number(beat) || 0);
    let low = 0;
    let high = timeline.capacities.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (value < timeline.starts[mid] - 1e-9) high = mid - 1;
      else if (value >= timeline.starts[mid + 1] - 1e-9 && mid < timeline.capacities.length - 1) low = mid + 1;
      else return mid;
    }
    return Math.max(0, Math.min(timeline.capacities.length - 1, low));
  }
  function measureBounds(score, measureIndex) {
    const timeline = scoreTimeline(score);
    const index = Math.max(0, Math.min(timeline.capacities.length - 1, Number(measureIndex) || 0));
    const start = timeline.starts[index];
    const capacity = timeline.capacities[index];
    return { start, end: start + capacity, capacity, measureIndex: index, timeSignature: timeline.timeSignatures[index], key: timeline.keys[index] };
  }
  function beatInMeasure(score, beat) { const bounds = measureBounds(score, measureIndexAt(score, beat)); return Math.max(0, Number(beat) - bounds.start); }

  function snapBeat(score, rawBeat, duration = 1) {
    const measureIndex = measureIndexAt(score, rawBeat);
    const bounds = measureBounds(score, measureIndex);
    const signature = timeSignatureInfo(bounds.timeSignature);
    const fineGrid = Math.min(signature.subdivisionQuarterBeats, Math.max(.0625, theory.baseDuration(duration)));
    const grid = fineGrid >= 1 ? 1 : fineGrid;
    return bounds.start + Math.round((Number(rawBeat) - bounds.start) / grid) * grid;
  }

  function normalizeEvents(part) {
    part.events.sort((a, b) => (a.start - b.start) || ((a.voice || 1) - (b.voice || 1)) || String(a.staff || '').localeCompare(String(b.staff || '')) || String(a.id).localeCompare(String(b.id)));
    return part.events;
  }
  function isMultiStaff(part) { return part?.clef === 'grand' || part?.clef === 'multi' || (Array.isArray(part?.staffDefinitions) && part.staffDefinitions.length > 1); }
  function defaultStaff(part, midi) {
    if (!isMultiStaff(part)) return null;
    const definitions = Array.isArray(part.staffDefinitions) && part.staffDefinitions.length ? part.staffDefinitions : [{ id: 'treble', clef: 'treble' }, { id: 'bass', clef: 'bass' }];
    if (definitions.length === 2) {
      const treble = definitions.find(item => String(item.clef || '').startsWith('treble')) || definitions[0];
      const bass = definitions.find(item => item.clef === 'bass') || definitions[1];
      return String((Number(midi) < 60 ? bass : treble).id || (Number(midi) < 60 ? 'bass' : 'treble'));
    }
    const target = Number(midi) || 60;
    const ranked = definitions.map((item, index) => {
      const clef = item.clef || 'treble';
      const centre = clef === 'bass' ? 48 : clef === 'alto' ? 60 : clef === 'tenor' ? 57 : 72;
      return { item, index, distance: Math.abs(target - centre) };
    }).sort((a, b) => a.distance - b.distance || a.index - b.index);
    return String(ranked[0]?.item?.id || ranked[0]?.index + 1 || 1);
  }
  function normalizedPitch(note, score, part) {
    const measureKey = effectiveKey(score, measureIndexAt(score, note.start || 0));
    const concertPitch = score.settings.concertPitch !== false;
    if (typeof note.writtenPitch === 'string' || typeof note.pitch === 'string') {
      const input = typeof note.writtenPitch === 'string' ? note.writtenPitch : note.pitch;
      const displayMidi = theory.pitchToMidi(input);
      const midi = theory.soundingMidiFromDisplay(displayMidi, part, concertPitch);
      return { midi, pitch: concertPitch ? input : theory.spellMidiForKey(midi, measureKey), writtenPitch: concertPitch ? null : input };
    }
    const midi = theory.pitchToMidi(note.midi ?? 60);
    return { midi, pitch: theory.spellMidiForKey(midi, measureKey), writtenPitch: note.writtenPitch || null };
  }
  function activateVoice(part, voice) {
    const value = Math.max(1, Math.min(4, Number(voice) || 1));
    part.voiceLayers = [1, 2, 3, 4];
    part.activeVoice = value;
    return value;
  }

  function intervalsOverlap(aStart, aEnd, bStart, bEnd) { return aStart < bEnd - 1e-8 && bStart < aEnd - 1e-8; }
  function authoredEvents(part) { return part.events.filter(event => event.generatedBy !== 'gap-fill'); }
  function removeAutoRests(part) { part.events = part.events.filter(event => event.generatedBy !== 'gap-fill'); }

  function canPlaceEvent(score, partId, candidate, ignoreEventId = null) {
    const part = score.parts.find(item => item.id === partId);
    if (!part) return { ok: false, reason: 'Part not found.' };
    const start = Math.max(0, Number(candidate.start) || 0);
    const duration = Math.max(.0625, Number(candidate.duration) || 1);
    const voice = Math.max(1, Number(candidate.voice) || 1);
    const staff = candidate.staff || (isMultiStaff(part) ? defaultStaff(part, candidate.midi) : null);
    const measureIndex = measureIndexAt(score, start);
    const bounds = measureBounds(score, measureIndex);
    const crossesBarline = start + duration > bounds.end + 1e-8;
    if (crossesBarline && !candidate.allowAcrossBarline) return { ok: false, reason: `This ${theory.durationName(duration)} does not fit in bar ${measureIndex + 1} (${bounds.timeSignature}).`, measureIndex, bounds };
    if (start + duration > totalBeats(score) + 1e-8) return { ok: false, reason: 'The event extends beyond the score. Add another measure or choose a shorter duration.', measureIndex, bounds };
    const collision = authoredEvents(part).find(event => {
      if (event.id === ignoreEventId || (event.voice || 1) !== voice) return false;
      if (isMultiStaff(part) && (event.staff || defaultStaff(part, event.midi)) !== staff) return false;
      if (candidate.allowChord && candidate.type === 'note' && event.type === 'note' && Math.abs(event.start - start) < 1e-8 && Math.abs(event.duration - duration) < 1e-8) return false;
      return intervalsOverlap(start, start + duration, event.start, event.start + event.duration);
    });
    if (collision) return { ok: false, reason: `The selected position overlaps existing music in layer ${voice}. Choose Replace, another layer, or a compatible chord onset.`, collision, measureIndex, bounds };
    return { ok: true, measureIndex, bounds, crossesBarline };
  }

  function normalizeLyric(value = {}, context = {}) {
    const verse = Math.max(1, Number(value.verse ?? context.verse) || 1);
    const syllabic = value.syllabic || context.syllabic || null;
    const text = String(value.text ?? context.text ?? '');
    return {
      id: value.id || uid('lyric'),
      noteId: value.noteId || context.noteId || null,
      partId: value.partId || context.partId || null,
      staffId: value.staffId ?? context.staffId ?? null,
      voiceId: Math.max(1, Number(value.voiceId ?? context.voiceId) || 1),
      verse,
      lineType: value.lineType || context.lineType || 'verse',
      text,
      syllabic,
      hyphenState: value.hyphenState || (['begin', 'middle'].includes(syllabic) ? 'after' : 'none'),
      melisma: Boolean(value.melisma ?? value.extensionState === 'extend' ?? context.melisma),
      extensionState: value.extensionState || ((value.melisma ?? context.melisma) ? 'extend' : 'none'),
      elision: Boolean(value.elision ?? context.elision),
      offsetX: Number(value.offsetX ?? value.lyricOffsetX ?? context.offsetX) || 0,
      offsetY: Number(value.offsetY ?? value.lyricOffsetY ?? context.offsetY) || 0,
      styleId: value.styleId || context.styleId || 'lyrics-default'
    };
  }

  function normalizeEventLyrics(event, part) {
    if (!event || event.type !== 'note') return [];
    const raw = Array.isArray(event.lyrics) && event.lyrics.length
      ? event.lyrics
      : (event.lyric || event.melisma ? [{
          verse: event.lyricVerse || 1, text: event.lyric || '', syllabic: event.syllabic || null,
          melisma: Boolean(event.melisma), offsetX: event.lyricOffsetX || 0, offsetY: event.lyricOffsetY || 0
        }] : []);
    const lyrics = raw.map(item => normalizeLyric(item, {
      noteId: event.id, partId: part?.id || null, staffId: event.staff || null,
      voiceId: event.voice || 1, offsetX: event.lyricOffsetX || 0, offsetY: event.lyricOffsetY || 0
    })).sort((a, b) => a.verse - b.verse || String(a.id).localeCompare(String(b.id)));
    const primary = lyrics[0] || null;
    event.lyrics = lyrics;
    event.lyric = primary?.text || '';
    event.lyricVerse = primary?.verse || 1;
    event.syllabic = primary?.syllabic || null;
    event.melisma = Boolean(primary?.melisma);
    event.lyricOffsetX = Number(primary?.offsetX) || 0;
    event.lyricOffsetY = Number(primary?.offsetY) || 0;
    return lyrics;
  }

  function addNote(score, partId, note) {
    const part = score.parts.find(item => item.id === partId); if (!part) throw new Error('Part not found');
    const voice = activateVoice(part, note.voice);
    const normalized = normalizedPitch(note, score, part);
    const resolvedStaff = note.staff || defaultStaff(part, normalized.midi);
    const resolvedStart = Math.max(0, Number(note.start) || 0);
    const resolvedDuration = Math.max(.0625, Number(note.duration) || 1);
    if (note.allowChord) {
      const duplicate = authoredEvents(part).find(item => item.type === 'note' && item.midi === normalized.midi && Math.abs(item.start - resolvedStart) < 1e-8 && Math.abs(item.duration - resolvedDuration) < 1e-8 && (item.voice || 1) === voice && (item.staff || null) === (resolvedStaff || null));
      if (duplicate) return duplicate;
    }
    const event = {
      id: uid('note'), type: 'note', midi: normalized.midi, pitch: normalized.pitch, writtenPitch: normalized.writtenPitch,
      staff: resolvedStaff, start: resolvedStart, duration: resolvedDuration,
      velocity: Math.max(1, Math.min(127, Number(note.velocity) || 88)), voice,
      tieStart: Boolean(note.tieStart), tieStop: Boolean(note.tieStop), slurStart: Boolean(note.slurStart), slurStop: Boolean(note.slurStop),
      grace: Boolean(note.grace), tuplet: note.tuplet ? { ...note.tuplet } : null,
      articulations: Array.isArray(note.articulations) ? [...note.articulations] : [],
      generated: Boolean(note.generated), generationGroupId: note.generationGroupId || null, generatedBy: note.generatedBy || null
    };
    const rawLyrics = Array.isArray(note.lyrics) ? note.lyrics : (note.lyric || note.melisma ? [{
      verse: note.lyricVerse || 1, text: note.lyric || '', syllabic: note.syllabic || null,
      melisma: Boolean(note.melisma), offsetX: note.lyricOffsetX || 0, offsetY: note.lyricOffsetY || 0,
      lineType: note.lineType || 'verse'
    }] : []);
    event.lyrics = rawLyrics.map(item => normalizeLyric(item, {
      noteId: event.id, partId: part.id, staffId: event.staff, voiceId: voice
    }));
    normalizeEventLyrics(event, part);
    part.events.push(event); normalizeEvents(part); if (note.allowChord) normalizeChordIds(part); if (score.settings.autoFillRests !== false) regenerateAutoRests(score, part.id); touch(score); return event;
  }
  function addRest(score, partId, rest) {
    const part = score.parts.find(item => item.id === partId); if (!part) throw new Error('Part not found');
    const voice = activateVoice(part, rest.voice);
    const event = { id: uid('rest'), type: 'rest', start: Math.max(0, Number(rest.start) || 0), duration: Math.max(.0625, Number(rest.duration) || 1), voice, staff: rest.staff || (isMultiStaff(part) ? defaultStaff(part, 72) : null), generated: Boolean(rest.generated), generationGroupId: rest.generationGroupId || null, generatedBy: rest.generatedBy || null };
    part.events.push(event); normalizeEvents(part); if (score.settings.autoFillRests !== false && event.generatedBy !== 'gap-fill') regenerateAutoRests(score, part.id); touch(score); return event;
  }

  function updateEvent(score, partId, eventId, patch) {
    const part = score.parts.find(item => item.id === partId); if (!part) return false;
    const event = part.events.find(item => item.id === eventId); if (!event) return false;
    const next = { ...patch };
    if (event.type === 'note') {
      const concertPitch = score.settings.concertPitch !== false;
      const key = effectiveKey(score, measureIndexAt(score, next.start ?? event.start));
      if (typeof next.writtenPitch === 'string' || typeof next.pitch === 'string') {
        const input = typeof next.writtenPitch === 'string' ? next.writtenPitch : next.pitch;
        const displayMidi = theory.pitchToMidi(input); next.midi = theory.soundingMidiFromDisplay(displayMidi, part, concertPitch);
        next.pitch = concertPitch ? input : theory.spellMidiForKey(next.midi, key); next.writtenPitch = concertPitch ? null : input;
      } else if (next.midi != null) { next.midi = theory.clamp(Math.round(Number(next.midi)), 0, 127); next.pitch = theory.spellMidiForKey(next.midi, key); next.writtenPitch = null; }
      if (next.staff == null && isMultiStaff(part) && next.midi != null) next.staff = defaultStaff(part, next.midi);
      if (next.lyricOffsetX != null) next.lyricOffsetX = Number(next.lyricOffsetX) || 0;
      if (next.lyricOffsetY != null) next.lyricOffsetY = Number(next.lyricOffsetY) || 0;
    }
    if (event.type === 'note' && (next.lyric != null || next.lyricVerse != null || next.syllabic != null || next.melisma != null)) {
      const verse = Math.max(1, Number(next.lyricVerse ?? event.lyricVerse) || 1);
      const lyrics = Array.isArray(next.lyrics) ? next.lyrics.map(item => ({ ...item })) : (Array.isArray(event.lyrics) ? event.lyrics.map(item => ({ ...item })) : []);
      const item = { verse, text: String(next.lyric ?? event.lyric ?? ''), syllabic: next.syllabic ?? event.syllabic ?? null, melisma: Boolean(next.melisma ?? event.melisma) };
      const index = lyrics.findIndex(value => Math.max(1, Number(value.verse) || 1) === verse);
      if (item.text || item.melisma) { if (index >= 0) lyrics[index] = item; else lyrics.push(item); }
      else if (index >= 0) lyrics.splice(index, 1);
      lyrics.sort((a, b) => a.verse - b.verse); next.lyrics = lyrics;
    }
    if (next.duration != null) next.duration = Math.max(.0625, Number(next.duration));
    if (next.start != null) next.start = Math.max(0, Number(next.start));
    if (next.voice != null) next.voice = activateVoice(part, next.voice);
    Object.assign(event, next); if (event.type === 'note') normalizeEventLyrics(event, part); normalizeEvents(part); if (score.settings.autoFillRests !== false && event.generatedBy !== 'gap-fill') regenerateAutoRests(score, part.id); touch(score); return true;
  }
  function deleteEvent(score, partId, eventId) {
    const part = score.parts.find(item => item.id === partId); if (!part) return false;
    const before = part.events.length; part.events = part.events.filter(event => event.id !== eventId);
    if (part.events.length !== before) { removeDanglingSpanners(score); if (score.settings.autoFillRests !== false) regenerateAutoRests(score, part.id); touch(score); }
    return part.events.length !== before;
  }
  function setLyric(score, partId, eventId, lyric, options = {}) {
    const part = score.parts.find(item => item.id === partId); if (!part) return false;
    const event = part.events.find(item => item.id === eventId); if (!event || event.type !== 'note') return false;
    const verse = Math.max(1, Number(options.verse) || 1);
    const lyrics = normalizeEventLyrics(event, part).map(value => ({ ...value }));
    const index = lyrics.findIndex(value => value.verse === verse && (options.lineType ? value.lineType === options.lineType : true));
    const existing = index >= 0 ? lyrics[index] : {};
    const item = normalizeLyric({
      ...existing,
      verse,
      lineType: options.lineType || existing.lineType || 'verse',
      text: String(lyric || ''),
      syllabic: options.syllabic ?? existing.syllabic ?? null,
      melisma: Boolean(options.melisma ?? existing.melisma),
      extensionState: options.extensionState || existing.extensionState,
      elision: Boolean(options.elision ?? existing.elision),
      offsetX: options.offsetX ?? existing.offsetX ?? 0,
      offsetY: options.offsetY ?? existing.offsetY ?? 0,
      styleId: options.styleId || existing.styleId
    }, { noteId: event.id, partId: part.id, staffId: event.staff, voiceId: event.voice || 1 });
    if (item.text || item.melisma) { if (index >= 0) lyrics[index] = item; else lyrics.push(item); }
    else if (index >= 0) lyrics.splice(index, 1);
    event.lyrics = lyrics;
    normalizeEventLyrics(event, part);
    touch(score);
    return true;
  }

  function decomposeDuration(value) {
    let remaining = Math.max(0, Number(value) || 0); const result = [];
    const values = DURATIONS.map(item => item.value).sort((a, b) => b - a);
    while (remaining > 1e-8) {
      const found = values.find(duration => duration <= remaining + 1e-8) || .0625;
      result.push(found); remaining = Math.max(0, remaining - found);
      if (result.length > 512) break;
    }
    return result;
  }

  function regenerateAutoRests(score, partId = null) {
    const parts = partId ? score.parts.filter(part => part.id === partId) : score.parts;
    parts.forEach(part => {
      removeAutoRests(part);
      const layers = [1, 2, 3, 4];
      layers.forEach(voice => {
        const authoredInLayer = part.events.filter(event => (event.voice || 1) === voice && event.generatedBy !== 'gap-fill');
        let staffs;
        if (isMultiStaff(part)) {
          staffs = Array.isArray(part.staffDefinitions) && part.staffDefinitions.length
            ? part.staffDefinitions.map((item, index) => String(item.id || `staff-${index + 1}`))
            : ['treble', 'bass'];
        } else staffs = [null];
        staffs.forEach(staff => {
          const relevant = authoredInLayer.filter(event => !isMultiStaff(part) || (event.staff || defaultStaff(part, event.midi)) === staff);
          for (let measureIndex = 0; measureIndex < ensureMeasures(score).length; measureIndex += 1) {
            const bounds = measureBounds(score, measureIndex);
            const intervals = relevant.filter(event => event.start < bounds.end - 1e-8 && event.start + event.duration > bounds.start + 1e-8)
              .map(event => [Math.max(bounds.start, event.start), Math.min(bounds.end, event.start + event.duration)]).sort((a, b) => a[0] - b[0]);
            let cursor = bounds.start;
            intervals.forEach(([intervalStart, intervalEnd]) => {
              if (intervalStart > cursor + 1e-8) {
                let restStart = cursor;
                decomposeDuration(intervalStart - cursor).forEach(duration => {
                  part.events.push({ id: uid('rest'), type: 'rest', start: restStart, duration, voice, staff, generated: true, generatedBy: 'gap-fill', implicit: true });
                  restStart += duration;
                });
              }
              cursor = Math.max(cursor, intervalEnd);
            });
            if (cursor < bounds.end - 1e-8) {
              let restStart = cursor;
              decomposeDuration(bounds.end - cursor).forEach(duration => {
                part.events.push({ id: uid('rest'), type: 'rest', start: restStart, duration, voice, staff, generated: true, generatedBy: 'gap-fill', implicit: true });
                restStart += duration;
              });
            }
          }
        });
      });
      normalizeEvents(part);
      normalizeChordIds(part);
    });
    return score;
  }

  function mergedOccupiedDuration(events, bounds) {
    const intervals = events.map(event => [Math.max(bounds.start, event.start), Math.min(bounds.end, event.start + event.duration)]).filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
    const merged = [];
    intervals.forEach(interval => { const last = merged.at(-1); if (!last || interval[0] > last[1] + 1e-8) merged.push([...interval]); else last[1] = Math.max(last[1], interval[1]); });
    return merged.reduce((sum, [start, end]) => sum + end - start, 0);
  }
  function measureUsage(score, part, measureIndex, voice = 1, staff = null) {
    const bounds = measureBounds(score, measureIndex);
    const events = part.events.filter(event => event.generatedBy !== 'gap-fill' && (event.voice || 1) === voice && (!isMultiStaff(part) || (event.staff || defaultStaff(part, event.midi)) === staff) && event.start < bounds.end - 1e-8 && event.start + event.duration > bounds.start + 1e-8);
    const occupied = mergedOccupiedDuration(events, bounds);
    return { ...bounds, events, occupied, remaining: Math.max(0, bounds.capacity - occupied), complete: Math.abs(occupied - bounds.capacity) < 1e-8 };
  }

  function insertMeasures(score, index, count = 1, options = {}) {
    ensureMeasures(score);
    const insertIndex = Math.max(0, Math.min(score.measures.length, Number(index) || 0));
    const amount = Math.max(1, Math.min(500, Number(count) || 1));
    const insertionBeat = insertIndex >= score.measures.length ? totalBeats(score) : measureStartBeat(score, insertIndex);
    const inheritedSignature = effectiveTimeSignature(score, Math.max(0, insertIndex - 1));
    const inserted = Array.from({ length: amount }, (_, offset) => createMeasure(insertIndex + offset, offset === 0 && options.timeSignature ? { timeSignature: options.timeSignature, key: options.key } : {}));
    const insertedBeats = inserted.reduce((sum, measure, offset) => sum + timeSignatureInfo(measure.timeSignature || (offset === 0 && options.timeSignature) || inheritedSignature).measureQuarterBeats, 0);
    score.measures.splice(insertIndex, 0, ...inserted); score.settings.measures = score.measures.length; invalidateDerivedCaches(score);
    score.parts.forEach(part => part.events.forEach(event => { if (event.start >= insertionBeat - 1e-8) event.start += insertedBeats; }));
    score.chordSymbols.forEach(chord => { if (chord.start >= insertionBeat - 1e-8) chord.start += insertedBeats; });
    (score.annotations || []).forEach(item => { if (!['page','header','footer'].includes(item.scope) && item.start >= insertionBeat - 1e-8) item.start += insertedBeats; });
    ensureMeasures(score); if (score.settings.autoFillRests !== false) regenerateAutoRests(score); touch(score); return inserted;
  }
  function appendMeasures(score, count = 1) { return insertMeasures(score, ensureMeasures(score).length, count); }

  function configurePickupMeasure(score, pickupDuration = 0) {
    ensureMeasures(score);
    const nominalCapacity = timeSignatureInfo(effectiveTimeSignature(score, 0)).measureQuarterBeats;
    const requested = Math.max(0, Number(pickupDuration) || 0);
    if (requested >= nominalCapacity - 1e-8 && requested > 0) {
      throw new Error(`Pickup duration must be shorter than the nominal ${nominalCapacity}-beat measure.`);
    }
    const oldPickup = Math.max(0, Number(score.settings.pickupBeats) || 0);
    const oldCapacity = oldPickup > 0 && oldPickup < nominalCapacity ? oldPickup : nominalCapacity;
    const newCapacity = requested > 0 ? requested : nominalCapacity;
    if (Math.abs(newCapacity - oldCapacity) < 1e-8) {
      score.settings.pickupBeats = requested;
      return { pickupBeats: requested, nominalCapacity, oldCapacity, newCapacity, delta: 0 };
    }

    const authoredInOpeningMeasure = (score.parts || []).flatMap(part => (part.events || [])
      .filter(event => event.generatedBy !== 'gap-fill' && Number(event.start) < oldCapacity - 1e-8)
      .map(event => ({ part, event })));
    const incompatible = authoredInOpeningMeasure.find(({ event }) => Number(event.start) + Number(event.duration || 0) > newCapacity + 1e-8);
    if (incompatible) {
      throw new Error(`The new pickup is too short for ${incompatible.event.type} ${incompatible.event.id} ending at beat ${(Number(incompatible.event.start) + Number(incompatible.event.duration || 0)).toFixed(3)}.`);
    }

    // Remove derived timing fillers before the timeline changes. They will be rebuilt
    // after all semantic events have moved to their equivalent musical positions.
    (score.parts || []).forEach(part => removeAutoRests(part));
    const delta = newCapacity - oldCapacity;
    (score.parts || []).forEach(part => {
      (part.events || []).forEach(event => {
        if (Number(event.start) >= oldCapacity - 1e-8) event.start = Math.max(0, Number(event.start) + delta);
      });
      normalizeEvents(part);
    });
    (score.chordSymbols || []).forEach(item => {
      if (Number(item.start) >= oldCapacity - 1e-8) item.start = Math.max(0, Number(item.start) + delta);
    });
    (score.annotations || []).forEach(item => {
      if (!['page','header','footer'].includes(item.scope) && Number(item.start) >= oldCapacity - 1e-8) item.start = Math.max(0, Number(item.start) + delta);
    });
    score.settings.pickupBeats = requested;
    invalidateDerivedCaches(score);
    ensureMeasures(score);
    if (score.settings.autoFillRests !== false) regenerateAutoRests(score);
    touch(score);
    return { pickupBeats: requested, nominalCapacity, oldCapacity, newCapacity, delta };
  }

  function removeMeasure(score, index) {
    ensureMeasures(score); if (score.measures.length <= 1) throw new Error('A score must contain at least one measure.');
    const bounds = measureBounds(score, index); const removedCapacity = bounds.capacity;
    score.parts.forEach(part => {
      part.events = part.events.filter(event => event.start < bounds.start - 1e-8 || event.start >= bounds.end - 1e-8);
      part.events.forEach(event => { if (event.start >= bounds.end - 1e-8) event.start -= removedCapacity; });
    });
    score.chordSymbols = (score.chordSymbols || []).filter(item => item.start < bounds.start - 1e-8 || item.start >= bounds.end - 1e-8);
    score.chordSymbols.forEach(item => { if (item.start >= bounds.end - 1e-8) item.start -= removedCapacity; });
    score.annotations = (score.annotations || []).filter(item => ['page','header','footer'].includes(item.scope) || item.start < bounds.start - 1e-8 || item.start >= bounds.end - 1e-8);
    score.annotations.forEach(item => { if (!['page','header','footer'].includes(item.scope) && item.start >= bounds.end - 1e-8) item.start -= removedCapacity; });
    score.measures.splice(index, 1); score.settings.measures = score.measures.length; invalidateDerivedCaches(score); ensureMeasures(score); if (score.settings.autoFillRests !== false) regenerateAutoRests(score); touch(score);
  }
  function setMeasureAttributes(score, measureIndex, patch) {
    ensureMeasures(score);
    const index = Math.max(0, Math.min(score.measures.length - 1, Number(measureIndex) || 0));
    const measure = score.measures[index];
    const oldBounds = measureBounds(score, index);
    let meterChanged = false;
    if (patch.timeSignature != null) {
      if (patch.timeSignature) timeSignatureInfo(patch.timeSignature);
      const oldEffective = effectiveTimeSignature(score, index);
      measure.timeSignature = patch.timeSignature || null;
      invalidateDerivedCaches(score);
      meterChanged = effectiveTimeSignature(score, index) !== oldEffective;
      if (index === 0) score.settings.timeSignature = effectiveTimeSignature(score, 0);
    }
    if (patch.key != null) {
      measure.key = patch.key || null;
      invalidateDerivedCaches(score);
      if (index === 0) { score.settings.key = effectiveKey(score, 0); score.settings.mode = /m$/.test(score.settings.key) ? 'minor' : 'major'; }
    }
    if (patch.repeatStart != null) measure.repeatStart = Boolean(patch.repeatStart);
    if (patch.repeatEnd != null) measure.repeatEnd = Boolean(patch.repeatEnd);
    if (patch.repeatTimes != null) measure.repeatTimes = Math.max(2, Number(patch.repeatTimes) || 2);
    if (patch.endings != null) measure.endings = Array.from(new Set((Array.isArray(patch.endings) ? patch.endings : String(patch.endings).split(',')).map(Number).filter(value => Number.isFinite(value) && value >= 1))).sort((a, b) => a - b);
    if (patch.rehearsalMark != null) measure.rehearsalMark = String(patch.rehearsalMark || '');
    if (patch.barline != null) measure.barline = patch.barline || 'regular';
    if (patch.newSystem != null) measure.newSystem = Boolean(patch.newSystem);
    if (patch.newPage != null) { measure.newPage = Boolean(patch.newPage); if (measure.newPage) measure.newSystem = false; }
    if (meterChanged) {
      const newCapacity = timeSignatureInfo(effectiveTimeSignature(score, index)).measureQuarterBeats;
      const delta = newCapacity - oldBounds.capacity;
      if (Math.abs(delta) > 1e-8) {
        score.parts.forEach(part => part.events.forEach(event => { if (event.start >= oldBounds.end - 1e-8) event.start = Math.max(0, event.start + delta); }));
        score.chordSymbols.forEach(chord => { if (chord.start >= oldBounds.end - 1e-8) chord.start = Math.max(0, chord.start + delta); });
        (score.annotations || []).forEach(item => { if (!['page','header','footer'].includes(item.scope) && item.start >= oldBounds.end - 1e-8) item.start = Math.max(0, item.start + delta); });
      }
    }
    ensureMeasures(score); if (score.settings.autoFillRests !== false) regenerateAutoRests(score); touch(score); return measure;
  }


  function transpose(score, semitones, partIds) {
    const ids = partIds ? new Set(partIds) : null;
    score.parts.forEach(part => { if (ids && !ids.has(part.id)) return; part.events.forEach(event => { if (event.type !== 'note') return; event.midi = theory.clamp(event.midi + Number(semitones), 0, 127); event.pitch = theory.spellMidiForKey(event.midi, effectiveKey(score, measureIndexAt(score, event.start))); event.writtenPitch = null; if (isMultiStaff(part)) event.staff = defaultStaff(part, event.midi); }); });
    touch(score);
  }

  function validateScore(score) {
    const issues = []; ensureMeasures(score); const maxBeats = totalBeats(score);
    score.measures.forEach((measure, index) => { try { timeSignatureInfo(effectiveTimeSignature(score, index)); } catch (error) { issues.push({ severity: 'error', message: `Bar ${index + 1}: ${error.message}` }); } });
    score.parts.forEach(part => {
      authoredEvents(part).forEach(event => {
        if (event.start < 0 || event.start + event.duration > maxBeats + .001) issues.push({ severity: 'error', message: `${part.name}: event extends outside the score`, partId: part.id, eventId: event.id });
        const startMeasure = measureIndexAt(score, event.start); const endMeasure = measureIndexAt(score, Math.max(event.start, event.start + event.duration - 1e-8));
        if (startMeasure !== endMeasure) issues.push({ severity: 'error', message: `${part.name}: ${theory.durationName(event.duration)} crosses the barline at bar ${startMeasure + 1}`, partId: part.id, eventId: event.id });
        if (event.type === 'note') {
          if (event.midi < part.minPitch || event.midi > part.maxPitch) issues.push({ severity: 'warning', message: `${part.name}: ${event.pitch} is outside the practical range`, partId: part.id, eventId: event.id });
          const identity = theory.validatePitchIdentity(event, effectiveKey(score, startMeasure), part, score.settings.concertPitch !== false);
          if (!identity.valid) issues.push({ severity: 'error', message: `${part.name}: staff pitch, playback pitch and tonic sol-fa source do not agree`, partId: part.id, eventId: event.id });
        }
      });
      const events = authoredEvents(part);
      for (let i = 1; i < events.length; i += 1) {
        const current = events[i]; const overlap = events.slice(0, i).find(previous => {
          if ((previous.voice || 1) !== (current.voice || 1)) return false;
          if (isMultiStaff(part) && (previous.staff || defaultStaff(part, previous.midi)) !== (current.staff || defaultStaff(part, current.midi))) return false;
          if (previous.type === 'note' && current.type === 'note' && Math.abs(previous.start - current.start) < 1e-8 && Math.abs(previous.duration - current.duration) < 1e-8) return false;
          return intervalsOverlap(previous.start, previous.start + previous.duration, current.start, current.start + current.duration);
        });
        if (overlap) issues.push({ severity: 'error', message: `${part.name}: overlapping events in layer ${current.voice || 1}`, partId: part.id, eventId: current.id });
      }
    });
    return issues;
  }

  function migrateOverflowVoices(score, part) {
    const events = Array.isArray(part.events) ? part.events : [];
    const overflow = events.filter(event => (Number(event.voice) || 1) > 4);
    if (!overflow.length) {
      events.forEach(event => { event.voice = Math.max(1, Math.min(4, Number(event.voice) || 1)); });
      return;
    }
    const existingDefinitions = Array.isArray(part.staffDefinitions) && part.staffDefinitions.length
      ? part.staffDefinitions.map((item, index) => ({ ...item, id: String(item.id || `staff-${index + 1}`), number: Number(item.number) || index + 1 }))
      : (part.clef === 'grand'
          ? [{ id: 'treble', number: 1, clef: 'treble', name: 'Treble' }, { id: 'bass', number: 2, clef: 'bass', name: 'Bass' }]
          : [{ id: 'staff-1', number: 1, clef: part.clef || 'treble', name: part.name || 'Staff 1' }]);
    const baseStaff = existingDefinitions[0].id;
    events.forEach(event => {
      const originalVoice = Math.max(1, Number(event.voice) || 1);
      if (originalVoice <= 4) {
        event.voice = originalVoice;
        if (existingDefinitions.length > 1 && !event.staff) event.staff = baseStaff;
        return;
      }
      const overflowIndex = Math.floor((originalVoice - 1) / 4);
      const id = `voice-overflow-${overflowIndex}`;
      if (!existingDefinitions.some(item => item.id === id)) existingDefinitions.push({
        id, number: existingDefinitions.length + 1, clef: part.clef === 'grand' ? 'treble' : (part.clef || 'treble'),
        name: `Imported voices ${overflowIndex * 4 + 1}–${overflowIndex * 4 + 4}`
      });
      event.staff = id;
      event.voice = ((originalVoice - 1) % 4) + 1;
    });
    part.staffDefinitions = existingDefinitions;
    part.clef = existingDefinitions.length > 1 ? 'multi' : part.clef;
    score.importCompatibilityReport = score.importCompatibilityReport || { preserved: [], converted: [], unsupported: [], warnings: [] };
    score.importCompatibilityReport.converted.push(`${part.name}: voices above Layer 4 were moved to additional staves and mapped to Layers 1–4.`);
  }

  function findEvent(score, eventId) {
    if (!eventId) return null;
    const signature = `${score.revision || 0}|${(score.parts || []).reduce((sum, part) => sum + (part.events || []).length, 0)}`;
    let cached = eventLookupCache.get(score);
    if (!cached || cached.signature !== signature) {
      const byId = new Map();
      for (const part of score.parts || []) for (const event of part.events || []) byId.set(event.id, { part, event });
      cached = { signature, byId };
      eventLookupCache.set(score, cached);
    }
    return cached.byId.get(eventId) || null;
  }

  function normalizeSpanners(score) {
    score.spanners = Array.isArray(score.spanners) ? score.spanners : [];
    const validIds = new Set((score.parts || []).flatMap(part => (part.events || []).map(event => event.id)));
    score.spanners = score.spanners.filter(item => item && item.id && validIds.has(item.startEventId) && validIds.has(item.endEventId)).map(item => ({
      id: item.id || uid(item.type || 'spanner'), type: item.type === 'slur' ? 'slur' : 'tie',
      startEventId: item.startEventId, endEventId: item.endEventId,
      direction: ['above', 'below'].includes(item.direction) ? item.direction : 'auto',
      placementOffset: Number(item.placementOffset) || 0, generated: Boolean(item.generated)
    }));
    const existing = new Set(score.spanners.map(item => `${item.type}:${item.startEventId}:${item.endEventId}`));
    for (const part of score.parts || []) {
      const notes = (part.events || []).filter(event => event.type === 'note').sort((a, b) => a.start - b.start || a.midi - b.midi);
      notes.forEach((event, index) => {
        if (!event.tieStart && !event.slurStart) return;
        const next = notes.slice(index + 1).find(candidate => candidate.start >= event.start + event.duration - 1e-8 && (event.tieStart ? candidate.midi === event.midi : true));
        if (!next) return;
        const type = event.tieStart ? 'tie' : 'slur';
        const key = `${type}:${event.id}:${next.id}`;
        if (!existing.has(key)) score.spanners.push({ id: uid(type), type, startEventId: event.id, endEventId: next.id, direction: 'auto', placementOffset: 0, generated: Boolean(event.tieGroupId) });
      });
    }
    syncLegacySpannerFlags(score);
    return score.spanners;
  }

  function syncLegacySpannerFlags(score) {
    for (const part of score.parts || []) for (const event of part.events || []) if (event.type === 'note') {
      event.tieStart = false; event.tieStop = false; event.slurStart = false; event.slurStop = false;
    }
    for (const spanner of score.spanners || []) {
      const start = findEvent(score, spanner.startEventId)?.event;
      const end = findEvent(score, spanner.endEventId)?.event;
      if (!start || !end) continue;
      if (spanner.type === 'tie') { start.tieStart = true; end.tieStop = true; start.tieGroupId = start.tieGroupId || spanner.id; end.tieGroupId = end.tieGroupId || spanner.id; }
      else { start.slurStart = true; end.slurStop = true; start.slurNumber = end.slurNumber = Number(spanner.number) || 1; }
    }
  }

  function addSpanner(score, type, startEventId, endEventId, options = {}) {
    const startRef = findEvent(score, startEventId); const endRef = findEvent(score, endEventId);
    if (!startRef || !endRef || startRef.event.type !== 'note' || endRef.event.type !== 'note') throw new Error('Ties and slurs must connect existing notes.');
    if (startRef.part.id !== endRef.part.id) throw new Error('A tie or slur must remain within one part.');
    if (endRef.event.start <= startRef.event.start + 1e-8) throw new Error('The ending note must occur after the starting note.');
    const normalizedType = type === 'slur' ? 'slur' : 'tie';
    if (normalizedType === 'tie' && Number(startRef.event.midi) !== Number(endRef.event.midi)) throw new Error('A tie must connect notes of the same sounding pitch.');
    const existing = (score.spanners || []).find(item => item.type === normalizedType && item.startEventId === startEventId && item.endEventId === endEventId);
    if (existing) return existing;
    const spanner = { id: uid(normalizedType), type: normalizedType, startEventId, endEventId, direction: options.direction || 'auto', placementOffset: Number(options.placementOffset) || 0, generated: Boolean(options.generated) };
    score.spanners = Array.isArray(score.spanners) ? score.spanners : [];
    score.spanners.push(spanner); syncLegacySpannerFlags(score); touch(score); return spanner;
  }
  function addTie(score, startEventId, endEventId, options = {}) { return addSpanner(score, 'tie', startEventId, endEventId, options); }
  function addSlur(score, startEventId, endEventId, options = {}) { return addSpanner(score, 'slur', startEventId, endEventId, options); }
  function removeSpanner(score, spannerId) { const before = (score.spanners || []).length; score.spanners = (score.spanners || []).filter(item => item.id !== spannerId); if (score.spanners.length !== before) { syncLegacySpannerFlags(score); touch(score); return true; } return false; }
  function removeDanglingSpanners(score) { const ids = new Set((score.parts || []).flatMap(part => (part.events || []).map(event => event.id))); score.spanners = (score.spanners || []).filter(item => ids.has(item.startEventId) && ids.has(item.endEventId)); syncLegacySpannerFlags(score); }
  function spannersForEvent(score, eventId) { return (score.spanners || []).filter(item => item.startEventId === eventId || item.endEventId === eventId); }

  function layerCapacity(score, part, measureIndex, voice, staff = null) {
    const usage = measureUsage(score, part, measureIndex, voice, staff);
    const bounds = measureBounds(score, measureIndex);
    const all = (part.events || []).filter(event => (event.voice || 1) === voice && (!isMultiStaff(part) || (event.staff || defaultStaff(part, event.midi)) === staff) && event.start < bounds.end - 1e-8 && event.start + event.duration > bounds.start + 1e-8);
    const authored = all.filter(event => event.generatedBy !== 'gap-fill');
    const used = mergedOccupiedDuration(all, bounds);
    return {
      ...usage,
      voice,
      staff,
      authoredUsed: usage.occupied,
      authoredRemaining: usage.remaining,
      used,
      remaining: Math.max(0, bounds.capacity - used),
      complete: Math.abs(used - bounds.capacity) < 1e-8,
      authoredNoteCount: authored.filter(event => event.type === 'note').length,
      authoredRestCount: authored.filter(event => event.type === 'rest').length,
      calculatedRestCount: all.filter(event => event.type === 'rest' && event.generatedBy === 'gap-fill').length,
      overfilled: used > bounds.capacity + 1e-8,
      incomplete: used < bounds.capacity - 1e-8
    };
  }


  function normalizeChordIds(part) {
    const groups = new Map();
    for (const event of part.events || []) {
      if (event.type !== 'note') continue;
      const key = `${Number(event.start).toFixed(8)}|${Number(event.duration).toFixed(8)}|${event.staff || ''}|${Number(event.voice) || 1}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    for (const events of groups.values()) {
      if (events.length < 2) {
        if (events[0] && events[0].chordId && !events[0].keepChordId) delete events[0].chordId;
        continue;
      }
      const chordId = events.find(event => event.chordId)?.chordId || uid('chord');
      events.forEach(event => { event.chordId = chordId; });
    }
    return part;
  }

  function chordMembers(score, eventId) {
    const ref = findEvent(score, eventId);
    if (!ref || ref.event.type !== 'note') return [];
    const event = ref.event;
    return ref.part.events.filter(candidate => candidate.type === 'note' && (
      event.chordId ? candidate.chordId === event.chordId : (
        Math.abs(candidate.start - event.start) < 1e-8 && Math.abs(candidate.duration - event.duration) < 1e-8 &&
        (candidate.voice || 1) === (event.voice || 1) && (candidate.staff || null) === (event.staff || null)
      )
    )).sort((a, b) => a.midi - b.midi);
  }

  function addChordTone(score, partId, anchorEventId, midi, options = {}) {
    const part = score.parts.find(item => item.id === partId);
    const anchor = part?.events.find(item => item.id === anchorEventId);
    if (!part || !anchor || anchor.type !== 'note') throw new Error('Select a note or chord before adding a chord tone.');
    const value = theory.pitchToMidi(midi);
    const members = chordMembers(score, anchor.id);
    if (members.some(item => item.midi === value)) return members.find(item => item.midi === value);
    const chordId = anchor.chordId || uid('chord');
    members.forEach(item => { item.chordId = chordId; });
    const measureIndex = measureIndexAt(score, anchor.start);
    const note = {
      ...JSON.parse(JSON.stringify(anchor)),
      id: uid('note'), chordId, midi: value,
      velocity: Math.max(1, Math.min(127, Number(options.velocity) || Number(anchor.velocity) || 88)),
      pitch: theory.spellMidiForKey(value, effectiveKey(score, measureIndex)),
      writtenPitch: null, lyrics: options.copyLyrics ? JSON.parse(JSON.stringify(anchor.lyrics || [])) : [],
      lyric: options.copyLyrics ? anchor.lyric || '' : '', lyricVerse: options.copyLyrics ? anchor.lyricVerse || 1 : 1,
      tieStart: false, tieStop: false, slurStart: false, slurStop: false
    };
    part.events.push(note);
    normalizeEvents(part); normalizeChordIds(part); touch(score);
    return note;
  }

  function addIntervalToChord(score, partId, anchorEventId, interval, direction = 1, options = {}) {
    const ref = findEvent(score, anchorEventId);
    if (!ref || ref.part.id !== partId || ref.event.type !== 'note') throw new Error('Select a note or chord tone before adding an interval.');
    const semitones = Math.abs(theory.intervalSemitones(interval));
    if (!semitones) throw new Error('The added interval must be larger than a unison.');
    const sign = Number(direction) < 0 ? -1 : 1;
    const target = theory.clamp(Number(ref.event.midi) + sign * semitones, 0, 127);
    if (target === Number(ref.event.midi)) throw new Error('The requested interval is outside the supported MIDI range.');
    return addChordTone(score, partId, anchorEventId, target, options);
  }

  function removeChordTone(score, partId, eventId) {
    const part = score.parts.find(item => item.id === partId);
    const event = part?.events.find(item => item.id === eventId);
    if (!part || !event || event.type !== 'note') return false;
    const members = chordMembers(score, eventId);
    part.events = part.events.filter(item => item.id !== eventId);
    score.spanners = (score.spanners || []).filter(item => item.startEventId !== eventId && item.endEventId !== eventId);
    const remainingIds = new Set(members.filter(item => item.id !== eventId).map(item => item.id));
    const remaining = part.events.filter(item => remainingIds.has(item.id));
    if (remaining.length < 2) remaining.forEach(item => { delete item.chordId; });
    normalizeEvents(part); touch(score); return true;
  }

  function setChordDuration(score, eventId, duration) {
    const members = chordMembers(score, eventId);
    if (!members.length) return 0;
    const value = Math.max(.0625, Number(duration) || 1);
    members.forEach(event => { event.duration = value; });
    const ref = findEvent(score, eventId); if (ref) normalizeEvents(ref.part);
    touch(score); return members.length;
  }

  function transposeChord(score, eventId, semitones) {
    const members = chordMembers(score, eventId);
    const amount = Number(semitones) || 0;
    for (const event of members) {
      event.midi = theory.clamp(event.midi + amount, 0, 127);
      event.pitch = theory.spellMidiForKey(event.midi, effectiveKey(score, measureIndexAt(score, event.start)));
      event.writtenPitch = null;
    }
    if (members.length) touch(score);
    return members.length;
  }

  function staffLayoutKey(partId, staff = null) {
    return `${String(partId || '')}::${String(staff || 'single')}`;
  }

  function staffManualAfter(score, partId, staff = null) {
    const key = staffLayoutKey(partId, staff);
    return Math.max(0, Number(score?.layoutOverrides?.staffAfter?.[key]) || 0);
  }

  function adjustStaffManualAfter(score, partId, staff = null, delta = 0) {
    score.layoutOverrides = score.layoutOverrides && typeof score.layoutOverrides === 'object' ? score.layoutOverrides : {};
    score.layoutOverrides.staffAfter = score.layoutOverrides.staffAfter && typeof score.layoutOverrides.staffAfter === 'object' ? score.layoutOverrides.staffAfter : {};
    const key = staffLayoutKey(partId, staff);
    const next = Math.max(0, Math.min(160, staffManualAfter(score, partId, staff) + (Number(delta) || 0)));
    if (next > 1e-8) score.layoutOverrides.staffAfter[key] = next;
    else delete score.layoutOverrides.staffAfter[key];
    touch(score);
    return next;
  }

  function resetManualSpacing(score) {
    score.layoutOverrides = score.layoutOverrides && typeof score.layoutOverrides === 'object' ? score.layoutOverrides : {};
    score.layoutOverrides.staffAfter = {};
    score.layoutOverrides.itemOffsets = score.layoutOverrides.itemOffsets && typeof score.layoutOverrides.itemOffsets === 'object' ? score.layoutOverrides.itemOffsets : {};
    touch(score);
    return score.layoutOverrides;
  }

  function normalizeAnnotation(item = {}) {
    const scope = ['page', 'header', 'footer', 'system', 'staff', 'measure', 'segment'].includes(item.scope) ? item.scope : 'segment';
    return {
      id: item.id || uid('text'), type: item.type || 'staff-text', scope,
      text: String(item.text || ''), partId: item.partId || null, staff: item.staff || null,
      measureIndex: Math.max(0, Number(item.measureIndex) || 0), start: Math.max(0, Number(item.start ?? item.tick) || 0),
      placement: item.placement === 'below' ? 'below' : 'above', alignment: item.alignment || 'left',
      style: item.style || 'default', offsetX: Number(item.offsetX) || 0, offsetY: Number(item.offsetY) || 0,
      pageIndex: Math.max(0, Number(item.pageIndex ?? ((item.sourceData?.page || 1) - 1)) || 0),
      language: item.language || '', xmlRole: item.xmlRole || null, sourceData: item.sourceData || null
    };
  }

  function normalizePublicationTextLayout(layout = {}) {
    const normalized = {};
    if (!layout || typeof layout !== 'object') return normalized;
    for (const [key, value] of Object.entries(layout)) {
      if (!/^(staff|solfa):(title|subtitle|dedication|composer|compositionDate|arranger|lyricist|source|supportingText|copyright)$/.test(key) || !value || typeof value !== 'object') continue;
      normalized[key] = {
        offsetX: Number.isFinite(Number(value.offsetX)) ? Number(value.offsetX) : 0,
        offsetY: Number.isFinite(Number(value.offsetY)) ? Number(value.offsetY) : 0,
        alignment: ['left','center','right'].includes(value.alignment) ? value.alignment : null,
        fontFamily: String(value.fontFamily || ''),
        fontSize: Number.isFinite(Number(value.fontSize)) ? Math.max(6, Math.min(96, Number(value.fontSize))) : null,
        fontStyle: ['normal','italic'].includes(value.fontStyle) ? value.fontStyle : null,
        fontWeight: ['normal','bold'].includes(value.fontWeight) ? value.fontWeight : null,
        visible: value.visible !== false
      };
    }
    return normalized;
  }

  function updatePublicationTextLayout(score, key, patch = {}) {
    if (!/^(staff|solfa):/.test(String(key))) throw new Error('Publication text requires a staff or solfa scope.');
    score.publicationTextLayout = normalizePublicationTextLayout({ ...(score.publicationTextLayout || {}), [key]: { ...(score.publicationTextLayout?.[key] || {}), ...patch } });
    touch(score); return score.publicationTextLayout[key];
  }

  function addAnnotation(score, payload = {}) {
    const item = normalizeAnnotation(payload);
    score.annotations = Array.isArray(score.annotations) ? score.annotations : [];
    score.annotations.push(item); touch(score); return item;
  }

  function updateAnnotation(score, annotationId, patch = {}) {
    const index = (score.annotations || []).findIndex(item => item.id === annotationId);
    if (index < 0) return null;
    score.annotations[index] = normalizeAnnotation({ ...score.annotations[index], ...patch, id: annotationId });
    touch(score); return score.annotations[index];
  }

  function deleteAnnotation(score, annotationId) {
    const before = (score.annotations || []).length;
    score.annotations = (score.annotations || []).filter(item => item.id !== annotationId);
    if (score.annotations.length === before) return false;
    touch(score); return true;
  }

  function annotationsAt(score, beat, options = {}) {
    const value = Math.max(0, Number(beat) || 0);
    return (score.annotations || []).filter(item => Math.abs(Number(item.start) - value) < 1e-8 && (!options.partId || !item.partId || item.partId === options.partId) && (options.staff == null || item.staff == null || item.staff === options.staff));
  }

  function normalizeScore(score) {
    const normalized = score || {};
    normalized.format = 'airscore'; normalized.formatVersion = 9; normalized.id = normalized.id || uid('score');
    normalized.metadata = { title: 'Untitled Score', subtitle: '', composer: '', arranger: '', lyricist: '', copyright: '', dedication: '', supportingText: '', dateText: '', compositionDate: '', source: '', movementTitle: '', createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(), description: '', tags: [], ...(normalized.metadata || {}) };
    normalized.settings = { key: 'C', mode: 'major', timeSignature: '4/4', tempo: 96, measures: 8, concertPitch: true, showSolfa: false, showLyrics: true, solfaShowVoiceLabels: false, minorSolfaSystem: 'do-based', solfaPitchSystem: 'movable-do', solfaConvention: 'airmonlink-traditional-v1', solfaOverlayPosition: 'below', solfaOverlayScope: 'entire-score', solfaStaffVisibility: {}, solfaShowOctaveMarks: true, solfaShowMeasureDivisions: true, solfaShowTonicChanges: true, solfaShowWarnings: true, solfaFontSize: 8, solfaVerticalSpacing: 12, solfaLinkedEditing: true, solfaMode: 'traditional', solfaLabels: 'short', solfaShowLyrics: true, solfaShowRhythm: true, autoFillRests: true, lyricAutoAdvance: true, entryLayerColors: true, pickupBeats: 0, margins: 15, staffSize: 100, staffGap: 60, partGap: 42, systemGap: 50, ...(normalized.settings || {}) };
    const rawLayoutOverrides = normalized.layoutOverrides && typeof normalized.layoutOverrides === 'object' ? normalized.layoutOverrides : {};
    const rawStaffAfter = rawLayoutOverrides.staffAfter && typeof rawLayoutOverrides.staffAfter === 'object' ? rawLayoutOverrides.staffAfter : {};
    normalized.layoutOverrides = {
      ...rawLayoutOverrides,
      staffAfter: Object.fromEntries(Object.entries(rawStaffAfter).map(([key, value]) => [String(key), Math.max(0, Math.min(160, Number(value) || 0))]).filter(([, value]) => value > 1e-8)),
      itemOffsets: rawLayoutOverrides.itemOffsets && typeof rawLayoutOverrides.itemOffsets === 'object' ? rawLayoutOverrides.itemOffsets : {}
    };
    delete normalized.settings.workspace;
    ensureMeasures(normalized);
    normalized.parts = Array.isArray(normalized.parts) ? normalized.parts : [];
    normalized.measures.forEach((measure, index) => { measure.id = measure.id || uid('measure'); measure.number = index + 1; });
    normalized.parts.forEach(part => {
      part.id = part.id || uid('part');
      part.clefChanges = Array.isArray(part.clefChanges) ? part.clefChanges : [];
      part.voiceLayers = [1, 2, 3, 4];
      part.activeVoice = Math.max(1, Math.min(4, Number(part.activeVoice) || 1));
      part.events = Array.isArray(part.events) ? part.events : [];
      migrateOverflowVoices(normalized, part);
      part.events.forEach(event => {
        event.id = event.id || uid(event.type === 'rest' ? 'rest' : 'note');
        event.voice = Math.max(1, Number(event.voice) || 1); event.duration = Math.max(.0625, Number(event.duration) || 1); event.start = Math.max(0, Number(event.start) || 0);
        if (event.type === 'note') {
          event.midi = theory.pitchToMidi(event.midi ?? event.pitch ?? 'C4'); const key = effectiveKey(normalized, measureIndexAt(normalized, event.start));
          try { if (!event.pitch || theory.pitchToMidi(event.pitch) !== event.midi) event.pitch = theory.spellMidiForKey(event.midi, key); } catch (_) { event.pitch = theory.spellMidiForKey(event.midi, key); }
          if (isMultiStaff(part) && !event.staff) event.staff = defaultStaff(part, event.midi);
          event.lyricVerse = Math.max(1, Number(event.lyricVerse) || 1); normalizeEventLyrics(event, part);
        }
      });
      normalizeEvents(part);
      normalizeChordIds(part);
    });
    normalized.chordSymbols = Array.isArray(normalized.chordSymbols) ? normalized.chordSymbols : [];
    normalized.publicationTextLayout = normalizePublicationTextLayout(normalized.publicationTextLayout);
    normalized.annotations = (Array.isArray(normalized.annotations) ? normalized.annotations : []).map(normalizeAnnotation);
    normalized.solfaMigrationReport = Array.isArray(normalized.solfaMigrationReport) ? normalized.solfaMigrationReport : [];
    if (!normalized.solfaMigrationReport.some(item => item && item.version === 9)) {
      const legacySources = normalized.parts.flatMap(part => [part.tonicSolfaText, part.solfaText]).filter(value => typeof value === 'string' && value.trim());
      normalized.solfaMigrationReport.push({ version: 9, status: legacySources.length ? 'review-required' : 'structured-score-preserved', convention: normalized.settings.solfaConvention, message: legacySources.length ? 'Legacy tonic-solfa text was preserved and requires parser review before linked replacement.' : 'Existing structured notes, rests, lyrics, layers and spanners were preserved; the formal convention was added without changing playback.' });
    }
    normalizeSpanners(normalized);
    if (normalized.settings.autoFillRests !== false) regenerateAutoRests(normalized);
    return normalized;
  }
  function touch(score) { invalidateDerivedCaches(score); score.metadata.modifiedAt = new Date().toISOString(); score.revision = (score.revision || 0) + 1; }
  function seedDemo(score) {
    const melody = [60, 62, 64, 65, 67, 67, 69, 67, 65, 64, 62, 60]; const durations = [1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 2, 4]; let cursor = 0;
    melody.forEach((midi, index) => { const measureIndex = measureIndexAt(score, cursor); const bounds = measureBounds(score, measureIndex); if (cursor + durations[index] > bounds.end + 1e-8) cursor = bounds.end; addNote(score, score.parts[0].id, { midi, start: cursor, duration: durations[index], lyric: ['Praise', 'to', 'the', 'Lord', 'our', 'King', 'sing', 'with', 'joy', 'and', 'love', 'always'][index] || '' }); cursor += durations[index]; });
    while (totalBeats(score) < cursor) appendMeasures(score, 1); return score;
  }

  function playbackMeasureOrder(score) {
    ensureMeasures(score);
    const order = [];
    let index = 0;
    let repeatStart = 0;
    let repeatPass = 1;
    let activeRepeat = false;
    let completedRepeatPass = null;
    let guard = 0;
    while (index < score.measures.length && guard++ < score.measures.length * 128) {
      const measure = score.measures[index];
      if (measure.repeatStart && !activeRepeat) {
        repeatStart = index;
        repeatPass = 1;
        activeRepeat = true;
        completedRepeatPass = null;
      }
      const applicablePass = activeRepeat ? repeatPass : (completedRepeatPass || 1);
      const endings = Array.isArray(measure.endings) ? measure.endings : [];
      if (!endings.length || endings.includes(applicablePass)) order.push({ measureIndex: index, pass: applicablePass });

      if (measure.repeatEnd) {
        const times = Math.max(2, Number(measure.repeatTimes) || 2);
        if (!activeRepeat) activeRepeat = true;
        if (repeatPass < times) {
          repeatPass += 1;
          index = repeatStart;
          continue;
        }
        completedRepeatPass = repeatPass;
        activeRepeat = false;
        repeatPass = 1;
        index += 1;
        continue;
      }

      const next = score.measures[index + 1];
      if (!activeRepeat && completedRepeatPass != null && endings.length && !(Array.isArray(next?.endings) && next.endings.length)) completedRepeatPass = null;
      else if (!activeRepeat && completedRepeatPass != null && !endings.length && !(Array.isArray(next?.endings) && next.endings.length)) completedRepeatPass = null;
      index += 1;
    }
    return order.length ? order : score.measures.map((_, measureIndex) => ({ measureIndex, pass: 1 }));
  }

  return {
    DURATIONS, INSTRUMENTS, uid, createPart, createMeasure, createScore, cloneScore, timeSignatureInfo, ensureMeasures,
    effectiveTimeSignature, effectiveKey, beatsPerMeasure, measureCapacity, measureStartBeat, totalBeats, measureIndexAt, measureBounds, beatInMeasure,
    snapBeat, measureUsage, canPlaceEvent, addNote, addRest, updateEvent, deleteEvent, setLyric, normalizeLyric, normalizeEventLyrics, transpose,
    validateScore, normalizeEvents, normalizeScore, touch, seedDemo, defaultStaff, isMultiStaff, activateVoice, regenerateAutoRests,
    decomposeDuration, insertMeasures, appendMeasures, removeMeasure, setMeasureAttributes, configurePickupMeasure, authoredEvents, playbackMeasureOrder,
    findEvent, normalizeSpanners, addSpanner, addTie, addSlur, removeSpanner, removeDanglingSpanners, spannersForEvent, layerCapacity,
    normalizeChordIds, chordMembers, addChordTone, addIntervalToChord, removeChordTone, setChordDuration, transposeChord,
    staffLayoutKey, staffManualAfter, adjustStaffManualAfter, resetManualSpacing,
    normalizeAnnotation, addAnnotation, updateAnnotation, deleteAnnotation, annotationsAt,
    normalizePublicationTextLayout, updatePublicationTextLayout
  };
});
