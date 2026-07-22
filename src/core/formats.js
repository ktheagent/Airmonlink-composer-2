(function (root, factory) {
  const theory = root.AirmonMusicTheory || (typeof require === 'function' ? require('./music-theory') : null);
  const model = root.AirmonScoreModel || (typeof require === 'function' ? require('./score-model') : null);
  const api = factory(theory, model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonFormats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (theory, model) {
  'use strict';

  const DIVISIONS = 480;
  const EPSILON = 1e-8;
  function escapeXml(value) { return String(value ?? '').replace(/[<>&'\"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char])); }
  function direct(node, selector) { return Array.from(node?.children || []).find(child => child.matches(selector)) || null; }
  function directAll(node, selector) { return Array.from(node?.children || []).filter(child => child.matches(selector)); }
  function text(node, selector, fallback = '') { return direct(node, selector)?.textContent?.trim() || fallback; }
  function pitchComponents(pitch) { const parsed = theory.parsePitch(pitch); return { step: parsed.letter, alter: parsed.accidental, octave: parsed.octave }; }
  function musicXmlDuration(duration) { return Math.max(1, Math.round(Number(duration) * DIVISIONS)); }

  function clefXml(clef, number = 1) {
    if (clef === 'bass') return `<clef number="${number}"><sign>F</sign><line>4</line></clef>`;
    if (clef === 'alto') return `<clef number="${number}"><sign>C</sign><line>3</line></clef>`;
    if (clef === 'tenor') return `<clef number="${number}"><sign>C</sign><line>4</line></clef>`;
    if (clef === 'percussion') return `<clef number="${number}"><sign>percussion</sign><line>2</line></clef>`;
    if (clef === 'treble-8') return `<clef number="${number}"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>`;
    return `<clef number="${number}"><sign>G</sign><line>2</line></clef>`;
  }
  function partClefsXml(part) {
    if (Array.isArray(part.staffDefinitions) && part.staffDefinitions.length > 1) {
      return `<staves>${part.staffDefinitions.length}</staves>${part.staffDefinitions.map((staff, index) => clefXml(staff.clef || 'treble', Number(staff.number) || index + 1)).join('')}`;
    }
    return part.clef === 'grand' ? `<staves>2</staves>${clefXml('treble', 1)}${clefXml('bass', 2)}` : clefXml(part.clef || 'treble', 1);
  }
  function eventStaffNumber(part, event) {
    if (Array.isArray(part.staffDefinitions) && part.staffDefinitions.length > 1) {
      const found = part.staffDefinitions.find(staff => staff.id === event.staff || staff.name === event.staff);
      return Math.max(1, Number(found?.number) || Number(String(event.staff || '').replace(/\D/g, '')) || 1);
    }
    return part.clef === 'grand' ? (event.staff === 'bass' ? 2 : 1) : 1;
  }
  function keyFifths(key) { return theory.keySignatureCount(key); }
  function typeXml(duration) { return `<type>${theory.noteTypeFromBeats(duration)}</type>${theory.durationDots(duration) ? '<dot/>' : ''}`; }

  function lyricsXml(event) {
    const lyrics = Array.isArray(event.lyrics) && event.lyrics.length ? event.lyrics : (event.lyric ? [{ verse: event.lyricVerse || 1, text: event.lyric, syllabic: event.syllabic, melisma: event.melisma }] : []);
    return lyrics.map(item => {
      const syllabic = item.syllabic ? `<syllabic>${escapeXml(item.syllabic)}</syllabic>` : '';
      const extend = item.melisma ? `<extend${item.extendType ? ` type="${escapeXml(item.extendType)}"` : ''}/>` : '';
      const name = item.lineType && item.lineType !== 'verse' ? ` name="${escapeXml(item.lineType)}"` : '';
      const placement = item.placement ? ` placement="${item.placement === 'above' ? 'above' : 'below'}"` : '';
      const language = item.language ? ` xml:lang="${escapeXml(item.language)}"` : '';
      const geometry = `${Number(item.offsetX) ? ` default-x="${Number(item.offsetX).toFixed(2)}"` : ''}${Number(item.offsetY) ? ` default-y="${Number(item.offsetY).toFixed(2)}"` : ''}`;
      const style = `${item.fontFamily ? ` font-family="${escapeXml(item.fontFamily)}"` : ''}${item.fontSize ? ` font-size="${escapeXml(item.fontSize)}"` : ''}${item.fontStyle ? ` font-style="${escapeXml(item.fontStyle)}"` : ''}${item.justify ? ` justify="${escapeXml(item.justify)}"` : ''}${item.valign ? ` valign="${escapeXml(item.valign)}"` : ''}`;
      const elision = item.elision ? '<elision>‿</elision>' : '';
      return `<lyric number="${Math.max(1, Number(item.verse) || 1)}"${name}${placement}${language}${geometry}${style}>${syllabic}<text>${escapeXml(item.text || '')}</text>${elision}${extend}</lyric>`;
    }).join('');
  }

  function spannerFlags(score, eventId) {
    const flags = { tieStart: false, tieStop: false, slurStarts: [], slurStops: [] };
    for (const spanner of score.spanners || []) {
      if (spanner.startEventId === eventId) {
        if (spanner.type === 'tie') flags.tieStart = true;
        else flags.slurStarts.push(spanner);
      }
      if (spanner.endEventId === eventId) {
        if (spanner.type === 'tie') flags.tieStop = true;
        else flags.slurStops.push(spanner);
      }
    }
    return flags;
  }

  function noteXml(event, part, score, measureIndex, chord = false) {
    const duration = musicXmlDuration(event.duration);
    const voice = Math.max(1, Number(event.voice) || 1);
    const staff = eventStaffNumber(part, event);
    const staffXml = (part.clef === 'grand' || (part.staffDefinitions?.length || 0) > 1) ? `<staff>${staff}</staff>` : '';
    const grace = event.grace ? '<grace/>' : '';
    const durationXml = event.grace ? '' : `<duration>${duration}</duration>`;
    const common = `${chord ? '<chord/>' : ''}${grace}${durationXml}<voice>${voice}</voice>${typeXml(event.duration)}${staffXml}`;
    if (event.type === 'rest') return `<note><rest/>${common}</note>`;
    const key = model.effectiveKey(score, measureIndex);
    const written = theory.writtenPitchForEvent(event, part, key, score.settings.concertPitch !== false);
    const pitch = pitchComponents(written);
    const alter = pitch.alter ? `<alter>${pitch.alter}</alter>` : '';
    const spanners = spannerFlags(score, event.id);
    const hasTieStart = Boolean(event.tieStart || spanners.tieStart);
    const hasTieStop = Boolean(event.tieStop || spanners.tieStop);
    const tieStart = hasTieStart ? '<tie type="start"/>' : '';
    const tieStop = hasTieStop ? '<tie type="stop"/>' : '';
    const notations = [];
    if (hasTieStop) notations.push('<tied type="stop"/>');
    if (hasTieStart) notations.push('<tied type="start"/>');
    spanners.slurStops.forEach((item, index) => notations.push(`<slur type="stop" number="${index + 1}" placement="${item.direction === 'below' ? 'below' : 'above'}"/>`));
    spanners.slurStarts.forEach((item, index) => notations.push(`<slur type="start" number="${index + 1}" placement="${item.direction === 'below' ? 'below' : 'above'}"/>`));
    if (!spanners.slurStops.length && event.slurStop) notations.push(`<slur type="stop" number="${Number(event.slurNumber) || 1}"/>`);
    if (!spanners.slurStarts.length && event.slurStart) notations.push(`<slur type="start" number="${Number(event.slurNumber) || 1}"/>`);
    if (event.tuplet?.stop) notations.push(`<tuplet type="stop" number="${Number(event.tuplet.number) || 1}"/>`);
    if (event.tuplet?.start) notations.push(`<tuplet type="start" number="${Number(event.tuplet.number) || 1}"/>`);
    if (Array.isArray(event.articulations) && event.articulations.length) notations.push(`<articulations>${event.articulations.map(name => `<${escapeXml(name)}/>`).join('')}</articulations>`);
    const notationXml = notations.length ? `<notations>${notations.join('')}</notations>` : '';
    const timeModification = event.tuplet?.actual && event.tuplet?.normal ? `<time-modification><actual-notes>${Number(event.tuplet.actual)}</actual-notes><normal-notes>${Number(event.tuplet.normal)}</normal-notes></time-modification>` : '';
    return `<note>${chord ? '<chord/>' : ''}${grace}<pitch><step>${pitch.step}</step>${alter}<octave>${pitch.octave}</octave></pitch>${durationXml}${tieStop}${tieStart}<voice>${voice}</voice>${typeXml(event.duration)}${timeModification}${staffXml}${notationXml}${lyricsXml(event)}</note>`;
  }

  function measureEventsXml(score, part, measureIndex) {
    const bounds = model.measureBounds(score, measureIndex);
    const events = part.events.filter(event => event.start < bounds.end - EPSILON && event.start + event.duration > bounds.start + EPSILON);
    const groups = new Map();
    events.forEach(event => {
      const staff = eventStaffNumber(part, event);
      const voice = Math.max(1, Number(event.voice) || 1);
      const key = `${staff}:${voice}`;
      if (!groups.has(key)) groups.set(key, { staff, voice, events: [] });
      groups.get(key).events.push(event);
    });
    const sequences = Array.from(groups.values()).sort((a, b) => a.staff - b.staff || a.voice - b.voice);
    if (!sequences.length) sequences.push({ staff: 1, voice: 1, events: [{ id: 'implicit-measure-rest', type: 'rest', start: bounds.start, duration: bounds.capacity, voice: 1, staff: part.clef === 'grand' ? 'treble' : null }] });
    const chunks = [];
    sequences.forEach((sequence, sequenceIndex) => {
      if (sequenceIndex > 0) chunks.push(`<backup><duration>${musicXmlDuration(bounds.capacity)}</duration></backup>`);
      let cursor = bounds.start;
      let previousStart = null;
      let previousDuration = null;
      sequence.events.sort((a, b) => a.start - b.start || (a.type === 'note' ? 0 : 1) - (b.type === 'note' ? 0 : 1) || a.midi - b.midi);
      sequence.events.forEach(event => {
        const clippedStart = Math.max(bounds.start, event.start);
        const isChord = event.type === 'note' && previousStart != null && Math.abs(clippedStart - previousStart) < EPSILON && Math.abs(event.duration - previousDuration) < EPSILON;
        if (!isChord && clippedStart > cursor + EPSILON) chunks.push(`<forward><duration>${musicXmlDuration(clippedStart - cursor)}</duration></forward>`);
        chunks.push(noteXml(event, part, score, measureIndex, isChord));
        if (!isChord) { cursor = clippedStart + event.duration; previousStart = clippedStart; previousDuration = event.duration; }
      });
      if (cursor < bounds.end - EPSILON) chunks.push(`<forward><duration>${musicXmlDuration(bounds.end - cursor)}</duration></forward>`);
    });
    return chunks.join('');
  }

  function barlineXml(measure, location) {
    const content = [];
    if (location === 'left') {
      if (measure.endings?.length) content.push(`<ending number="${measure.endings.join(',')}" type="start"/>`);
      if (measure.repeatStart) content.push('<repeat direction="forward"/>');
    } else {
      if (measure.endings?.length && measure.repeatEnd) content.push(`<ending number="${measure.endings.join(',')}" type="stop"/>`);
      if (measure.repeatEnd) content.push(`<repeat direction="backward" times="${measure.repeatTimes || 2}"/>`);
    }
    return content.length ? `<barline location="${location}">${content.join('')}</barline>` : '';
  }

  function partListXml(score) {
    const chunks = [];
    let activeGroup = null;
    let activeGroupNumber = null;
    let nextGroupNumber = 1;
    score.parts.forEach((part, index) => {
      const group = part.bracketGroup || null;
      if (activeGroup && activeGroup !== group) { chunks.push(`<part-group type="stop" number="${activeGroupNumber}"/>`); activeGroup = null; activeGroupNumber = null; }
      if (group && activeGroup !== group) {
        activeGroup = group;
        activeGroupNumber = nextGroupNumber++;
        const symbol = part.groupSymbol || (part.braceGroup || model.isMultiStaff(part) ? 'brace' : 'bracket');
        chunks.push(`<part-group type="start" number="${activeGroupNumber}"><group-name>${escapeXml(String(group))}</group-name><group-symbol>${symbol}</group-symbol><group-barline>yes</group-barline></part-group>`);
      }
      chunks.push(`<score-part id="P${index + 1}"><part-name>${escapeXml(part.name)}</part-name><part-abbreviation>${escapeXml(part.shortName || '')}</part-abbreviation><midi-instrument id="P${index + 1}-I1"><midi-channel>${(index % 16) + 1}</midi-channel><midi-program>${(part.midiProgram || 0) + 1}</midi-program></midi-instrument></score-part>`);
    });
    if (activeGroup) chunks.push(`<part-group type="stop" number="${activeGroupNumber}"/>`);
    return chunks.join('');
  }


  const PAGE_SIZES_MM = Object.freeze({ A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6], A3: [297, 420] });

  function pageLayoutDefaultsXml(score) {
    const settings = score.settings || {};
    const scalingMillimeters = 7.05556;
    const scalingTenths = 40;
    const tenthsPerMm = scalingTenths / scalingMillimeters;
    const base = PAGE_SIZES_MM[settings.pageSize] || PAGE_SIZES_MM.A4;
    const landscape = settings.orientation === 'landscape';
    const widthMm = landscape ? base[1] : base[0];
    const heightMm = landscape ? base[0] : base[1];
    const marginMm = Math.max(0, Number(settings.margins) || 15);
    const toTenths = value => (Number(value) * tenthsPerMm).toFixed(2);
    const staffDistanceMm = Math.max(6, (Number(settings.staffGap) || 60) / 3.78);
    const systemDistanceMm = Math.max(8, (Number(settings.systemGap) || 50) / 3.78);
    return `<defaults><scaling><millimeters>${scalingMillimeters}</millimeters><tenths>${scalingTenths}</tenths></scaling><page-layout><page-height>${toTenths(heightMm)}</page-height><page-width>${toTenths(widthMm)}</page-width><page-margins type="both"><left-margin>${toTenths(marginMm)}</left-margin><right-margin>${toTenths(marginMm)}</right-margin><top-margin>${toTenths(marginMm)}</top-margin><bottom-margin>${toTenths(marginMm)}</bottom-margin></page-margins></page-layout><system-layout><system-distance>${toTenths(systemDistanceMm)}</system-distance><top-system-distance>${toTenths(Math.max(marginMm, 12))}</top-system-distance></system-layout><staff-layout><staff-distance>${toTenths(staffDistanceMm)}</staff-distance></staff-layout></defaults>`;
  }

  function nearestPageSize(widthMm, heightMm) {
    const portraitWidth = Math.min(widthMm, heightMm);
    const portraitHeight = Math.max(widthMm, heightMm);
    let best = 'A4';
    let distance = Infinity;
    for (const [name, dimensions] of Object.entries(PAGE_SIZES_MM)) {
      const current = Math.hypot(portraitWidth - dimensions[0], portraitHeight - dimensions[1]);
      if (current < distance) { best = name; distance = current; }
    }
    return best;
  }

  function parsePageLayoutDefaults(doc) {
    const defaults = direct(doc.documentElement, 'defaults') || doc.querySelector('defaults');
    if (!defaults) return null;
    const scaling = direct(defaults, 'scaling');
    const millimeters = Number(text(scaling, 'millimeters', '7.05556')) || 7.05556;
    const tenths = Number(text(scaling, 'tenths', '40')) || 40;
    const mmPerTenth = millimeters / tenths;
    const pageLayout = direct(defaults, 'page-layout');
    const widthTenths = Number(text(pageLayout, 'page-width', '0')) || 0;
    const heightTenths = Number(text(pageLayout, 'page-height', '0')) || 0;
    const widthMm = widthTenths * mmPerTenth;
    const heightMm = heightTenths * mmPerTenth;
    const marginNode = direct(pageLayout, 'page-margins');
    const marginsMm = ['left-margin', 'right-margin', 'top-margin', 'bottom-margin']
      .map(name => Number(text(marginNode, name, '0')) * mmPerTenth)
      .filter(value => Number.isFinite(value) && value > 0);
    const systemLayout = direct(defaults, 'system-layout');
    const staffLayout = direct(defaults, 'staff-layout');
    const systemDistanceMm = Number(text(systemLayout, 'system-distance', '0')) * mmPerTenth;
    const staffDistanceMm = Number(text(staffLayout, 'staff-distance', '0')) * mmPerTenth;
    return {
      pageSize: widthMm && heightMm ? nearestPageSize(widthMm, heightMm) : null,
      orientation: widthMm > heightMm ? 'landscape' : 'portrait',
      margins: marginsMm.length ? marginsMm.reduce((sum, value) => sum + value, 0) / marginsMm.length : null,
      systemGap: systemDistanceMm > 0 ? theory.clamp(systemDistanceMm * 3.78, 32, 180) : null,
      staffGap: staffDistanceMm > 0 ? theory.clamp(staffDistanceMm * 3.78, 44, 140) : null,
      source: { widthMm, heightMm, millimeters, tenths, marginValuesMm: marginsMm, systemDistanceMm, staffDistanceMm }
    };
  }

  function exportMusicXML(score) {
    model.ensureMeasures(score);
    const partList = partListXml(score);
    const parts = score.parts.map((part, partIndex) => {
      const measures = score.measures.map((measure, measureIndex) => {
        const signature = model.effectiveTimeSignature(score, measureIndex);
        const key = model.effectiveKey(score, measureIndex);
        const previousSignature = measureIndex ? model.effectiveTimeSignature(score, measureIndex - 1) : null;
        const previousKey = measureIndex ? model.effectiveKey(score, measureIndex - 1) : null;
        const attributesNeeded = measureIndex === 0 || signature !== previousSignature || key !== previousKey || measure.timeSignature || measure.key;
        let attributes = '';
        if (attributesNeeded) {
          const [beats, beatType] = signature.split('/');
          attributes = `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${keyFifths(key)}</fifths><mode>${/m$/.test(key) ? 'minor' : 'major'}</mode></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>${measureIndex === 0 && Number(part.transpose) ? `<transpose><chromatic>${-Number(part.transpose)}</chromatic></transpose>` : ''}${measureIndex === 0 ? partClefsXml(part) : ''}</attributes>`;
        }
        const print = measure.newPage ? '<print new-page="yes"/>' : measure.newSystem ? '<print new-system="yes"/>' : '';
        const direction = measureIndex === 0 ? `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.settings.tempo}</per-minute></metronome></direction-type><sound tempo="${score.settings.tempo}"/></direction>` : '';
        const rehearsal = measure.rehearsalMark && !(score.annotations || []).some(item => item.type === 'rehearsal' && item.measureIndex === measureIndex) ? `<direction placement="above"><direction-type><rehearsal>${escapeXml(measure.rehearsalMark)}</rehearsal></direction-type></direction>` : '';
        const implicit = measureIndex === 0 && Number(score.settings.pickupBeats) > 0 ? ' implicit="yes"' : '';
        return `<measure number="${escapeXml(measure.displayNumber || measure.number || measureIndex + 1)}"${implicit}>${print}${attributes}${direction}${rehearsal}${annotationsXml(score, part, measureIndex)}${chordSymbolXml(score, part, measureIndex)}${barlineXml(measure, 'left')}${measureEventsXml(score, part, measureIndex)}${barlineXml(measure, 'right')}</measure>`;
      }).join('');
      return `<part id="P${partIndex + 1}">${measures}</part>`;
    }).join('');
    const metadata = score.metadata || {};
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise version="4.0"><work><work-title>${escapeXml(metadata.title || 'Untitled Score')}</work-title></work><movement-number>${escapeXml(metadata.movementNumber || '')}</movement-number><movement-title>${escapeXml(metadata.movementTitle || metadata.subtitle || '')}</movement-title>${identificationXml(score)}${pageLayoutDefaultsXml(score)}${scoreCreditsXml(score)}<part-list>${partList}</part-list>${parts}</score-partwise>`;
  }

  function parseClef(node) {
    const sign = text(node, 'sign', 'G');
    const line = Number(text(node, 'line', '2'));
    const octaveChange = Number(text(node, 'clef-octave-change', '0'));
    if (sign === 'F') return 'bass';
    if (sign === 'C') return line === 4 ? 'tenor' : 'alto';
    if (sign === 'percussion') return 'percussion';
    if (sign === 'G' && octaveChange === -1) return 'treble-8';
    return 'treble';
  }
  function keyNameFromFifths(fifths, mode = 'major') {
    const candidates = Object.entries(theory.KEY_SIGNATURES).filter(([name, count]) => count === Number(fifths));
    const minor = String(mode).toLowerCase() === 'minor';
    return candidates.find(([name]) => /m$/.test(name) === minor)?.[0] || candidates[0]?.[0] || 'C';
  }
  function durationFromType(note, divisions) {
    const type = text(note, 'type', 'quarter');
    const base = { breve: 8, whole: 4, half: 2, quarter: 1, eighth: .5, '16th': .25, '32nd': .125, '64th': .0625 }[type] || 1;
    const dots = directAll(note, 'dot').length;
    let value = base; if (dots >= 1) value *= 1.5; if (dots >= 2) value += base * .25;
    const durationNode = direct(note, 'duration');
    return durationNode ? Number(durationNode.textContent || divisions) / divisions : value;
  }


  function xmlAttribute(node, name, fallback = '') {
    const value = node?.getAttribute?.(name);
    return value == null || value === '' ? fallback : value;
  }

  function creatorValue(doc, type) {
    return Array.from(doc.querySelectorAll('identification > creator')).find(node => String(node.getAttribute('type') || '').toLowerCase() === type)?.textContent?.trim() || '';
  }

  function lyricFromXml(lyric) {
    const segments = [];
    Array.from(lyric?.children || []).forEach(child => {
      if (child.localName === 'text') segments.push(child.textContent || '');
      if (child.localName === 'elision') segments.push(child.textContent || '‿');
    });
    const extendNode = direct(lyric, 'extend');
    const placement = xmlAttribute(lyric, 'placement', 'below');
    return {
      id: model.uid('lyric'), verse: Math.max(1, Number(lyric.getAttribute('number')) || 1),
      lineType: lyric.getAttribute('name') || 'verse', text: segments.join('') || text(lyric, 'text', ''),
      syllabic: text(lyric, 'syllabic', '') || null, melisma: Boolean(extendNode), extendType: extendNode?.getAttribute('type') || (extendNode ? 'start' : null),
      elision: directAll(lyric, 'elision').length > 0, offsetX: Number(lyric.getAttribute('default-x')) || 0,
      offsetY: Number(lyric.getAttribute('default-y')) || 0, placement,
      language: lyric.getAttribute('xml:lang') || lyric.getAttributeNS?.('http://www.w3.org/XML/1998/namespace', 'lang') || '',
      fontFamily: lyric.getAttribute('font-family') || '', fontSize: lyric.getAttribute('font-size') || '', fontStyle: lyric.getAttribute('font-style') || '',
      justify: lyric.getAttribute('justify') || '', valign: lyric.getAttribute('valign') || ''
    };
  }

  function annotationStyleAttributes(item = {}) {
    const source = item.sourceData || {};
    const attributes = [];
    const values = {
      'default-x': Number(item.offsetX) || Number(source.defaultX) || 0,
      'default-y': Number(item.offsetY) || Number(source.defaultY) || 0,
      'font-family': source.fontFamily || '', 'font-size': source.fontSize || '', 'font-style': source.fontStyle || '',
      'font-weight': source.fontWeight || '', justify: source.justify || '', valign: source.valign || ''
    };
    Object.entries(values).forEach(([name, value]) => { if (value !== '' && value !== 0) attributes.push(`${name}="${escapeXml(value)}"`); });
    return attributes.length ? ` ${attributes.join(' ')}` : '';
  }

  function annotationDirectionTypeXml(item) {
    const type = String(item.type || 'staff-text');
    const source = item.sourceData || {};
    const styledText = `<words${annotationStyleAttributes(item)}>${escapeXml(item.text || '')}</words>`;
    if (type === 'rehearsal') return `<rehearsal${annotationStyleAttributes(item)}>${escapeXml(item.text || '')}</rehearsal>`;
    if (type === 'dynamics') {
      const value = String(item.text || source.value || 'mf').replace(/[^a-z]/gi, '').toLowerCase();
      return `<dynamics>${value ? `<${escapeXml(value)}/>` : '<other-dynamics>mf</other-dynamics>'}</dynamics>`;
    }
    if (type === 'wedge' || type === 'hairpin') return `<wedge type="${escapeXml(source.wedgeType || 'crescendo')}"${source.number ? ` number="${escapeXml(source.number)}"` : ''}/>`;
    if (type === 'pedal') return `<pedal type="${escapeXml(source.pedalType || 'start')}"/>`;
    if (type === 'octave-shift') return `<octave-shift type="${escapeXml(source.shiftType || 'up')}" size="${Math.max(8, Number(source.size) || 8)}"/>`;
    if (type === 'segno') return '<segno/>';
    if (type === 'coda') return '<coda/>';
    if (type === 'tempo-text' && source.perMinute) return `${styledText}<metronome><beat-unit>${escapeXml(source.beatUnit || 'quarter')}</beat-unit><per-minute>${escapeXml(source.perMinute)}</per-minute></metronome>`;
    return styledText;
  }

  function annotationsXml(score, part, measureIndex) {
    const bounds = model.measureBounds(score, measureIndex);
    return (score.annotations || []).filter(item => {
      const start = Number(item.start) || 0;
      const inMeasure = item.measureIndex === measureIndex || (start >= bounds.start - EPSILON && start < bounds.end - EPSILON);
      const forPart = !item.partId || item.partId === part.id;
      return inMeasure && forPart && !['page', 'header', 'footer', 'title', 'composer', 'composition-date'].includes(item.type);
    }).sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0)).map(item => {
      const offset = Math.max(0, (Number(item.start) || bounds.start) - bounds.start);
      const staff = item.staff == null ? '' : `<staff>${eventStaffNumber(part, { staff: item.staff })}</staff>`;
      const voice = item.sourceData?.voice ? `<voice>${Math.max(1, Number(item.sourceData.voice) || 1)}</voice>` : '';
      const sound = item.sourceData?.tempo ? `<sound tempo="${Number(item.sourceData.tempo)}"/>` : '';
      return `<direction placement="${item.placement === 'below' ? 'below' : 'above'}"><direction-type>${annotationDirectionTypeXml(item)}</direction-type>${offset > EPSILON ? `<offset>${musicXmlDuration(offset)}</offset>` : ''}${voice}${staff}${sound}</direction>`;
    }).join('');
  }

  function chordKindForText(value) {
    const textValue = String(value || '').toLowerCase();
    if (/maj7|major[- ]?seventh/.test(textValue)) return 'major-seventh';
    if (/m7|minor[- ]?seventh/.test(textValue)) return 'minor-seventh';
    if (/dim/.test(textValue)) return 'diminished';
    if (/aug|\+/.test(textValue)) return 'augmented';
    if (/sus2/.test(textValue)) return 'suspended-second';
    if (/sus4|sus/.test(textValue)) return 'suspended-fourth';
    if (/minor|(^|[^a-z])m($|[^a-z])/.test(textValue)) return 'minor';
    if (/7/.test(textValue)) return 'dominant';
    return 'major';
  }

  function chordSymbolXml(score, part, measureIndex) {
    const bounds = model.measureBounds(score, measureIndex);
    return (score.chordSymbols || []).filter(item => {
      const start = Number(item.start) || 0;
      return start >= bounds.start - EPSILON && start < bounds.end - EPSILON && (!item.partId || item.partId === part.id);
    }).sort((a, b) => Number(a.start) - Number(b.start)).map(item => {
      const label = String(item.symbol || item.name || item.text || item.roman || 'C');
      const match = label.match(/^([A-Ga-g])([#b]*)(.*)$/);
      const rootStep = String(item.rootStep || match?.[1] || 'C').toUpperCase();
      const accidental = item.rootAlter != null ? Number(item.rootAlter) : (match?.[2] || '').split('').reduce((sum, char) => sum + (char === '#' ? 1 : -1), 0);
      const rootAlter = accidental ? `<root-alter>${accidental}</root-alter>` : '';
      const kind = item.kind || chordKindForText(match?.[3] || label);
      const offset = Math.max(0, (Number(item.start) || bounds.start) - bounds.start);
      const staff = item.staff == null ? '' : `<staff>${eventStaffNumber(part, { staff: item.staff })}</staff>`;
      return `<harmony placement="${item.placement === 'below' ? 'below' : 'above'}"><root><root-step>${rootStep}</root-step>${rootAlter}</root><kind text="${escapeXml(label)}">${escapeXml(kind)}</kind>${offset > EPSILON ? `<offset>${musicXmlDuration(offset)}</offset>` : ''}${staff}</harmony>`;
    }).join('');
  }

  function scoreCreditsXml(score) {
    const metadata = score.metadata || {};
    const credits = [];
    const style = (field, defaults = {}) => {
      const item = score.publicationTextLayout?.[`staff:${field}`] || {};
      const attributes = { justify: item.alignment || defaults.justify, valign: 'top', 'font-family': item.fontFamily || null, 'font-size': item.fontSize || defaults.fontSize, 'font-style': item.fontStyle, 'font-weight': item.fontWeight, 'relative-x': item.offsetX ? (Number(item.offsetX) * 1.5).toFixed(2) : null, 'relative-y': item.offsetY ? (-Number(item.offsetY) * 1.5).toFixed(2) : null };
      return Object.entries(attributes).filter(([, value]) => value != null && value !== '').map(([name, value]) => ` ${name}="${escapeXml(value)}"`).join('');
    };
    const add = (type, field, value, defaults) => { if (value) credits.push(`<credit page="1"><credit-type>${type}</credit-type><credit-words${style(field, defaults)}>${escapeXml(value)}</credit-words></credit>`); };
    add('title', 'title', metadata.title, { justify: 'center', fontSize: 22 });
    add('subtitle', 'subtitle', metadata.subtitle, { justify: 'center', fontSize: 13 });
    add('composer', 'composer', metadata.composer, { justify: 'right' });
    add('composition-date', 'compositionDate', metadata.compositionDate || metadata.dateText, { justify: 'right', fontSize: 9 });
    add('dedication', 'dedication', metadata.dedication, { justify: 'center' });
    add('arranger', 'arranger', metadata.arranger, { justify: 'right', fontSize: 9 });
    add('lyricist', 'lyricist', metadata.lyricist, { justify: 'right', fontSize: 9 });
    add('source', 'source', metadata.source, { justify: 'left', fontSize: 8 });
    add('supporting-text', 'supportingText', metadata.supportingText, { justify: 'center', fontSize: 8 });
    add('copyright', 'copyright', metadata.copyright, { justify: 'center', fontSize: 8 });
    for (const item of score.annotations || []) {
      if (!['page', 'header', 'footer'].includes(item.scope) && !['page-text', 'header-text', 'footer-text'].includes(item.type)) continue;
      credits.push(`<credit page="${Math.max(1, Number(item.sourceData?.page) || (Number(item.pageIndex) || 0) + 1)}"><credit-type>${escapeXml(item.type)}</credit-type><credit-words${annotationStyleAttributes(item)}>${escapeXml(item.text)}</credit-words></credit>`);
    }
    return credits.join('');
  }

  function identificationXml(score) {
    const metadata = score.metadata || {};
    const fields = [];
    if (metadata.composer) fields.push(`<creator type="composer">${escapeXml(metadata.composer)}</creator>`);
    if (metadata.arranger) fields.push(`<creator type="arranger">${escapeXml(metadata.arranger)}</creator>`);
    if (metadata.lyricist) fields.push(`<creator type="lyricist">${escapeXml(metadata.lyricist)}</creator>`);
    if (metadata.copyright) fields.push(`<rights>${escapeXml(metadata.copyright)}</rights>`);
    if (metadata.source) fields.push(`<source>${escapeXml(metadata.source)}</source>`);
    const misc = [];
    if (metadata.compositionDate || metadata.dateText) misc.push(`<miscellaneous-field name="composition-date">${escapeXml(metadata.compositionDate || metadata.dateText)}</miscellaneous-field>`);
    if (metadata.dedication) misc.push(`<miscellaneous-field name="dedication">${escapeXml(metadata.dedication)}</miscellaneous-field>`);
    if (metadata.supportingText) misc.push(`<miscellaneous-field name="supporting-text">${escapeXml(metadata.supportingText)}</miscellaneous-field>`);
    if (metadata.description) misc.push(`<miscellaneous-field name="description">${escapeXml(metadata.description)}</miscellaneous-field>`);
    return `<identification>${fields.join('')}<encoding><software>Airmonlink Composer</software><encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date></encoding>${misc.length ? `<miscellaneous>${misc.join('')}</miscellaneous>` : ''}</identification>`;
  }

  function musicXmlCreditMetadata(doc) {
    const credits = Array.from(doc.querySelectorAll(':scope > credit, score-partwise > credit')).map(credit => ({
      page: Math.max(1, Number(credit.getAttribute('page')) || 1), type: text(credit, 'credit-type', 'page-text'),
      words: Array.from(credit.querySelectorAll('credit-words')).map(node => node.textContent || '').join('\n').trim(),
      node: credit.querySelector('credit-words')
    })).filter(item => item.words);
    const findCredit = type => credits.find(item => String(item.type).toLowerCase() === type)?.words || '';
    const fieldByType = { title: 'title', subtitle: 'subtitle', composer: 'composer', 'composition-date': 'compositionDate', dedication: 'dedication', arranger: 'arranger', lyricist: 'lyricist', source: 'source', 'supporting-text': 'supportingText', copyright: 'copyright' };
    const publicationTextLayout = {};
    credits.forEach(item => {
      const field = fieldByType[String(item.type).toLowerCase()]; if (!field || !item.node) return;
      const number = name => { const value = Number(item.node.getAttribute(name)); return Number.isFinite(value) ? value : null; };
      publicationTextLayout[`staff:${field}`] = {
        offsetX: (number('relative-x') || 0) / 1.5,
        offsetY: -(number('relative-y') || 0) / 1.5,
        alignment: item.node.getAttribute('justify') || null,
        fontFamily: item.node.getAttribute('font-family') || '',
        fontSize: number('font-size'),
        fontStyle: item.node.getAttribute('font-style') || null,
        fontWeight: item.node.getAttribute('font-weight') || null,
        visible: true
      };
    });
    return { credits, publicationTextLayout, title: findCredit('title'), subtitle: findCredit('subtitle'), composer: findCredit('composer'), compositionDate: findCredit('composition-date'), dedication: findCredit('dedication'), arranger: findCredit('arranger'), lyricist: findCredit('lyricist'), source: findCredit('source'), supportingText: findCredit('supporting-text'), copyright: findCredit('copyright') };
  }

  function parseMusicXML(xmlText) {
    if (typeof DOMParser === 'undefined') throw new Error('MusicXML import requires a browser context.');
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('The MusicXML file is malformed.');
    const root = doc.documentElement;
    if (!root || !['score-partwise', 'score-timewise'].includes(root.localName)) throw new Error('Only MusicXML score-partwise/timewise documents are supported.');
    if (root.localName === 'score-timewise') throw new Error('Timewise MusicXML must be converted to score-partwise before import.');

    const creditMetadata = musicXmlCreditMetadata(doc);
    const workTitle = doc.querySelector('work > work-title')?.textContent?.trim() || '';
    const movementTitle = doc.querySelector('movement-title')?.textContent?.trim() || '';
    const title = workTitle || movementTitle || creditMetadata.title || 'Imported Score';
    const subtitle = movementTitle && movementTitle !== title ? movementTitle : creditMetadata.subtitle || '';
    const composer = creatorValue(doc, 'composer') || creditMetadata.composer;
    const arranger = creatorValue(doc, 'arranger') || creditMetadata.arranger;
    const lyricist = creatorValue(doc, 'lyricist') || creatorValue(doc, 'poet') || creditMetadata.lyricist;
    const rights = doc.querySelector('identification > rights')?.textContent?.trim() || creditMetadata.copyright || '';
    const source = doc.querySelector('identification > source')?.textContent?.trim() || creditMetadata.source || '';
    const miscellaneous = new Map(Array.from(doc.querySelectorAll('identification miscellaneous-field')).map(node => [String(node.getAttribute('name') || '').toLowerCase(), node.textContent?.trim() || '']));
    const compositionDate = miscellaneous.get('composition-date') || miscellaneous.get('date') || creditMetadata.compositionDate || '';
    const dedication = miscellaneous.get('dedication') || creditMetadata.dedication || '';
    const supportingText = miscellaneous.get('supporting-text') || creditMetadata.supportingText || '';
    const tempo = Number(doc.querySelector('sound[tempo]')?.getAttribute('tempo')) || Number(doc.querySelector('per-minute')?.textContent) || 96;
    const partNodes = directAll(root, 'part');
    if (!partNodes.length) throw new Error('The MusicXML file has no parts.');
    const measureCount = Math.max(1, ...partNodes.map(part => directAll(part, 'measure').length));
    const firstMeasure = direct(partNodes[0], 'measure');
    const firstAttributes = direct(firstMeasure, 'attributes');
    const firstTime = direct(firstAttributes, 'time');
    const firstKey = direct(firstAttributes, 'key');
    const initialSignature = firstTime ? `${text(firstTime, 'beats', '4')}/${text(firstTime, 'beat-type', '4')}` : '4/4';
    const initialKey = firstKey ? keyNameFromFifths(Number(text(firstKey, 'fifths', '0')), text(firstKey, 'mode', 'major')) : 'C';

    const actualMeasureDuration = measure => {
      let divisions = Number(text(direct(measure, 'attributes'), 'divisions', '1')) || 1;
      let cursor = 0;
      let maximum = 0;
      Array.from(measure?.children || []).forEach(node => {
        if (node.localName === 'attributes') divisions = Number(text(node, 'divisions', String(divisions))) || divisions;
        else if (node.localName === 'backup') cursor = Math.max(0, cursor - Number(text(node, 'duration', '0')) / divisions);
        else if (node.localName === 'forward') { cursor += Number(text(node, 'duration', '0')) / divisions; maximum = Math.max(maximum, cursor); }
        else if (node.localName === 'note' && !direct(node, 'chord') && !direct(node, 'grace')) { cursor += durationFromType(node, divisions); maximum = Math.max(maximum, cursor); }
      });
      return maximum;
    };
    const nominalFirstCapacity = model.timeSignatureInfo(initialSignature).measureQuarterBeats;
    const implicitFirst = firstMeasure?.getAttribute('implicit') === 'yes';
    const measuredFirstCapacity = actualMeasureDuration(firstMeasure);
    const pickupBeats = implicitFirst && measuredFirstCapacity > EPSILON && measuredFirstCapacity < nominalFirstCapacity - EPSILON ? measuredFirstCapacity : 0;
    const importedPageLayout = parsePageLayoutDefaults(doc);

    const score = model.createScore({
      title, subtitle, composer, arranger, lyricist, copyright: rights, source, compositionDate, dedication, supportingText, movementTitle,
      key: initialKey, timeSignature: initialSignature, tempo, pickupBeats, measures: measureCount, template: 'lead',
      pageSize: importedPageLayout?.pageSize || 'A4', orientation: importedPageLayout?.orientation || 'portrait',
      margins: importedPageLayout?.margins || 15, systemGap: importedPageLayout?.systemGap || 50, staffGap: importedPageLayout?.staffGap || 60
    });
    if (importedPageLayout) score.settings.pageLayoutSource = importedPageLayout.source;
    score.publicationTextLayout = model.normalizePublicationTextLayout(creditMetadata.publicationTextLayout);
    score.parts = [];
    score.metadata.movementTitle = movementTitle;
    score.metadata.compositionDate = compositionDate;
    score.metadata.source = source;
    score.metadata.copyright = rights;
    score.metadata.dedication = dedication;
    score.metadata.supportingText = supportingText;
    score.annotations = [];
    score.chordSymbols = [];
    const report = {
      format: 'MusicXML', partsImported: 0, measuresImported: measureCount, notesImported: 0, chordsImported: 0, restsImported: 0,
      voicesImported: 0, lyricsImported: 0, textDirectionsImported: 0, chordSymbolsImported: 0, metadataImported: 0,
      unsupportedElements: [], warnings: [], fatalErrors: [], pickupImported: Boolean(pickupBeats), layoutImported: importedPageLayout ? 1 : 0
    };
    report.metadataImported = [title, subtitle, composer, arranger, lyricist, rights, source, compositionDate, dedication, supportingText].filter(Boolean).length;
    const unsupported = value => { if (value && !report.unsupportedElements.includes(value)) report.unsupportedElements.push(value); };

    const partNames = new Map();
    const partList = direct(root, 'part-list');
    const groupStack = [];
    Array.from(partList?.children || []).forEach(node => {
      if (node.localName === 'part-group') {
        const number = node.getAttribute('number') || '1';
        if ((node.getAttribute('type') || 'start') === 'start') groupStack.push({ number, symbol: text(node, 'group-symbol', 'bracket'), name: text(node, 'group-name', `Group ${number}`) });
        else {
          const index = groupStack.map(group => group.number).lastIndexOf(number);
          if (index >= 0) groupStack.splice(index, 1);
        }
        return;
      }
      if (node.localName !== 'score-part') return;
      const group = groupStack.at(-1) || null;
      partNames.set(node.id, {
        name: node.querySelector('part-name')?.textContent || node.id,
        shortName: node.querySelector('part-abbreviation')?.textContent || '',
        bracketGroup: group ? `musicxml-${group.number}-${group.name}` : null,
        groupSymbol: group?.symbol || null,
        midiProgram: Math.max(0, Number(node.querySelector('midi-program')?.textContent || 1) - 1)
      });
    });

    creditMetadata.credits.forEach(item => {
      const normalizedType = String(item.type || '').toLowerCase();
      if (['title', 'subtitle', 'composer', 'composition-date', 'dedication'].includes(normalizedType)) return;
      const wordsNode = item.node;
      const creditScope = normalizedType.includes('header') ? 'header' : (normalizedType.includes('footer') || normalizedType.includes('copyright')) ? 'footer' : 'page';
      score.annotations.push(model.normalizeAnnotation({
        type: creditScope === 'header' ? 'header-text' : creditScope === 'footer' ? 'footer-text' : 'page-text', scope: creditScope,
        text: item.words, placement: wordsNode?.getAttribute('valign') === 'bottom' ? 'below' : 'above', alignment: wordsNode?.getAttribute('justify') || 'left',
        offsetX: Number(wordsNode?.getAttribute('default-x')) || 0, offsetY: Number(wordsNode?.getAttribute('default-y')) || 0,
        sourceData: { page: item.page, creditType: item.type, fontFamily: wordsNode?.getAttribute('font-family') || '', fontSize: wordsNode?.getAttribute('font-size') || '', fontStyle: wordsNode?.getAttribute('font-style') || '', justify: wordsNode?.getAttribute('justify') || '', valign: wordsNode?.getAttribute('valign') || '' }
      }));
      report.textDirectionsImported += 1;
    });

    let runningTime = initialSignature;
    let runningKey = initialKey;
    for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
      let sourceMeasure = null;
      for (const partNode of partNodes) { sourceMeasure = directAll(partNode, 'measure')[measureIndex]; if (sourceMeasure) break; }
      if (!sourceMeasure) continue;
      const attributes = direct(sourceMeasure, 'attributes');
      const time = direct(attributes, 'time');
      const key = direct(attributes, 'key');
      if (time) { runningTime = `${text(time, 'beats', runningTime.split('/')[0])}/${text(time, 'beat-type', runningTime.split('/')[1])}`; score.measures[measureIndex].timeSignature = runningTime; }
      if (key) { runningKey = keyNameFromFifths(Number(text(key, 'fifths', '0')), text(key, 'mode', /m$/.test(runningKey) ? 'minor' : 'major')); score.measures[measureIndex].key = runningKey; }
      score.measures[measureIndex].displayNumber = sourceMeasure.getAttribute('number') || String(measureIndex + 1);
      const print = direct(sourceMeasure, 'print');
      if (print?.getAttribute('new-system') === 'yes') score.measures[measureIndex].newSystem = true;
      if (print?.getAttribute('new-page') === 'yes') score.measures[measureIndex].newPage = true;
      directAll(sourceMeasure, 'barline').forEach(barline => {
        const location = barline.getAttribute('location') || 'right';
        const repeat = direct(barline, 'repeat');
        const ending = direct(barline, 'ending');
        if (repeat?.getAttribute('direction') === 'forward') score.measures[measureIndex].repeatStart = true;
        if (repeat?.getAttribute('direction') === 'backward') { score.measures[measureIndex].repeatEnd = true; score.measures[measureIndex].repeatTimes = Number(repeat.getAttribute('times')) || 2; }
        if (ending?.getAttribute('type') === 'start') score.measures[measureIndex].endings = String(ending.getAttribute('number') || '1').split(/[, ]+/).map(Number).filter(Number.isFinite);
        if (location === 'left' && repeat) score.measures[measureIndex].repeatStart = true;
      });
    }
    model.ensureMeasures(score);

    partNodes.forEach((partNode, partIndex) => {
      const measures = directAll(partNode, 'measure');
      let divisions = 1;
      let staves = 1;
      let currentClefs = [{ number: 1, clef: 'treble' }];
      const firstAttrs = direct(measures[0], 'attributes');
      let transpose = 0;
      if (firstAttrs) {
        divisions = Number(text(firstAttrs, 'divisions', '1')) || 1;
        staves = Number(text(firstAttrs, 'staves', '1')) || 1;
        transpose = -Number(text(direct(firstAttrs, 'transpose'), 'chromatic', '0')) || 0;
        const clefs = directAll(firstAttrs, 'clef').map(node => ({ number: Number(node.getAttribute('number')) || 1, clef: parseClef(node) }));
        if (clefs.length) currentClefs = clefs;
      }
      const staffDefinitions = Array.from({ length: Math.max(staves, currentClefs.length, 1) }, (_, index) => {
        const number = index + 1; const found = currentClefs.find(item => item.number === number);
        return { id: staves === 2 && number === 1 ? 'treble' : staves === 2 && number === 2 ? 'bass' : `staff-${number}`, number, clef: found?.clef || (number === 2 ? 'bass' : 'treble') };
      });
      const clef = staffDefinitions.length > 1 ? (staffDefinitions.length === 2 && staffDefinitions[0].clef.startsWith('treble') && staffDefinitions[1].clef === 'bass' ? 'grand' : 'multi') : staffDefinitions[0]?.clef || 'treble';
      const meta = partNames.get(partNode.id) || { name: `Part ${partIndex + 1}`, shortName: `P${partIndex + 1}` };
      const instrumentKey = clef === 'grand' || clef === 'multi' ? 'piano' : clef === 'bass' ? 'bass' : 'soprano';
      const part = model.createPart(instrumentKey, { name: meta.name, shortName: meta.shortName || `P${partIndex + 1}`, midiProgram: meta.midiProgram || 0, clef, staffDefinitions, transpose, harmonyRole: null, bracketGroup: meta.bracketGroup || null, groupSymbol: meta.groupSymbol || null, voiceLayers: [1, 2, 3, 4], clefChanges: [] });
      part.events = [];
      const voiceMap = new Map();
      const normalizedVoice = sourceVoice => { const key = String(sourceVoice || '1'); if (!voiceMap.has(key)) voiceMap.set(key, voiceMap.size + 1); return voiceMap.get(key); };
      const staffId = number => staffDefinitions.length > 1 ? (staffDefinitions.find(item => item.number === number)?.id || `staff-${number}`) : null;

      const addDirection = (node, measureIndex, cursor) => {
        const offset = Number(text(node, 'offset', '0')) / divisions;
        const start = Math.max(model.measureBounds(score, measureIndex).start, cursor + offset);
        const staffNumber = Math.max(1, Number(text(node, 'staff', '1')) || 1);
        const placement = node.getAttribute('placement') === 'below' ? 'below' : 'above';
        const directionType = direct(node, 'direction-type');
        if (!directionType) return;
        const common = { partId: part.id, staff: staffId(staffNumber), measureIndex, start, placement, sourceData: { voice: Number(text(node, 'voice', '0')) || null, defaultX: Number(node.getAttribute('default-x')) || 0, defaultY: Number(node.getAttribute('default-y')) || 0 } };
        let recognized = false;
        Array.from(directionType.children).forEach(item => {
          const sourceData = { ...common.sourceData };
          let payload = null;
          if (item.localName === 'words') payload = { ...common, type: 'staff-text', text: item.textContent || '', sourceData: { ...sourceData, fontFamily: item.getAttribute('font-family') || '', fontSize: item.getAttribute('font-size') || '', fontStyle: item.getAttribute('font-style') || '', fontWeight: item.getAttribute('font-weight') || '', justify: item.getAttribute('justify') || '', valign: item.getAttribute('valign') || '' } };
          else if (item.localName === 'rehearsal') { payload = { ...common, type: 'rehearsal', scope: 'system', partId: null, text: item.textContent || '' }; score.measures[measureIndex].rehearsalMark ||= item.textContent?.trim() || ''; }
          else if (item.localName === 'metronome') payload = { ...common, type: 'tempo-text', scope: 'system', partId: null, text: `${text(item, 'beat-unit', 'quarter')} = ${text(item, 'per-minute', '')}`, sourceData: { ...sourceData, beatUnit: text(item, 'beat-unit', 'quarter'), perMinute: Number(text(item, 'per-minute', '0')) || null } };
          else if (item.localName === 'dynamics') { const value = Array.from(item.children)[0]?.localName || text(item, 'other-dynamics', 'mf'); payload = { ...common, type: 'dynamics', text: value, sourceData: { ...sourceData, value } }; }
          else if (item.localName === 'wedge') payload = { ...common, type: 'wedge', text: item.getAttribute('type') || '', sourceData: { ...sourceData, wedgeType: item.getAttribute('type') || 'crescendo', number: item.getAttribute('number') || '' } };
          else if (item.localName === 'pedal') payload = { ...common, type: 'pedal', text: 'Ped.', sourceData: { ...sourceData, pedalType: item.getAttribute('type') || 'start' } };
          else if (item.localName === 'octave-shift') payload = { ...common, type: 'octave-shift', text: `${item.getAttribute('size') || '8'}va`, sourceData: { ...sourceData, shiftType: item.getAttribute('type') || 'up', size: Number(item.getAttribute('size')) || 8 } };
          else if (item.localName === 'segno') payload = { ...common, type: 'segno', scope: 'system', partId: null, text: 'Segno' };
          else if (item.localName === 'coda') payload = { ...common, type: 'coda', scope: 'system', partId: null, text: 'Coda' };
          if (payload) { score.annotations.push(model.normalizeAnnotation(payload)); report.textDirectionsImported += 1; recognized = true; }
          else unsupported(`direction-type:${item.localName}`);
        });
        const sound = direct(node, 'sound');
        const soundTempo = Number(sound?.getAttribute('tempo')) || 0;
        if (soundTempo) {
          if (measureIndex === 0 && Math.abs(start) < EPSILON) score.settings.tempo = soundTempo;
          const existing = score.annotations.find(item => item.type === 'tempo-text' && Math.abs(item.start - start) < EPSILON);
          if (existing) existing.sourceData = { ...(existing.sourceData || {}), tempo: soundTempo };
          else { score.annotations.push(model.normalizeAnnotation({ ...common, type: 'tempo-text', scope: 'system', partId: null, text: `♩ = ${soundTempo}`, sourceData: { ...common.sourceData, tempo: soundTempo, perMinute: soundTempo } })); report.textDirectionsImported += 1; }
          recognized = true;
        }
        if (!recognized) unsupported('direction:unrecognized');
      };

      const addHarmony = (node, measureIndex, cursor) => {
        const offset = Number(text(node, 'offset', '0')) / divisions;
        const start = Math.max(model.measureBounds(score, measureIndex).start, cursor + offset);
        const rootNode = direct(node, 'root');
        const step = text(rootNode, 'root-step', 'C');
        const alter = Number(text(rootNode, 'root-alter', '0')) || 0;
        const accidental = theory.accidentalText(alter);
        const kindNode = direct(node, 'kind');
        const kind = kindNode?.textContent?.trim() || 'major';
        const label = kindNode?.getAttribute('text') || `${step}${accidental}${kind === 'major' ? '' : kind === 'minor' ? 'm' : ` ${kind}`}`;
        const staffNumber = Math.max(1, Number(text(node, 'staff', '1')) || 1);
        score.chordSymbols.push({ id: model.uid('chord-symbol'), start, measureIndex, partId: part.id, staff: staffId(staffNumber), rootStep: step, rootAlter: alter, kind, symbol: label, text: label, placement: node.getAttribute('placement') === 'below' ? 'below' : 'above', sourceData: { musicXml: true } });
        report.chordSymbolsImported += 1;
      };

      measures.forEach((measure, measureIndex) => {
        const bounds = model.measureBounds(score, measureIndex);
        const attributes = direct(measure, 'attributes');
        if (attributes) {
          divisions = Number(text(attributes, 'divisions', String(divisions))) || divisions;
          staves = Number(text(attributes, 'staves', String(staves))) || staves;
          directAll(attributes, 'clef').forEach(node => { const number = Number(node.getAttribute('number')) || 1; const value = parseClef(node); part.clefChanges.push({ measureIndex, staff: staffId(number) || `staff-${number}`, clef: value }); });
        }
        let cursor = bounds.start;
        const lastStart = new Map();
        const lastEventId = new Map();
        Array.from(measure.children).forEach(node => {
          if (node.localName === 'attributes' || node.localName === 'print' || node.localName === 'barline') return;
          if (node.localName === 'backup') { cursor = Math.max(bounds.start, cursor - Number(text(node, 'duration', '0')) / divisions); return; }
          if (node.localName === 'forward') { cursor = Math.min(bounds.end, cursor + Number(text(node, 'duration', '0')) / divisions); return; }
          if (node.localName === 'direction') { addDirection(node, measureIndex, cursor); return; }
          if (node.localName === 'harmony') { addHarmony(node, measureIndex, cursor); return; }
          if (node.localName !== 'note') { unsupported(`measure-element:${node.localName}`); return; }
          const duration = Math.max(.0625, durationFromType(node, divisions));
          const sourceVoice = text(node, 'voice', '1'); const voice = normalizedVoice(sourceVoice);
          const staffNumber = Math.max(1, Number(text(node, 'staff', '1')) || 1);
          const staff = staffId(staffNumber);
          const chord = Boolean(direct(node, 'chord'));
          const voiceKey = `${staffNumber}:${voice}`;
          const start = chord ? (lastStart.get(voiceKey) ?? cursor) : cursor;
          const rest = Boolean(direct(node, 'rest'));
          const eventId = model.uid(rest ? 'rest' : 'note');
          if (rest) {
            part.events.push({ id: eventId, type: 'rest', start, duration, staff, voice, sourceVoice, generated: false, hidden: node.getAttribute('print-object') === 'no' });
            report.restsImported += 1;
          } else {
            const pitchNode = direct(node, 'pitch');
            if (!pitchNode) { unsupported('note-without-pitch'); return; }
            const step = text(pitchNode, 'step', 'C');
            const alter = Number(text(pitchNode, 'alter', '0')) || 0;
            const octave = Number(text(pitchNode, 'octave', '4')) || 4;
            const pitch = `${step}${theory.accidentalText(alter)}${octave}`;
            const lyrics = directAll(node, 'lyric').map(lyricFromXml);
            report.lyricsImported += lyrics.length;
            const tieTypes = directAll(node, 'tie').map(tie => tie.getAttribute('type'));
            const notationsNode = direct(node, 'notations');
            const slurs = directAll(notationsNode, 'slur');
            const tuplets = directAll(notationsNode, 'tuplet');
            const timeModification = direct(node, 'time-modification');
            const articulationsNode = direct(notationsNode, 'articulations');
            const articulations = Array.from(articulationsNode?.children || []).map(item => item.localName);
            const ornaments = Array.from(direct(notationsNode, 'ornaments')?.children || []).map(item => item.localName);
            const technical = Array.from(direct(notationsNode, 'technical')?.children || []).map(item => ({ type: item.localName, value: item.textContent?.trim() || '' }));
            Array.from(notationsNode?.children || []).forEach(item => { if (!['tied', 'slur', 'tuplet', 'articulations', 'ornaments', 'technical', 'fermata'].includes(item.localName)) unsupported(`notation:${item.localName}`); });
            const event = {
              id: eventId, type: 'note', midi: theory.pitchToMidi(pitch), pitch, writtenPitch: null, staff, start, duration,
              velocity: 88, voice, sourceVoice, hidden: node.getAttribute('print-object') === 'no', lyric: lyrics[0]?.text || '', lyricVerse: lyrics[0]?.verse || 1, lyrics,
              syllabic: lyrics[0]?.syllabic || null, melisma: lyrics[0]?.melisma || false,
              tieStart: tieTypes.includes('start'), tieStop: tieTypes.includes('stop'),
              slurStart: slurs.some(item => item.getAttribute('type') === 'start'), slurStop: slurs.some(item => item.getAttribute('type') === 'stop'),
              slurNumber: Number(slurs[0]?.getAttribute('number')) || 1, grace: Boolean(direct(node, 'grace')),
              tuplet: timeModification || tuplets.length ? {
                actual: Number(text(timeModification, 'actual-notes', '3')) || 3,
                normal: Number(text(timeModification, 'normal-notes', '2')) || 2,
                start: tuplets.some(item => item.getAttribute('type') === 'start'), stop: tuplets.some(item => item.getAttribute('type') === 'stop'),
                number: Number(tuplets[0]?.getAttribute('number')) || 1
              } : null,
              articulations, ornaments, technical, fermata: Boolean(direct(notationsNode, 'fermata')),
              beam: directAll(node, 'beam').map(item => ({ number: Number(item.getAttribute('number')) || 1, value: item.textContent?.trim() || '' }))
            };
            if (chord) {
              const anchorId = lastEventId.get(voiceKey);
              const anchor = anchorId ? part.events.find(item => item.id === anchorId) : null;
              event.chordId = anchor?.chordId || anchor?.id || model.uid('chord');
              if (anchor && !anchor.chordId) anchor.chordId = event.chordId;
              report.chordsImported += 1;
            }
            part.events.push(event);
            report.notesImported += 1;
          }
          if (!chord) { lastStart.set(voiceKey, start); lastEventId.set(voiceKey, eventId); cursor += duration; }
        });
      });
      part.voiceLayers = [1, 2, 3, 4];
      model.normalizeEvents(part);
      model.normalizeChordIds(part);
      score.parts.push(part);
      report.partsImported += 1;
      report.voicesImported = Math.max(report.voicesImported, voiceMap.size);
    });
    score.settings.autoFillRests = true;
    score.importReport = report;
    score.importCompatibilityReport = score.importCompatibilityReport || { preserved: [], converted: [], unsupported: [], warnings: [] };
    score.importCompatibilityReport.preserved.push(`Imported ${report.partsImported} parts, ${report.notesImported} notes, ${report.lyricsImported} lyrics, ${report.textDirectionsImported} text/direction items and ${report.chordSymbolsImported} chord symbols.`);
    score.importCompatibilityReport.unsupported.push(...report.unsupportedElements);
    score.importCompatibilityReport.warnings.push(...report.warnings);
    return model.normalizeScore(score);
  }

  function writeVarLen(value) { let buffer = value & 0x7F; const bytes = []; while ((value >>= 7)) { buffer <<= 8; buffer |= ((value & 0x7F) | 0x80); } while (true) { bytes.push(buffer & 0xFF); if (buffer & 0x80) buffer >>= 8; else break; } return bytes; }
  function u32(value) { return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]; }
  function u16(value) { return [(value >>> 8) & 255, value & 255]; }
  function mergedTiedEvents(score, part) {
    const notes = (part.events || []).filter(event => event.type === 'note').sort((a, b) => a.start - b.start || a.midi - b.midi);
    const byId = new Map(notes.map(event => [event.id, event]));
    const incoming = new Map();
    const outgoing = new Map();
    for (const spanner of score.spanners || []) if (spanner.type === 'tie') {
      incoming.set(spanner.endEventId, spanner.startEventId);
      outgoing.set(spanner.startEventId, spanner.endEventId);
    }
    return notes.filter(event => !incoming.has(event.id) && !event.tieStop).map(event => {
      let duration = Number(event.duration) || 0;
      let current = event;
      const visited = new Set([event.id]);
      while (true) {
        let nextId = outgoing.get(current.id);
        let next = nextId ? byId.get(nextId) : null;
        if (!next && current.tieStart) next = notes.find(candidate => !visited.has(candidate.id) && candidate.midi === current.midi && candidate.voice === current.voice && candidate.staff === current.staff && Math.abs(candidate.start - (current.start + current.duration)) < EPSILON);
        if (!next || visited.has(next.id) || Number(next.midi) !== Number(event.midi)) break;
        duration += Number(next.duration) || 0;
        visited.add(next.id); current = next;
      }
      return { ...event, duration };
    });
  }

  function exportMidi(score) {
    const ppq = 480; const tracks = [];
    const timedMeta = [];
    score.measures.forEach((measure, index) => {
      const tick = Math.round(model.measureStartBeat(score, index) * ppq);
      if (index === 0 || measure.timeSignature) { const [a, b] = model.effectiveTimeSignature(score, index).split('/').map(Number); timedMeta.push({ tick, bytes: [0xFF, 0x58, 0x04, a, Math.log2(b), 24, 8] }); }
    });
    const tempoMicros = Math.round(60000000 / score.settings.tempo);
    timedMeta.push({ tick: 0, bytes: [0xFF, 0x51, 0x03, (tempoMicros >> 16) & 255, (tempoMicros >> 8) & 255, tempoMicros & 255] });
    timedMeta.sort((a, b) => a.tick - b.tick);
    const conductor = []; let lastMeta = 0; timedMeta.forEach(event => { conductor.push(...writeVarLen(event.tick - lastMeta), ...event.bytes); lastMeta = event.tick; }); conductor.push(0, 0xFF, 0x2F, 0); tracks.push(conductor);
    score.parts.forEach((part, index) => {
      const channel = index % 16; const timed = [];
      mergedTiedEvents(score, part).forEach(event => { timed.push({ tick: Math.round(event.start * ppq), order: 1, bytes: [0x90 | channel, event.midi & 127, event.velocity || 88] }); timed.push({ tick: Math.round((event.start + event.duration) * ppq), order: 0, bytes: [0x80 | channel, event.midi & 127, 0] }); });
      timed.sort((a, b) => a.tick - b.tick || a.order - b.order); const data = [0, 0xC0 | channel, part.midiProgram || 0]; let lastTick = 0;
      timed.forEach(event => { data.push(...writeVarLen(event.tick - lastTick), ...event.bytes); lastTick = event.tick; }); data.push(0, 0xFF, 0x2F, 0); tracks.push(data);
    });
    const bytes = [0x4D, 0x54, 0x68, 0x64, ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(ppq)]; tracks.forEach(track => bytes.push(0x4D, 0x54, 0x72, 0x6B, ...u32(track.length), ...track)); return new Uint8Array(bytes);
  }

  function parseMidi(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const readU16 = offset => (data[offset] << 8) | data[offset + 1]; const readU32 = offset => (data[offset] * 0x1000000) + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3];
    if (String.fromCharCode(...data.slice(0, 4)) !== 'MThd') throw new Error('Invalid MIDI header.');
    const ppq = readU16(12); let pos = 14; const tracks = []; let tempo = 96;
    while (pos + 8 <= data.length) {
      const id = String.fromCharCode(...data.slice(pos, pos + 4)); const length = readU32(pos + 4); pos += 8; if (id !== 'MTrk') { pos += length; continue; }
      const end = pos + length; let tick = 0; let running = 0; const active = new Map(); const notes = []; let program = 0;
      const readVar = () => { let value = 0; let byte; do { byte = data[pos++]; value = (value << 7) | (byte & 0x7F); } while (byte & 0x80); return value; };
      while (pos < end) {
        tick += readVar(); let status = data[pos++]; if (status < 0x80) { pos--; status = running; } else running = status;
        if (status === 0xFF) { const type = data[pos++]; const len = readVar(); if (type === 0x51 && len === 3) { const micros = (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2]; tempo = Math.round(60000000 / micros); } pos += len; continue; }
        if (status === 0xF0 || status === 0xF7) { pos += readVar(); continue; }
        const hi = status & 0xF0; const channel = status & 0x0F; const a = data[pos++]; const two = ![0xC0, 0xD0].includes(hi); const b = two ? data[pos++] : 0;
        if (hi === 0xC0) program = a;
        if (hi === 0x90 && b > 0) active.set(`${channel}:${a}`, { tick, velocity: b, midi: a });
        if (hi === 0x80 || (hi === 0x90 && b === 0)) { const key = `${channel}:${a}`; const start = active.get(key); if (start) { notes.push({ midi: a, velocity: start.velocity, start: start.tick / ppq, duration: Math.max(.0625, (tick - start.tick) / ppq) }); active.delete(key); } }
      }
      if (notes.length) tracks.push({ notes, program }); pos = end;
    }
    const maxBeat = Math.max(4, ...tracks.flatMap(track => track.notes.map(note => note.start + note.duration)));
    const score = model.createScore({ title: 'Imported MIDI', tempo, measures: Math.ceil(maxBeat / 4), template: 'lead' }); score.parts = [];
    tracks.forEach((track, index) => { const part = model.createPart('piano', { name: `MIDI Track ${index + 1}`, shortName: `Tr.${index + 1}`, midiProgram: track.program, clef: 'grand' }); part.events = track.notes.map(note => ({ id: model.uid('note'), type: 'note', pitch: theory.midiToPitch(note.midi), voice: 1, staff: note.midi < 60 ? 'bass' : 'treble', lyric: '', ...note })); score.parts.push(part); });
    if (!score.parts.length) score.parts.push(model.createPart('piano')); return model.normalizeScore(score);
  }


  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function le16(value) { return [value & 255, (value >>> 8) & 255]; }
  function le32(value) { return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]; }
  function readLe16(data, offset) { return data[offset] | (data[offset + 1] << 8); }
  function readLe32(data, offset) { return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0; }
  function concatBytes(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(length); let offset = 0;
    chunks.forEach(chunk => { output.set(chunk, offset); offset += chunk.length; });
    return output;
  }
  function createStoredZip(files) {
    const encoder = new TextEncoder();
    const locals = []; const central = []; let offset = 0;
    files.forEach(file => {
      const name = encoder.encode(file.name);
      const content = file.bytes instanceof Uint8Array ? file.bytes : encoder.encode(String(file.content ?? ''));
      const crc = crc32(content);
      const local = new Uint8Array([
        ...le32(0x04034B50), ...le16(20), ...le16(0x0800), ...le16(0), ...le16(0), ...le16(0),
        ...le32(crc), ...le32(content.length), ...le32(content.length), ...le16(name.length), ...le16(0), ...name, ...content
      ]);
      locals.push(local);
      const directory = new Uint8Array([
        ...le32(0x02014B50), ...le16(20), ...le16(20), ...le16(0x0800), ...le16(0), ...le16(0), ...le16(0),
        ...le32(crc), ...le32(content.length), ...le32(content.length), ...le16(name.length), ...le16(0), ...le16(0),
        ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...name
      ]);
      central.push(directory); offset += local.length;
    });
    const centralBytes = concatBytes(central);
    const end = new Uint8Array([
      ...le32(0x06054B50), ...le16(0), ...le16(0), ...le16(files.length), ...le16(files.length),
      ...le32(centralBytes.length), ...le32(offset), ...le16(0)
    ]);
    return concatBytes([...locals, centralBytes, end]);
  }
  function createMxl(scoreOrXml) {
    const xml = typeof scoreOrXml === 'string' ? scoreOrXml : exportMusicXML(scoreOrXml);
    const container = `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
    return createStoredZip([
      { name: 'mimetype', content: 'application/vnd.recordare.musicxml' },
      { name: 'META-INF/container.xml', content: container },
      { name: 'score.musicxml', content: xml }
    ]);
  }
  async function inflateRaw(bytes) {
    if (typeof require === 'function') {
      const zlib = require('node:zlib');
      return new Uint8Array(zlib.inflateRawSync(Buffer.from(bytes)));
    }
    if (typeof DecompressionStream === 'function') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('This environment cannot decompress the selected MXL file.');
  }
  async function unzipEntries(input) {
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    let end = -1;
    for (let index = Math.max(0, data.length - 65557); index <= data.length - 22; index += 1) if (readLe32(data, index) === 0x06054B50) end = index;
    if (end < 0) throw new Error('Invalid compressed MusicXML archive.');
    const count = readLe16(data, end + 10);
    let cursor = readLe32(data, end + 16);
    const decoder = new TextDecoder();
    const entries = new Map();
    for (let index = 0; index < count; index += 1) {
      if (readLe32(data, cursor) !== 0x02014B50) throw new Error('Damaged MXL central directory.');
      const method = readLe16(data, cursor + 10);
      const compressedSize = readLe32(data, cursor + 20);
      const uncompressedSize = readLe32(data, cursor + 24);
      const nameLength = readLe16(data, cursor + 28);
      const extraLength = readLe16(data, cursor + 30);
      const commentLength = readLe16(data, cursor + 32);
      const localOffset = readLe32(data, cursor + 42);
      const name = decoder.decode(data.slice(cursor + 46, cursor + 46 + nameLength));
      if (readLe32(data, localOffset) !== 0x04034B50) throw new Error('Damaged MXL local entry.');
      const localNameLength = readLe16(data, localOffset + 26);
      const localExtraLength = readLe16(data, localOffset + 28);
      const contentStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = data.slice(contentStart, contentStart + compressedSize);
      const bytes = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : (() => { throw new Error(`Unsupported MXL compression method: ${method}`); })();
      if (uncompressedSize && bytes.length !== uncompressedSize) throw new Error(`MXL entry ${name} is incomplete.`);
      entries.set(name, bytes);
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }
  async function extractMxlXml(bytes) {
    const entries = await unzipEntries(bytes);
    const decoder = new TextDecoder();
    let rootPath = 'score.musicxml';
    const container = entries.get('META-INF/container.xml');
    if (container) {
      const match = /full-path=["']([^"']+)["']/.exec(decoder.decode(container));
      if (match) rootPath = match[1];
    }
    const root = entries.get(rootPath) || Array.from(entries.entries()).find(([name]) => /\.(musicxml|xml)$/i.test(name))?.[1];
    if (!root) throw new Error('The MXL archive does not contain a MusicXML score.');
    return decoder.decode(root);
  }
  async function parseMxl(bytes) { return parseMusicXML(await extractMxlXml(bytes)); }

  return { exportMusicXML, parseMusicXML, createMxl, extractMxlXml, parseMxl, exportMidi, parseMidi, pitchComponents, musicXmlDuration, crc32, mergedTiedEvents };
});
