'use strict';

const assert = require('assert');

const {
  DICTATION_PHASES,
  calculateTranscribeRequestTimeoutMs,
  createDictationSession
} = require('../src/main/dictationSession');

function createFakeTimers() {
  let nextId = 1;
  const timers = {};

  return {
    clearTimeoutFn: function clearTimeoutFn(id) {
      delete timers[id];
    },
    getLatestTimeoutMs: function getLatestTimeoutMs() {
      const ids = Object.keys(timers);
      const id = ids[ids.length - 1];

      if (!id) {
        return 0;
      }

      return timers[id].timeoutMs;
    },
    runAll: function runAll() {
      Object.keys(timers).forEach((id) => {
        const callback = timers[id];
        delete timers[id];
        callback();
      });
    },
    runLatest: function runLatest() {
      const ids = Object.keys(timers);
      const id = ids[ids.length - 1];

      if (!id) {
        return;
      }

      const callback = timers[id];
      delete timers[id];
      callback();
    },
    setTimeoutFn: function setTimeoutFn(callback, timeoutMs) {
      const id = nextId;
      nextId += 1;
      timers[id] = callback;
      timers[id].timeoutMs = timeoutMs;
      return id;
    }
  };
}

function run() {
  const retryTimers = createFakeTimers();
  const retries = [];
  const retrySession = createDictationSession({
    maxStartRetries: 1,
    retryStart: function retryStart(payload) {
      retries.push(payload);
    },
    setTimeoutFn: retryTimers.setTimeoutFn,
    clearTimeoutFn: retryTimers.clearTimeoutFn,
    startConfirmationMs: 10
  });

  retrySession.markStartShortcutSent();
  retryTimers.runLatest();

  assert.deepStrictEqual(retries, [{
    reason: 'media_request_not_observed',
    retry: 1
  }]);

  retrySession.markStartShortcutSent();
  assert.strictEqual(retrySession.markTrustedMediaRequest(), true);
  retryTimers.runAll();
  assert.strictEqual(retrySession.getSnapshot().mediaRequestSeen, true);

  const missingRequestTimers = createFakeTimers();
  const missingRequests = [];
  const missingRequestSession = createDictationSession({
    clearTimeoutFn: missingRequestTimers.clearTimeoutFn,
    onMissingTranscribeRequest: function onMissingTranscribeRequest(snapshot) {
      missingRequests.push(snapshot);
    },
    setTimeoutFn: missingRequestTimers.setTimeoutFn,
    startConfirmationMs: 0,
    transcribeRequestTimeoutMs: 10
  });

  assert.strictEqual(missingRequestSession.canSendStop(), false);
  missingRequestSession.markStartShortcutSent();
  assert.strictEqual(missingRequestSession.canSendStop(), true);
  assert.strictEqual(missingRequestSession.markStopShortcutSent(), true);
  missingRequestTimers.runLatest();

  assert.strictEqual(missingRequests.length, 1);
  assert.strictEqual(missingRequests[0].phase, DICTATION_PHASES.PROCESSING);
  assert.strictEqual(missingRequests[0].transcribeRequestSeen, false);

  const requestSeenTimers = createFakeTimers();
  const requestSeenMissing = [];
  const requestSeenSession = createDictationSession({
    clearTimeoutFn: requestSeenTimers.clearTimeoutFn,
    onMissingTranscribeRequest: function onMissingTranscribeRequest(snapshot) {
      requestSeenMissing.push(snapshot);
    },
    setTimeoutFn: requestSeenTimers.setTimeoutFn,
    startConfirmationMs: 0,
    transcribeRequestTimeoutMs: 10
  });

  requestSeenSession.markStartShortcutSent();
  requestSeenSession.markStopShortcutSent();
  assert.strictEqual(requestSeenSession.markTranscribeRequestStarted({ requestId: 'abc' }), true);
  requestSeenTimers.runAll();

  assert.deepStrictEqual(requestSeenMissing, []);
  assert.strictEqual(requestSeenSession.getSnapshot().phase, DICTATION_PHASES.WAITING_RESPONSE);
  assert.strictEqual(requestSeenSession.getSnapshot().observedTranscribeRequestId, 'abc');

  requestSeenSession.reset();
  assert.strictEqual(requestSeenSession.getSnapshot().phase, DICTATION_PHASES.IDLE);
  assert.strictEqual(requestSeenSession.getSnapshot().observedTranscribeRequestId, '');

  assert.strictEqual(calculateTranscribeRequestTimeoutMs(0), 15000);
  assert.strictEqual(calculateTranscribeRequestTimeoutMs(30000), 45000);
  assert.strictEqual(calculateTranscribeRequestTimeoutMs(60989), 75989);
  assert.strictEqual(calculateTranscribeRequestTimeoutMs(85563), 100563);
  assert.strictEqual(calculateTranscribeRequestTimeoutMs(113122), 128122);
  assert.strictEqual(calculateTranscribeRequestTimeoutMs(150000), 165000);
  assert.strictEqual(calculateTranscribeRequestTimeoutMs(160766), 175766);
  assert.strictEqual(calculateTranscribeRequestTimeoutMs(600000), 615000);
  assert.strictEqual(calculateTranscribeRequestTimeoutMs(150000, {
    baseTimeoutMs: 0
  }), 0);

  const dynamicTimers = createFakeTimers();
  let nowMs = 1000;
  const dynamicSession = createDictationSession({
    clearTimeoutFn: dynamicTimers.clearTimeoutFn,
    nowFn: function nowFn() {
      return nowMs;
    },
    setTimeoutFn: dynamicTimers.setTimeoutFn,
    startConfirmationMs: 0
  });

  dynamicSession.markStartShortcutSent();
  nowMs += 150000;
  assert.strictEqual(dynamicSession.markStopShortcutSent(), true);
  assert.strictEqual(dynamicTimers.getLatestTimeoutMs(), 165000);
  assert.strictEqual(dynamicSession.getSnapshot().listeningDurationMs, 150000);
  assert.strictEqual(dynamicSession.getSnapshot().transcribeRequestTimeoutMs, 165000);
}

module.exports = {
  run: run
};
