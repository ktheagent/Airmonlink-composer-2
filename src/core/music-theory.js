(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonMusicTheory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PITCH_CLASSES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const PITCH_CLASSES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_TO_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
  const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
  const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  const KEY_SIGNATURES = {
    C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
    F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
    Am: 0, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7,
    Dm: -1, Gm: -2, Cm: -3, Fm: -4, Bbm: -5, Ebm: -6, Abm: -7
  };

  // Diatonic index of the pitch on each clef's bottom line.
  const CLEF_BOTTOM_LINES = {
    treble: 30,       // E4
    'treble-8': 30,   // written E4; sounds one octave lower
    bass: 18,         // G2
    alto: 24,         // F3
    tenor: 22         // D3
  };

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function mod(value, divisor) { return ((value % divisor) + divisor) % divisor; }

  function parsePitch(pitch) {
    const match = /^([A-Ga-g])([#b]{0,2})(-?\d+)$/.exec(String(pitch || '').trim());
    if (!match) throw new Error(`Invalid pitch: ${pitch}`);
    const letter = match[1].toUpperCase();
    const accidentalText = match[2];
    const accidental = [...accidentalText].reduce((sum, char) => sum + (char === '#' ? 1 : -1), 0);
    return { letter, accidental, accidentalText, octave: Number(match[3]) };
  }

  function accidentalText(alteration) {
    const value = Math.round(Number(alteration) || 0);
    if (value > 0) return '#'.repeat(value);
    if (value < 0) return 'b'.repeat(-value);
    return '';
  }

  function pitchToMidi(pitch) {
    if (typeof pitch === 'number') return clamp(Math.round(pitch), 0, 127);
    const parsed = parsePitch(pitch);
    return clamp((parsed.octave + 1) * 12 + LETTER_TO_PC[parsed.letter] + parsed.accidental, 0, 127);
  }

  function midiToPitch(midi, preferFlats = false) {
    const value = clamp(Math.round(Number(midi)), 0, 127);
    const names = preferFlats ? PITCH_CLASSES_FLAT : PITCH_CLASSES_SHARP;
    return `${names[value % 12]}${Math.floor(value / 12) - 1}`;
  }

  function keyRoot(key = 'C') {
    const clean = String(key).replace(/m$/, '');
    const match = /^([A-G])([#b]?)$/.exec(clean);
    if (!match) return { letter: 'C', accidental: 0, pc: 0, text: 'C' };
    const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
    return { letter: match[1], accidental, pc: mod(LETTER_TO_PC[match[1]] + accidental, 12), text: clean };
  }

  function keyRootPc(key = 'C') { return keyRoot(key).pc; }
  function isMinorKey(key = 'C', mode) { return mode ? mode === 'minor' : /m$/.test(String(key)); }

  function keySignatureCount(key = 'C') {
    const value = KEY_SIGNATURES[String(key)];
    if (Number.isInteger(value)) return value;
    return KEY_SIGNATURES[String(key).replace(/m$/, '')] || 0;
  }

  function keySignatureAlteration(letter, key = 'C') {
    const count = keySignatureCount(key);
    if (count > 0 && SHARP_ORDER.slice(0, count).includes(letter)) return 1;
    if (count < 0 && FLAT_ORDER.slice(0, -count).includes(letter)) return -1;
    return 0;
  }

  function scaleForKey(key = 'C', mode) {
    const formula = isMinorKey(key, mode) ? NATURAL_MINOR_SCALE : MAJOR_SCALE;
    const root = keyRootPc(key);
    return formula.map(step => mod(root + step, 12));
  }

  function pitchToDiatonicIndex(pitch) {
    const { letter, octave } = parsePitch(pitch);
    return octave * 7 + LETTERS.indexOf(letter);
  }

  function diatonicIndexToNatural(index) {
    const rounded = Math.round(Number(index));
    return { letter: LETTERS[mod(rounded, 7)], octave: Math.floor(rounded / 7) };
  }

  function pitchFromDiatonicIndex(index, key = 'C', explicitAlteration = null) {
    const { letter, octave } = diatonicIndexToNatural(index);
    const alteration = explicitAlteration == null ? keySignatureAlteration(letter, key) : Number(explicitAlteration);
    return `${letter}${accidentalText(alteration)}${octave}`;
  }

  function spellMidiForKey(midi, key = 'C', preferredLetter = null) {
    const value = clamp(Math.round(Number(midi)), 0, 127);
    const keyCount = keySignatureCount(key);
    const candidates = [];
    for (const letter of LETTERS) {
      if (preferredLetter && letter !== preferredLetter) continue;
      const approximateOctave = Math.floor(value / 12) - 1;
      for (let octave = approximateOctave - 1; octave <= approximateOctave + 1; octave += 1) {
        const naturalMidi = (octave + 1) * 12 + LETTER_TO_PC[letter];
        const alteration = value - naturalMidi;
        if (alteration < -2 || alteration > 2) continue;
        const expected = keySignatureAlteration(letter, key);
        const orientationPenalty = keyCount > 0 && alteration < 0 ? 4 : keyCount < 0 && alteration > 0 ? 4 : 0;
        const score = Math.abs(alteration - expected) * 8 + Math.abs(alteration) * 2 + orientationPenalty;
        candidates.push({ score, pitch: `${letter}${accidentalText(alteration)}${octave}` });
      }
    }
    if (!candidates.length) return midiToPitch(value, keyCount < 0);
    candidates.sort((a, b) => a.score - b.score || a.pitch.localeCompare(b.pitch));
    return candidates[0].pitch;
  }

  function transposeKey(key = 'C', semitones = 0) {
    const minor = /m$/.test(String(key));
    const targetPc = mod(keyRootPc(key) + Number(semitones), 12);
    const preferFlats = keySignatureCount(key) < 0;
    const name = (preferFlats ? PITCH_CLASSES_FLAT : PITCH_CLASSES_SHARP)[targetPc];
    return `${name}${minor ? 'm' : ''}`;
  }

  function clefBottomLineIndex(clef = 'treble') { return CLEF_BOTTOM_LINES[clef] ?? CLEF_BOTTOM_LINES.treble; }
  function staffStepForPitch(pitch, clef = 'treble') { return pitchToDiatonicIndex(pitch) - clefBottomLineIndex(clef); }
  function pitchForStaffStep(step, clef = 'treble', key = 'C') { return pitchFromDiatonicIndex(clefBottomLineIndex(clef) + Math.round(step), key); }

  function displayMidiForPart(midi, part = {}, concertPitch = true) {
    // Octave-transposing clefs affect the written staff in both concert- and
    // transposed-pitch views. Instrument transposition is hidden in concert pitch.
    const clefOctaveShift = part.clef === 'treble-8' ? 12 : 0;
    const instrumentShift = concertPitch ? 0 : Number(part.transpose || 0);
    return clamp(Number(midi) + clefOctaveShift + instrumentShift, 0, 127);
  }

  function soundingMidiFromDisplay(displayMidi, part = {}, concertPitch = true) {
    const clefOctaveShift = part.clef === 'treble-8' ? 12 : 0;
    const instrumentShift = concertPitch ? 0 : Number(part.transpose || 0);
    return clamp(Number(displayMidi) - clefOctaveShift - instrumentShift, 0, 127);
  }

  function writtenPitchForEvent(event, part = {}, key = 'C', concertPitch = true) {
    const displayMidi = displayMidiForPart(event.midi, part, concertPitch);
    if (event.writtenPitch && !concertPitch) {
      try { if (pitchToMidi(event.writtenPitch) === displayMidi) return event.writtenPitch; } catch (_) {}
    }
    if (event.pitch) {
      try { if (pitchToMidi(event.pitch) === displayMidi) return event.pitch; } catch (_) {}
    }
    return spellMidiForKey(displayMidi, key);
  }

  function degreeForPitch(pitch, key = 'C') {
    const parsed = parsePitch(pitch);
    const tonic = keyRoot(key);
    const degree = mod(LETTERS.indexOf(parsed.letter) - LETTERS.indexOf(tonic.letter), 7) + 1;
    // Do-based minor: the lowered degrees are represented by chromatic syllables (me, le, te).
    const expectedOffset = MAJOR_SCALE[degree - 1];
    const actualPc = mod(LETTER_TO_PC[parsed.letter] + parsed.accidental, 12);
    const actualOffset = mod(actualPc - tonic.pc, 12);
    let alteration = actualOffset - expectedOffset;
    if (alteration > 6) alteration -= 12;
    if (alteration < -6) alteration += 12;
    return { degree, accidental: alteration };
  }

  function degreeForMidi(midi, key = 'C') { return degreeForPitch(spellMidiForKey(midi, key), key); }

  function tonicReferenceMidi(key = 'C') {
    const tonic = keyRoot(key);
    return pitchToMidi(`${tonic.letter}${accidentalText(tonic.accidental)}4`);
  }

  // Curwen-compatible movable-do chromatic syllables. No # or b characters are emitted.
  function tonicSolfaForPitch(pitch, key = 'C', options = {}) {
    const shortBase = ['d', 'r', 'm', 'f', 's', 'l', 't'];
    const longBase = ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'];
    const raised = ['di', 'ri', 'ma', 'fi', 'si', 'li', 'ta'];
    const lowered = ['de', 'ra', 'me', 'fe', 'se', 'le', 'te'];
    const { degree, accidental } = degreeForPitch(pitch, key);
    let text;
    if (accidental > 0) text = raised[degree - 1];
    else if (accidental < 0) text = lowered[degree - 1];
    else text = (options.long ? longBase : shortBase)[degree - 1];
    // Extremely rare double alterations remain symbol-free but visibly distinct.
    if (Math.abs(accidental) > 1) text += accidental > 0 ? 'i'.repeat(Math.abs(accidental) - 1) : 'a'.repeat(Math.abs(accidental) - 1);

    const midi = pitchToMidi(pitch);
    const octave = Math.floor((midi - tonicReferenceMidi(key)) / 12);
    if (octave > 0) text += options.long ? '⁺'.repeat(Math.min(octave, 3)) : "'".repeat(Math.min(octave, 3));
    if (octave < 0) text += options.long ? '₋'.repeat(Math.min(-octave, 3)) : ','.repeat(Math.min(-octave, 3));
    return text;
  }

  function tonicSolfaForMidi(midi, key = 'C', options = {}) {
    return tonicSolfaForPitch(options.pitch || spellMidiForKey(midi, key), key, options);
  }

  function validatePitchIdentity(event, key = 'C', part = {}, concertPitch = true) {
    if (!event || event.type !== 'note') return { valid: true };
    try {
      const pitch = writtenPitchForEvent(event, part, key, concertPitch);
      const displayMidi = displayMidiForPart(event.midi, part, concertPitch);
      return {
        valid: pitchToMidi(pitch) === displayMidi,
        pitch,
        midi: Number(event.midi),
        displayMidi,
        solfa: tonicSolfaForPitch(pitch, key)
      };
    } catch (error) {
      return { valid: false, pitch: null, midi: Number(event.midi), error: error.message };
    }
  }

  function intervalSemitones(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const raw = String(value ?? '').trim();
    if (!raw) throw new Error('Enter an interval such as m3, M3, P5, P8, or a semitone number.');
    if (/^[+-]?\d+(?:\.0+)?$/.test(raw)) return Math.round(Number(raw));
    const aliases = { octave: 'P8', unison: 'P1', tritone: 'A4' };
    const token = aliases[raw.toLowerCase()] || raw;
    const match = token.match(/^([PpMmAaDd])\s*(\d+)$/);
    if (!match) throw new Error(`Unsupported interval: ${raw}`);
    const qualityRaw = match[1];
    const quality = qualityRaw === 'p' ? 'P' : qualityRaw;
    const number = Number(match[2]);
    if (!Number.isInteger(number) || number < 1 || number > 22) throw new Error(`Interval number is out of range: ${number}`);
    const simple = ((number - 1) % 7) + 1;
    const octaves = Math.floor((number - 1) / 7);
    const perfectClass = [1, 4, 5].includes(simple);
    const majorBase = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 }[simple] + octaves * 12;
    let adjustment;
    if (perfectClass) {
      if (quality === 'P') adjustment = 0;
      else if (quality === 'A') adjustment = 1;
      else if (quality === 'd') adjustment = -1;
      else throw new Error(`${quality}${number} is not a valid perfect-class interval.`);
    } else {
      if (quality === 'M') adjustment = 0;
      else if (quality === 'm') adjustment = -1;
      else if (quality === 'A') adjustment = 1;
      else if (quality === 'd') adjustment = -2;
      else throw new Error(`${quality}${number} is not a valid major-class interval.`);
    }
    return majorBase + adjustment;
  }

  function buildTriad(rootPc, quality = 'major') {
    const intervals = { major: [0, 4, 7], minor: [0, 3, 7], diminished: [0, 3, 6], augmented: [0, 4, 8] }[quality] || [0, 4, 7];
    return intervals.map(interval => mod(rootPc + interval, 12));
  }

  function diatonicTriad(degree, key = 'C', mode) {
    const scale = scaleForKey(key, mode);
    const index = mod(degree - 1, 7);
    return [scale[index], scale[(index + 2) % 7], scale[(index + 4) % 7]];
  }

  function nearestPitchClass(pc, target, min, max) {
    let best = null;
    let distance = Infinity;
    for (let midi = min; midi <= max; midi += 1) {
      if (mod(midi, 12) !== mod(pc, 12)) continue;
      const current = Math.abs(midi - target);
      if (current < distance) { best = midi; distance = current; }
    }
    return best == null ? clamp(target, min, max) : best;
  }

  function durationName(beats) {
    const map = new Map([[8, 'breve'], [6, 'dotted whole'], [4, 'whole'], [3, 'dotted half'], [2, 'half'], [1.5, 'dotted quarter'], [1, 'quarter'], [.75, 'dotted eighth'], [.5, 'eighth'], [.375, 'dotted sixteenth'], [.25, 'sixteenth'], [.125, 'thirty-second'], [.0625, 'sixty-fourth']]);
    return map.get(Number(beats)) || `${beats}-beat note`;
  }

  function durationDots(beats) { return [6, 3, 1.5, .75, .375].includes(Number(beats)) ? 1 : 0; }
  function baseDuration(beats) { return durationDots(beats) ? Number(beats) / 1.5 : Number(beats); }
  function flagCount(beats) {
    const base = baseDuration(beats);
    if (base >= 1) return 0;
    return clamp(Math.round(Math.log2(1 / base)), 1, 4);
  }

  function noteTypeFromBeats(beats) {
    const base = baseDuration(beats);
    if (base >= 8) return 'breve';
    if (base >= 4) return 'whole';
    if (base >= 2) return 'half';
    if (base >= 1) return 'quarter';
    if (base >= .5) return 'eighth';
    if (base >= .25) return '16th';
    if (base >= .125) return '32nd';
    return '64th';
  }

  function frequencyForMidi(midi) { return 440 * Math.pow(2, (Number(midi) - 69) / 12); }

  return {
    PITCH_CLASSES_SHARP, PITCH_CLASSES_FLAT, LETTERS, KEY_SIGNATURES, MAJOR_SCALE, NATURAL_MINOR_SCALE,
    SHARP_ORDER, FLAT_ORDER, clamp, mod, parsePitch, accidentalText, pitchToMidi, midiToPitch,
    keyRoot, keyRootPc, isMinorKey, keySignatureCount, keySignatureAlteration, scaleForKey,
    pitchToDiatonicIndex, diatonicIndexToNatural, pitchFromDiatonicIndex, spellMidiForKey, transposeKey,
    clefBottomLineIndex, staffStepForPitch, pitchForStaffStep, displayMidiForPart, soundingMidiFromDisplay,
    writtenPitchForEvent, degreeForPitch, degreeForMidi, tonicReferenceMidi, tonicSolfaForPitch,
    tonicSolfaForMidi, validatePitchIdentity, intervalSemitones, buildTriad, diatonicTriad, nearestPitchClass,
    durationName, durationDots, baseDuration, flagCount, noteTypeFromBeats, frequencyForMidi
  };
});
