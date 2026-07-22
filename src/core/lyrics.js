(function (root, factory) {
  const model = root.AirmonScoreModel || (typeof require === 'function' ? require('./score-model') : null);
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonLyrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model) {
  'use strict';

  function eligibleNotes(score, options = {}) {
    const partIds = options.partIds ? new Set(options.partIds) : null;
    const staff = options.staff == null || options.staff === 'all' ? null : String(options.staff);
    const voice = options.voice == null || options.voice === 'all' ? null : Number(options.voice);
    const start = Number.isFinite(Number(options.start)) ? Number(options.start) : -Infinity;
    const end = Number.isFinite(Number(options.end)) ? Number(options.end) : Infinity;
    return score.parts.flatMap(part => {
      if (partIds && !partIds.has(part.id)) return [];
      return part.events.filter(event => event.type === 'note' && event.generatedBy !== 'gap-fill')
        .filter(event => staff == null || String(event.staff || '') === staff)
        .filter(event => voice == null || (event.voice || 1) === voice)
        .filter(event => event.start >= start - 1e-8 && event.start < end - 1e-8)
        .map(event => ({ part, event }));
    }).sort((a, b) => a.event.start - b.event.start || (a.event.voice || 1) - (b.event.voice || 1) || String(a.part.id).localeCompare(String(b.part.id)) || String(a.event.id).localeCompare(String(b.event.id)));
  }

  function tokenizeLyrics(text) {
    const source = String(text || '').replace(/\r/g, ' ').trim();
    if (!source) return [];
    const tokens = [];
    let buffer = '';
    const flush = (advance = 'space') => {
      const clean = buffer.trim();
      if (clean) tokens.push({ text: clean, advance, melisma: false, syllabic: 'single' });
      buffer = '';
    };
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (/\s/.test(char)) { flush('space'); continue; }
      if (char === '-') { flush('hyphen'); if (tokens.length) tokens[tokens.length - 1].syllabic = 'begin'; continue; }
      if (char === '_') {
        flush('melisma');
        if (tokens.length) {
          tokens[tokens.length - 1].melisma = true;
          tokens[tokens.length - 1].advance = 'melisma';
        } else tokens.push({ text: '', advance: 'melisma', melisma: true, syllabic: 'single' });
        continue;
      }
      buffer += char;
    }
    flush('space');
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index].advance === 'hyphen') tokens[index].syllabic = index > 0 && tokens[index - 1].advance === 'hyphen' ? 'middle' : 'begin';
      else if (index > 0 && tokens[index - 1].advance === 'hyphen') tokens[index].syllabic = 'end';
    }
    return tokens;
  }

  function previewAssignments(score, text, options = {}) {
    const notes = eligibleNotes(score, options);
    const tokens = tokenizeLyrics(text);
    const startIndex = Math.max(0, Number(options.startIndex) || 0);
    const assignments = [];
    let noteIndex = startIndex;
    tokens.forEach(token => {
      const target = notes[noteIndex];
      assignments.push({
        token,
        partId: target?.part.id || null,
        noteId: target?.event.id || null,
        pitch: target?.event.pitch || null,
        start: target?.event.start ?? null,
        valid: Boolean(target)
      });
      noteIndex += 1;
    });
    return { assignments, availableNotes: notes.length, consumedNotes: Math.min(tokens.length, Math.max(0, notes.length - startIndex)), overflow: Math.max(0, tokens.length - Math.max(0, notes.length - startIndex)) };
  }

  function applyAssignments(score, preview, options = {}) {
    const verse = Math.max(1, Number(options.verse) || 1);
    const lineType = options.lineType || 'verse';
    let applied = 0;
    preview.assignments.filter(item => item.valid).forEach(item => {
      model.setLyric(score, item.partId, item.noteId, item.token.text, {
        verse,
        lineType,
        syllabic: item.token.syllabic,
        melisma: item.token.melisma,
        extensionState: item.token.melisma ? 'extend' : 'none'
      });
      applied += 1;
    });
    return applied;
  }

  function nextEligibleNote(score, partId, eventId, options = {}) {
    const notes = eligibleNotes(score, { ...options, partIds: partId ? [partId] : options.partIds });
    const index = notes.findIndex(item => item.part.id === partId && item.event.id === eventId);
    return notes[index + 1] || null;
  }

  function previousEligibleNote(score, partId, eventId, options = {}) {
    const notes = eligibleNotes(score, { ...options, partIds: partId ? [partId] : options.partIds });
    const index = notes.findIndex(item => item.part.id === partId && item.event.id === eventId);
    return index > 0 ? notes[index - 1] : null;
  }

  function copyVerse(score, sourceVerse, targetVerse, options = {}) {
    const source = Math.max(1, Number(sourceVerse) || 1);
    const target = Math.max(1, Number(targetVerse) || 1);
    let count = 0;
    eligibleNotes(score, options).forEach(({ part, event }) => {
      const lyric = (event.lyrics || []).find(item => Number(item.verse) === source && (!options.lineType || item.lineType === options.lineType));
      if (!lyric) return;
      model.setLyric(score, part.id, event.id, lyric.text, { ...lyric, verse: target });
      count += 1;
    });
    return count;
  }

  function searchReplace(score, search, replacement, options = {}) {
    const needle = String(search || '');
    if (!needle) return 0;
    const flags = options.caseSensitive ? 'g' : 'gi';
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, flags);
    let count = 0;
    score.parts.forEach(part => part.events.filter(event => event.type === 'note').forEach(event => {
      (event.lyrics || []).forEach(lyric => {
        if (options.verse && Number(lyric.verse) !== Number(options.verse)) return;
        if (options.lineType && lyric.lineType !== options.lineType) return;
        const next = String(lyric.text || '').replace(pattern, () => { count += 1; return String(replacement ?? ''); });
        if (next !== lyric.text) model.setLyric(score, part.id, event.id, next, { ...lyric });
      });
    }));
    return count;
  }

  function resetPosition(score, partId, eventId, verse = null) {
    const part = score.parts.find(item => item.id === partId);
    const event = part?.events.find(item => item.id === eventId);
    if (!event || event.type !== 'note') return false;
    event.lyrics = (event.lyrics || []).map(lyric => verse == null || Number(lyric.verse) === Number(verse) ? { ...lyric, offsetX: 0, offsetY: 0 } : lyric);
    model.normalizeEventLyrics(event, part);
    model.touch(score);
    return true;
  }


  function repairLegacyVerseSuffixes(score, options = {}) {
    const minimumMatches = Math.max(2, Number(options.minimumMatches) || 3);
    const minimumRatio = Math.max(0.5, Math.min(1, Number(options.minimumRatio) || 0.8));
    const requestedVerse = options.verse == null ? null : Math.max(1, Number(options.verse) || 1);
    const requestedLineType = options.lineType || null;
    const partIds = options.partIds ? new Set(options.partIds.map(String)) : null;
    const groups = new Map();

    (score.parts || []).forEach(part => {
      if (partIds && !partIds.has(String(part.id))) return;
      (part.events || []).filter(event => event.type === 'note').forEach(event => {
        (event.lyrics || []).forEach(lyric => {
          const verse = Math.max(1, Number(lyric.verse) || 1);
          const lineType = lyric.lineType || 'verse';
          if (requestedVerse != null && verse !== requestedVerse) return;
          if (requestedLineType && lineType !== requestedLineType) return;
          const key = `${part.id}\u0000${event.staff || ''}\u0000${event.voice || 1}\u0000${verse}\u0000${lineType}`;
          if (!groups.has(key)) groups.set(key, { part, verse, lineType, entries: [] });
          groups.get(key).entries.push({ event, lyric });
        });
      });
    });

    const repairs = [];
    const repairedGroups = [];
    for (const group of groups.values()) {
      const suffix = String(group.verse);
      const textual = group.entries.filter(({ lyric }) => String(lyric.text || '').trim());
      const candidates = textual.filter(({ lyric }) => {
        const value = String(lyric.text || '').trimEnd();
        if (!value.endsWith(suffix) || value.length <= suffix.length) return false;
        const base = value.slice(0, -suffix.length);
        if (!base.trim() || /\d$/.test(base)) return false;
        return true;
      });

      if (candidates.length < minimumMatches || candidates.length / Math.max(1, textual.length) < minimumRatio) continue;
      repairedGroups.push({ partId: group.part.id, verse: group.verse, lineType: group.lineType, matches: candidates.length, total: textual.length });

      candidates.forEach(({ event, lyric }) => {
        const before = String(lyric.text || '');
        const trailingWhitespace = before.match(/\s*$/)?.[0] || '';
        const core = before.slice(0, before.length - trailingWhitespace.length);
        const after = core.slice(0, -suffix.length) + trailingWhitespace;
        repairs.push({ partId: group.part.id, eventId: event.id, lyricId: lyric.id || null, verse: group.verse, before, after });
        if (!options.dryRun) lyric.text = after;
      });
    }

    if (!options.dryRun && repairs.length) {
      const touchedEvents = new Set(repairs.map(item => item.eventId));
      (score.parts || []).forEach(part => (part.events || []).forEach(event => {
        if (touchedEvents.has(event.id) && typeof model.normalizeEventLyrics === 'function') model.normalizeEventLyrics(event, part);
      }));
      if (typeof model.touch === 'function') model.touch(score);
    }

    return { changed: options.dryRun ? 0 : repairs.length, candidates: repairs.length, groups: repairedGroups, repairs };
  }

  function lyricCount(score) {
    return score.parts.reduce((sum, part) => sum + part.events.reduce((eventSum, event) => eventSum + (Array.isArray(event.lyrics) ? event.lyrics.length : 0), 0), 0);
  }

  return { eligibleNotes, tokenizeLyrics, previewAssignments, applyAssignments, nextEligibleNote, previousEligibleNote, copyVerse, searchReplace, resetPosition, repairLegacyVerseSuffixes, lyricCount };
});
