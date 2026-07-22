'use strict';

const DEFAULT_TIMEOUT_MS = 15000;

function createRequestId(now = Date.now) {
  return `shutdown-${now()}-${Math.random().toString(16).slice(2, 10)}`;
}

class ShutdownCoordinator {
  constructor(options = {}) {
    if (typeof options.sendRequest !== 'function') throw new TypeError('sendRequest is required.');
    this.sendRequest = options.sendRequest;
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
    this.logger = typeof options.logger === 'function' ? options.logger : () => {};
    this.pending = null;
    this.approved = false;
  }

  request(reason = 'application-quit', details = {}) {
    if (this.approved) return Promise.resolve({ status: 'approved', reason, repeated: true });
    if (this.pending) return this.pending.promise;

    const requestId = createRequestId();
    let resolveRequest;
    const promise = new Promise(resolve => { resolveRequest = resolve; });
    const timer = setTimeout(() => {
      if (!this.pending || this.pending.requestId !== requestId) return;
      this.logger('renderer-timeout', { requestId, reason, timeoutMs: this.timeoutMs });
      this.pending = null;
      resolveRequest({ status: 'timeout', requestId, reason });
    }, this.timeoutMs);

    this.pending = { requestId, reason, timer, promise, resolve: resolveRequest };
    this.logger('renderer-requested', { requestId, reason });
    try {
      this.sendRequest({ requestId, reason, timeoutMs: this.timeoutMs, ...details });
    } catch (error) {
      clearTimeout(timer);
      this.pending = null;
      this.logger('renderer-send-failed', { requestId, reason, message: error?.message || String(error) });
      resolveRequest({ status: 'error', requestId, reason, error });
    }
    return promise;
  }

  extendTimeout(timeoutMs, label = 'extended') {
    if (!this.pending) return false;
    const pending = this.pending;
    const timeout = Math.max(1000, Number(timeoutMs) || this.timeoutMs);
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      if (!this.pending || this.pending.requestId !== pending.requestId) return;
      this.logger('renderer-timeout', { requestId: pending.requestId, reason: pending.reason, timeoutMs: timeout, label });
      this.pending = null;
      pending.resolve({ status: 'timeout', requestId: pending.requestId, reason: pending.reason, label });
    }, timeout);
    this.logger('renderer-timeout-extended', { requestId: pending.requestId, reason: pending.reason, timeoutMs: timeout, label });
    return true;
  }

  receive(response = {}) {
    if (!this.pending || response.requestId !== this.pending.requestId) {
      this.logger('renderer-response-ignored', { requestId: response.requestId || null, status: response.status || null });
      return false;
    }
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    const status = response.status === 'approved' ? 'approved' : response.status === 'canceled' ? 'canceled' : 'error';
    if (status === 'approved') this.approved = true;
    this.logger('renderer-response', { requestId: pending.requestId, reason: pending.reason, status, diagnostics: response.diagnostics || null });
    pending.resolve({ ...response, requestId: pending.requestId, reason: pending.reason, status });
    return true;
  }

  reset() {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve({ status: 'canceled', requestId: this.pending.requestId, reason: this.pending.reason, reset: true });
      this.pending = null;
    }
    this.approved = false;
  }
}

async function withBoundedWait(task, timeoutMs, label = 'operation', logger = () => {}) {
  const timeout = Math.max(1, Number(timeoutMs) || 1);
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(task).then(value => ({ status: 'completed', value })),
      new Promise(resolve => {
        timer = setTimeout(() => {
          logger('bounded-wait-timeout', { label, timeoutMs: timeout });
          resolve({ status: 'timeout', label });
        }, timeout);
      })
    ]);
  } catch (error) {
    logger('bounded-wait-error', { label, message: error?.message || String(error) });
    return { status: 'error', label, error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { ShutdownCoordinator, withBoundedWait, DEFAULT_TIMEOUT_MS };
