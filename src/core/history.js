(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function isIdArray(value) {
    return Array.isArray(value) && value.every(item => item && typeof item === 'object' && !Array.isArray(item) && item.id != null) && new Set(value.map(item => String(item.id))).size === value.length;
  }

  function buildPatch(before, after, path = [], output = []) {
    if (equal(before, after)) return output;
    if (Array.isArray(before) && Array.isArray(after)) {
      if (isIdArray(before) && isIdArray(after)) {
        const beforeMap = new Map(before.map((item, index) => [String(item.id), { item, index }]));
        const afterMap = new Map(after.map((item, index) => [String(item.id), { item, index }]));
        for (const [id, value] of beforeMap) if (!afterMap.has(id)) output.push({ op: 'removeById', path, id });
        for (const [id, value] of afterMap) {
          if (!beforeMap.has(id)) output.push({ op: 'insertAt', path, index: value.index, value: clone(value.item) });
          else if (!equal(beforeMap.get(id).item, value.item)) output.push({ op: 'replaceById', path, id, value: clone(value.item) });
        }
        const beforeOrder = before.map(item => String(item.id)).filter(id => afterMap.has(id));
        const afterOrder = after.map(item => String(item.id));
        if (!equal(beforeOrder, afterOrder.filter(id => beforeMap.has(id))) || before.length !== after.length) output.push({ op: 'reorderIds', path, order: afterOrder });
        return output;
      }
      output.push({ op: 'set', path, value: clone(after) });
      return output;
    }
    if (before && after && typeof before === 'object' && typeof after === 'object') {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const key of keys) {
        if (!(key in after)) output.push({ op: 'delete', path: [...path, key] });
        else if (!(key in before)) output.push({ op: 'set', path: [...path, key], value: clone(after[key]) });
        else buildPatch(before[key], after[key], [...path, key], output);
      }
      return output;
    }
    output.push({ op: 'set', path, value: clone(after) });
    return output;
  }

  function resolveParent(root, path) {
    if (!path.length) return { parent: null, key: null };
    let parent = root;
    for (let index = 0; index < path.length - 1; index += 1) {
      const key = path[index];
      if (parent[key] == null) parent[key] = {};
      parent = parent[key];
    }
    return { parent, key: path[path.length - 1] };
  }

  function getAtPath(root, path) {
    let value = root;
    for (const key of path) value = value?.[key];
    return value;
  }

  function applyPatch(source, operations) {
    let root = clone(source);
    for (const operation of operations || []) {
      if (operation.op === 'set') {
        if (!operation.path.length) root = clone(operation.value);
        else {
          const { parent, key } = resolveParent(root, operation.path);
          parent[key] = clone(operation.value);
        }
        continue;
      }
      if (operation.op === 'delete') {
        const { parent, key } = resolveParent(root, operation.path);
        if (Array.isArray(parent)) parent.splice(Number(key), 1);
        else if (parent) delete parent[key];
        continue;
      }
      const array = getAtPath(root, operation.path);
      if (!Array.isArray(array)) throw new Error(`History patch expected an array at ${operation.path.join('.')}.`);
      if (operation.op === 'removeById') {
        const index = array.findIndex(item => String(item.id) === String(operation.id));
        if (index >= 0) array.splice(index, 1);
      } else if (operation.op === 'insertAt') {
        array.splice(Math.max(0, Math.min(array.length, Number(operation.index) || 0)), 0, clone(operation.value));
      } else if (operation.op === 'replaceById') {
        const index = array.findIndex(item => String(item.id) === String(operation.id));
        if (index >= 0) array[index] = clone(operation.value);
        else array.push(clone(operation.value));
      } else if (operation.op === 'reorderIds') {
        const map = new Map(array.map(item => [String(item.id), item]));
        const ordered = operation.order.map(id => map.get(String(id))).filter(Boolean);
        for (const item of array) if (!operation.order.includes(String(item.id))) ordered.push(item);
        array.splice(0, array.length, ...ordered);
      }
    }
    return root;
  }

  class HistoryManager {
    constructor(limit = 100) {
      this.limit = limit;
      this.undoStack = [];
      this.redoStack = [];
      this.currentState = null;
    }

    snapshot(score, label = 'Edit') {
      const next = clone(score);
      if (this.currentState == null) {
        this.currentState = next;
        return false;
      }
      const forward = buildPatch(this.currentState, next);
      if (!forward.length) return false;
      const backward = buildPatch(next, this.currentState);
      this.undoStack.push({ label, forward, backward, at: Date.now() });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
      this.currentState = next;
      return true;
    }

    undo(currentScore) {
      if (!this.undoStack.length) return currentScore;
      const entry = this.undoStack.pop();
      const result = applyPatch(currentScore, entry.backward);
      this.redoStack.push(entry);
      this.currentState = clone(result);
      return result;
    }

    redo(currentScore) {
      if (!this.redoStack.length) return currentScore;
      const entry = this.redoStack.pop();
      const result = applyPatch(currentScore, entry.forward);
      this.undoStack.push(entry);
      this.currentState = clone(result);
      return result;
    }

    reset(score) {
      this.undoStack = [];
      this.redoStack = [];
      this.currentState = clone(score);
    }

    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }
    get undoLabel() { return this.undoStack.at(-1)?.label || null; }
    get redoLabel() { return this.redoStack.at(-1)?.label || null; }
    get estimatedBytes() { return JSON.stringify({ undo: this.undoStack, redo: this.redoStack }).length; }
  }

  return { HistoryManager, buildPatch, applyPatch };
});
