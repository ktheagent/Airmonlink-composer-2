(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonSelection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class SelectionModel {
    constructor(initial = null) {
      this.kind = 'events';
      this.eventIds = new Set();
      this.partIds = new Set();
      this.staffRefs = new Set();
      this.measureIds = new Set();
      this.anchorEventId = null;
      if (initial) this.restore(initial);
    }

    clear() {
      this.kind = 'events';
      this.eventIds.clear();
      this.partIds.clear();
      this.staffRefs.clear();
      this.measureIds.clear();
      this.anchorEventId = null;
      return this;
    }

    selectEvent(eventId, options = {}) {
      const id = String(eventId || '');
      if (!id) return this;
      if (!options.additive && !options.toggle) this.clear();
      this.kind = 'events';
      if (options.toggle && this.eventIds.has(id)) this.eventIds.delete(id);
      else this.eventIds.add(id);
      if (!this.anchorEventId || !options.preserveAnchor) this.anchorEventId = id;
      return this;
    }

    selectEvents(eventIds, options = {}) {
      if (!options.additive) this.clear();
      this.kind = 'events';
      for (const eventId of eventIds || []) if (eventId != null) this.eventIds.add(String(eventId));
      if (!this.anchorEventId && this.eventIds.size) this.anchorEventId = this.eventIds.values().next().value;
      return this;
    }

    selectMeasure(measureId, options = {}) {
      if (!options.additive) this.clear();
      this.kind = 'measures';
      if (measureId != null) this.measureIds.add(String(measureId));
      return this;
    }

    selectPart(partId, options = {}) {
      if (!options.additive) this.clear();
      this.kind = 'parts';
      if (partId != null) this.partIds.add(String(partId));
      return this;
    }

    selectStaff(partId, staffId = '') {
      this.clear();
      this.kind = 'staves';
      this.staffRefs.add(`${partId || ''}::${staffId || ''}`);
      return this;
    }

    hasEvent(eventId) { return this.eventIds.has(String(eventId)); }
    get size() { return this.eventIds.size + this.measureIds.size + this.partIds.size + this.staffRefs.size; }
    get isEmpty() { return this.size === 0; }

    eventEntries(score) {
      const output = [];
      for (const part of score?.parts || []) {
        for (const event of part.events || []) if (this.eventIds.has(String(event.id))) output.push({ part, event });
      }
      return output.sort((a, b) => (a.event.start - b.event.start) || String(a.part.id).localeCompare(String(b.part.id)) || String(a.event.id).localeCompare(String(b.event.id)));
    }

    filterEvents(score, predicate) {
      const ids = this.eventEntries(score).filter(({ part, event }) => predicate(event, part)).map(({ event }) => event.id);
      this.selectEvents(ids);
      return ids.length;
    }

    snapshot() {
      return {
        kind: this.kind,
        eventIds: [...this.eventIds],
        partIds: [...this.partIds],
        staffRefs: [...this.staffRefs],
        measureIds: [...this.measureIds],
        anchorEventId: this.anchorEventId
      };
    }

    restore(value = {}) {
      this.clear();
      this.kind = value.kind || 'events';
      this.eventIds = new Set((value.eventIds || []).map(String));
      this.partIds = new Set((value.partIds || []).map(String));
      this.staffRefs = new Set((value.staffRefs || []).map(String));
      this.measureIds = new Set((value.measureIds || []).map(String));
      this.anchorEventId = value.anchorEventId ? String(value.anchorEventId) : null;
      return this;
    }
  }

  function idsInRect(items, rect) {
    const left = Math.min(rect.x1, rect.x2);
    const right = Math.max(rect.x1, rect.x2);
    const top = Math.min(rect.y1, rect.y2);
    const bottom = Math.max(rect.y1, rect.y2);
    return (items || []).filter(item => {
      const box = item.box || item;
      return box.x2 >= left && box.x1 <= right && box.y2 >= top && box.y1 <= bottom;
    }).map(item => item.id);
  }

  return { SelectionModel, idsInRect };
});
