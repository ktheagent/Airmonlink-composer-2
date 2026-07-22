(function (root, factory) {
  const model = root.AirmonScoreModel || (typeof require === 'function' ? require('./score-model') : null);
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonMidiInput = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model) {
  'use strict';

  function decodeMidiMessage(data) {
    const bytes = Array.from(data || []);
    const status = Number(bytes[0]) || 0;
    const type = status & 0xF0;
    const channel = status & 0x0F;
    const note = Number(bytes[1]) || 0;
    const value = Number(bytes[2]) || 0;
    if (type === 0x90 && value > 0) return { type: 'noteon', channel, note, velocity: value };
    if (type === 0x80 || (type === 0x90 && value === 0)) return { type: 'noteoff', channel, note, velocity: value };
    if (type === 0xB0 && note === 64) return { type: 'sustain', channel, value, down: value >= 64 };
    return { type: 'other', channel, data: bytes };
  }

  class StepTimeMidiInput {
    constructor(score, options = {}) {
      this.score = score;
      this.partId = options.partId || score?.parts?.[0]?.id || null;
      this.voice = Math.max(1, Math.min(4, Number(options.voice) || 1));
      this.staff = options.staff || null;
      this.duration = Math.max(.0625, Number(options.duration) || 1);
      this.cursor = Math.max(0, Number(options.cursor) || 0);
      this.activeNotes = new Set();
      this.currentChordStart = null;
      this.sustain = false;
      this.onEntered = typeof options.onEntered === 'function' ? options.onEntered : null;
    }

    configure(options = {}) {
      if (options.score) this.score = options.score;
      if (options.partId) this.partId = options.partId;
      if (options.voice != null) this.voice = Math.max(1, Math.min(4, Number(options.voice) || 1));
      if ('staff' in options) this.staff = options.staff || null;
      if (options.duration != null) this.duration = Math.max(.0625, Number(options.duration) || 1);
      if (options.cursor != null) this.cursor = Math.max(0, Number(options.cursor) || 0);
      return this;
    }

    handle(data) {
      const message = data?.data ? decodeMidiMessage(data.data) : decodeMidiMessage(data);
      if (message.type === 'sustain') { this.sustain = message.down; return { message, entered: [] }; }
      if (message.type === 'noteon') return { message, entered: this.noteOn(message.note, message.velocity) };
      if (message.type === 'noteoff') { this.noteOff(message.note); return { message, entered: [] }; }
      return { message, entered: [] };
    }

    noteOn(midi, velocity = 88) {
      if (!this.score || !this.partId) throw new Error('Select a score part before MIDI step entry.');
      if (!this.activeNotes.size) this.currentChordStart = this.cursor;
      const start = this.currentChordStart == null ? this.cursor : this.currentChordStart;
      const part = this.score.parts.find(item => item.id === this.partId);
      const anchor = part?.events.find(item => item.type === 'note' && item.generatedBy !== 'gap-fill' && Math.abs(item.start - start) < 1e-8 && Math.abs(item.duration - this.duration) < 1e-8 && (item.voice || 1) === this.voice && (item.staff || null) === (this.staff || null));
      const event = anchor
        ? model.addChordTone(this.score, this.partId, anchor.id, Number(midi), { velocity: Math.max(1, Math.min(127, Number(velocity) || 88)), inputSource: 'midi-step' })
        : model.addNote(this.score, this.partId, { midi: Number(midi), velocity: Math.max(1, Math.min(127, Number(velocity) || 88)), start, duration: this.duration, voice: this.voice, staff: this.staff, allowChord: true, inputSource: 'midi-step' });
      this.activeNotes.add(Number(midi));
      const entered = [event];
      if (this.onEntered) this.onEntered(entered, this);
      return entered;
    }

    noteOff(midi) {
      this.activeNotes.delete(Number(midi));
      if (!this.activeNotes.size && !this.sustain) {
        this.cursor = Number(this.currentChordStart == null ? this.cursor : this.currentChordStart) + this.duration;
        this.currentChordStart = null;
      }
      return this.cursor;
    }

    releaseSustain() {
      this.sustain = false;
      if (!this.activeNotes.size && this.currentChordStart != null) {
        this.cursor = this.currentChordStart + this.duration;
        this.currentChordStart = null;
      }
      return this.cursor;
    }
  }

  return { decodeMidiMessage, StepTimeMidiInput };
});
