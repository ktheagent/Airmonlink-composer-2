(function (root, factory) {
  const theory = root.AirmonMusicTheory || (typeof require === 'function' ? require('./music-theory') : null);
  const model = root.AirmonScoreModel || (typeof require === 'function' ? require('./score-model') : null);
  const api = factory(theory, model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonPlayback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (theory, model) {
  'use strict';

  function buildPlaybackSegments(score) {
    const order = model?.playbackMeasureOrder ? model.playbackMeasureOrder(score) : score.measures.map((_, measureIndex) => ({ measureIndex, pass: 1 }));
    let playbackCursor = 0;
    return order.map(item => {
      const bounds = model.measureBounds(score, item.measureIndex);
      const segment = { ...item, notatedStart: bounds.start, notatedEnd: bounds.end, capacity: bounds.capacity, playStart: playbackCursor, playEnd: playbackCursor + bounds.capacity };
      playbackCursor += bounds.capacity;
      return segment;
    });
  }

  function playbackRange(score, segments, startBeat, range = null) {
    const total = model.totalBeats(score);
    const normalizedStart = theory.clamp(Number(range?.start ?? startBeat) || 0, 0, Math.max(0, total - 1e-8));
    const normalizedEnd = range?.end == null ? total : theory.clamp(Number(range.end) || total, normalizedStart + 1e-8, total);
    const startMeasure = model.measureIndexAt(score, normalizedStart);
    const firstSegment = segments.find(segment => segment.measureIndex === startMeasure) || segments[0];
    const startPlayBeat = (firstSegment?.playStart || 0) + Math.max(0, normalizedStart - (firstSegment?.notatedStart || 0));
    let endPlayBeat = segments.at(-1)?.playEnd || total;
    if (range?.end != null) {
      const endMeasure = model.measureIndexAt(score, Math.max(0, normalizedEnd - 1e-8));
      const endSegment = segments.find(segment => segment.measureIndex === endMeasure && segment.playEnd > startPlayBeat + 1e-8);
      if (endSegment) endPlayBeat = Math.min(endSegment.playEnd, endSegment.playStart + Math.max(0, normalizedEnd - endSegment.notatedStart));
    }
    return { start: normalizedStart, end: normalizedEnd, startPlayBeat, endPlayBeat };
  }

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
      let current = event;
      let duration = Number(event.duration) || 0;
      const visited = new Set([event.id]);
      while (true) {
        let next = byId.get(outgoing.get(current.id));
        if (!next && current.tieStart) next = notes.find(candidate => !visited.has(candidate.id) && candidate.midi === current.midi && candidate.voice === current.voice && candidate.staff === current.staff && Math.abs(candidate.start - (current.start + current.duration)) < 1e-8);
        if (!next || visited.has(next.id) || Number(next.midi) !== Number(event.midi)) break;
        duration += Number(next.duration) || 0;
        visited.add(next.id); current = next;
      }
      return { ...event, duration, tiedEventIds: Array.from(visited) };
    });
  }

  function buildPlaybackNotes(score) {
    return (score.parts || []).flatMap((part, partIndex) => mergedTiedEvents(score, part).map(event => ({ part, partIndex, event })));
  }

  class PlaybackEngine {
    constructor() {
      this.context = null;
      this.nodes = [];
      this.timer = null;
      this.playing = false;
      this.startedAt = 0;
      this.startBeat = 0;
      this.currentBeat = 0;
      this.maxBeat = 0;
      this.score = null;
      this.loop = false;
      this.loopRange = null;
      this.onPosition = null;
      this.onStop = null;
    }

    ensureContext() {
      if (!this.context) this.context = new (window.AudioContext || window.webkitAudioContext)();
      return this.context;
    }

    stop(options = {}) {
      const notify = options.notify !== false;
      const reset = options.reset === true;
      this.nodes.forEach(node => { try { node.stop(); } catch (_) {} });
      this.nodes = [];
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.playing = false;
      if (reset) this.currentBeat = 0;
      if (notify && this.onStop) this.onStop({ beat: this.currentBeat, natural: Boolean(options.natural) });
    }

    play(score, startBeat = 0, loop = false, loopRange = null) {
      this.stop({ notify: false });
      const context = this.ensureContext();
      if (context.state === 'suspended') context.resume();
      const secondsPerBeat = 60 / score.settings.tempo;
      const now = context.currentTime + 0.06;
      this.score = score;
      this.loop = Boolean(loop);
      this.loopRange = loopRange && Number(loopRange.end) > Number(loopRange.start) ? { start: Number(loopRange.start), end: Number(loopRange.end) } : null;
      const segments = buildPlaybackSegments(score);
      const range = playbackRange(score, segments, startBeat, this.loopRange);
      this.startBeat = range.start;
      this.currentBeat = this.startBeat;
      this.playing = true;
      this.startedAt = now;
      this.startPlayBeat = range.startPlayBeat;
      this.maxBeat = range.endPlayBeat;
      this.playbackSegments = segments;
      const startPlayBeat = range.startPlayBeat;
      const soloed = score.parts.some(part => part.solo);

      segments.forEach(segment => {
        if (segment.playEnd <= startPlayBeat + 1e-8 || segment.playStart >= this.maxBeat - 1e-8) return;
        score.parts.forEach((part, partIndex) => {
          if (part.muted || (soloed && !part.solo)) return;
          mergedTiedEvents(score, part).filter(event => event.start >= segment.notatedStart - 1e-8 && event.start < segment.notatedEnd - 1e-8).forEach(event => {
            const occurrenceStart = segment.playStart + (event.start - segment.notatedStart);
            if (occurrenceStart >= this.maxBeat - 1e-8) return;
            const eventStart = Math.max(occurrenceStart, startPlayBeat);
            const offset = (eventStart - startPlayBeat) * secondsPerBeat;
            const eventEnd = Math.min(this.maxBeat, occurrenceStart + event.duration);
            const duration = Math.max(0.04, (eventEnd - eventStart) * secondsPerBeat);
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            const panner = context.createStereoPanner ? context.createStereoPanner() : null;
            oscillator.type = partIndex === 0 ? 'sine' : 'triangle';
            oscillator.frequency.value = theory.frequencyForMidi(event.midi);
            const volume = Math.max(0, Math.min(1, (part.volume ?? 0.8) * ((event.velocity || 88) / 127) * 0.18));
            gain.gain.setValueAtTime(0.0001, now + offset);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + offset + 0.015);
            gain.gain.setValueAtTime(Math.max(0.0002, volume * 0.75), now + offset + Math.max(0.02, duration - 0.05));
            gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
            if (panner) { panner.pan.value = part.pan || 0; oscillator.connect(gain).connect(panner).connect(context.destination); }
            else oscillator.connect(gain).connect(context.destination);
            oscillator.start(now + offset); oscillator.stop(now + offset + duration + 0.02); this.nodes.push(oscillator);
          });
        });
      });

      this.timer = setInterval(() => {
        if (!this.playing) return;
        const playBeat = this.startPlayBeat + Math.max(0, context.currentTime - this.startedAt) / secondsPerBeat;
        const segment = this.playbackSegments.find(item => playBeat >= item.playStart - 1e-8 && playBeat < item.playEnd - 1e-8) || this.playbackSegments.at(-1);
        const notatedBeat = segment ? segment.notatedStart + Math.min(segment.capacity, Math.max(0, playBeat - segment.playStart)) : this.startBeat;
        this.currentBeat = notatedBeat;
        if (this.onPosition) this.onPosition(notatedBeat, { playBeat, measureIndex: segment?.measureIndex, pass: segment?.pass || 1 });
        if (playBeat >= this.maxBeat + 0.05) {
          if (this.loop) this.play(score, this.loopRange?.start ?? this.startBeat, true, this.loopRange);
          else this.stop({ natural: true });
        }
      }, 30);
    }

    seek(score, beat, loop = false, loopRange = null) {
      const wasPlaying = this.playing;
      this.currentBeat = Math.max(0, Number(beat) || 0);
      if (wasPlaying) this.play(score, this.currentBeat, loop, loopRange || this.loopRange);
      else if (this.onPosition) this.onPosition(this.currentBeat);
    }

    async shutdown() {
      this.stop({ notify: false });
      this.onPosition = null;
      this.onStop = null;
      const context = this.context;
      this.context = null;
      this.score = null;
      this.playbackSegments = [];
      if (context && context.state !== 'closed' && typeof context.close === 'function') await context.close();
      return true;
    }
  }

  return { PlaybackEngine, buildPlaybackSegments, playbackRange, mergedTiedEvents, buildPlaybackNotes };
});
