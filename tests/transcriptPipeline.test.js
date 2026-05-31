'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createTranscriptPipeline,
  normalizeStableMs,
  normalizeTranscriptPayload,
  readStoredTranscript
} = require('../src/main/transcriptPipeline');

function createFakeTimers() {
  let nextId = 1;
  const timers = {};

  return {
    clearTimeoutFn: function clearTimeoutFn(id) {
      delete timers[id];
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
    setTimeoutFn: function setTimeoutFn(callback) {
      const id = nextId;
      nextId += 1;
      timers[id] = callback;
      return id;
    }
  };
}

function run() {
  assert.strictEqual(normalizeTranscriptPayload({ text: '  hello  ' }), 'hello');
  assert.strictEqual(normalizeTranscriptPayload({}), '');
  assert.strictEqual(normalizeTranscriptPayload(null), '');
  assert.strictEqual(normalizeStableMs(100), 100);
  assert.strictEqual(normalizeStableMs(0), 2500);

  const writes = [];
  const pastes = [];
  const finalized = [];
  const timers = createFakeTimers();
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-stt-transcript-'));
  const storagePath = path.join(storageDir, 'last-transcript.json');
  const pipeline = createTranscriptPipeline({
    clipboard: {
      writeText: function writeText(text) {
        writes.push(text);
      }
    },
    clearTimeoutFn: timers.clearTimeoutFn,
    pasteText: function pasteText(text) {
      pastes.push(text);
      return true;
    },
    onFinalized: function onFinalized(payload) {
      finalized.push(payload);
    },
    setTimeoutFn: timers.setTimeoutFn,
    stableMs: 100,
    storagePath: storagePath
  });

  assert.strictEqual(pipeline.handleTranscript({ source: 'test', text: 'hello' }), true);
  assert.deepStrictEqual(writes, []);
  assert.deepStrictEqual(pastes, []);
  assert.strictEqual(pipeline.handleTranscript({ source: 'test', text: 'world' }), true);
  timers.runLatest();

  assert.deepStrictEqual(writes, ['world']);
  assert.deepStrictEqual(pastes, ['world']);
  assert.deepStrictEqual(finalized, [{
    autoPaste: true,
    pasted: true,
    text: 'world'
  }]);
  assert.strictEqual(pipeline.getLastText(), 'world');
  assert.strictEqual(readStoredTranscript(storagePath), 'world');

  assert.strictEqual(pipeline.handleTranscript({ source: 'test', text: 'world' }), false);
  assert.strictEqual(pipeline.finalizeText('world'), false);
  assert.strictEqual(pipeline.copyLastTranscriptToClipboard(), true);
  assert.deepStrictEqual(writes, ['world', 'world']);
  assert.strictEqual(pipeline.finalizeText('world', { force: true }), true);
  assert.deepStrictEqual(writes, ['world', 'world', 'world']);
  assert.deepStrictEqual(pastes, ['world', 'world']);
  assert.deepStrictEqual(finalized[1], {
    autoPaste: true,
    pasted: true,
    text: 'world'
  });

  assert.strictEqual(pipeline.handleTranscript({ source: 'test', text: 'cancel me' }), true);
  assert.strictEqual(pipeline.discardPendingTranscript(), true);
  timers.runLatest();
  assert.deepStrictEqual(writes, ['world', 'world', 'world']);
  assert.deepStrictEqual(pastes, ['world', 'world']);
  assert.strictEqual(pipeline.getLastText(), 'world');
  assert.strictEqual(pipeline.discardPendingTranscript(), false);

  const restoredWrites = [];
  const restoredPipeline = createTranscriptPipeline({
    clipboard: {
      writeText: function writeText(text) {
        restoredWrites.push(text);
      }
    },
    pasteText: function pasteText() {},
    storagePath: storagePath
  });

  assert.strictEqual(restoredPipeline.getLastText(), 'world');
  assert.deepStrictEqual(restoredWrites, ['world']);

  const errors = [];
  const errorPipeline = createTranscriptPipeline({
    clipboard: {
      writeText: function writeText() {
        throw new Error('clipboard failed');
      }
    },
    clearTimeoutFn: timers.clearTimeoutFn,
    onError: function onError(payload) {
      errors.push({
        message: payload.message,
        text: payload.text
      });
    },
    pasteText: function pasteText() {},
    setTimeoutFn: timers.setTimeoutFn,
    stableMs: 100
  });

  assert.strictEqual(errorPipeline.handleTranscript({ source: 'test', text: 'broken' }), true);
  timers.runLatest();
  assert.deepStrictEqual(errors, [{
    message: 'clipboard failed',
    text: 'broken'
  }]);
}

module.exports = {
  run: run
};
