'use strict';

const assert = require('assert');

const {
  APP_RECORDER_START_SCRIPT,
  APP_RECORDER_STOP_SCRIPT,
  normalizeRecordingResult,
  startChatGptAppRecorder,
  stopChatGptAppRecorder
} = require('../src/main/chatgptAppRecorder');

function createLogger() {
  const entries = [];

  return {
    entries: entries,
    info: function info(event, details) {
      entries.push(['info', event, details]);
    },
    warn: function warn(event, details) {
      entries.push(['warn', event, details]);
    }
  };
}

async function run() {
  assert.strictEqual(APP_RECORDER_START_SCRIPT.indexOf('__GENERAL_STT_APP_RECORDER__') !== -1, true);
  assert.strictEqual(APP_RECORDER_START_SCRIPT.indexOf('MediaRecorder') !== -1, true);
  assert.strictEqual(APP_RECORDER_STOP_SCRIPT.indexOf('FileReader') !== -1, true);

  assert.deepStrictEqual(normalizeRecordingResult({
    base64: Buffer.from('abc').toString('base64'),
    byteLength: 3,
    chunkCount: 1,
    durationMs: 100,
    events: [{ type: 'stop' }],
    id: 'recording-1',
    mimeType: 'audio/webm;codecs=opus',
    ok: true,
    status: 'stopped',
    totalBytes: 3
  }), {
    ok: true,
    base64: Buffer.from('abc').toString('base64'),
    byteLength: 3,
    chunkCount: 1,
    durationMs: 100,
    error: '',
    events: [{ type: 'stop' }],
    filename: 'whisper.webm',
    id: 'recording-1',
    mimeType: 'audio/webm;codecs=opus',
    startedAt: '',
    status: 'stopped',
    stoppedAt: '',
    totalBytes: 3
  });

  const logger = createLogger();
  const startResult = await startChatGptAppRecorder({
    logger: logger,
    webContents: {
      executeJavaScript: function executeJavaScript(scriptText, userGesture) {
        assert.strictEqual(scriptText, APP_RECORDER_START_SCRIPT);
        assert.strictEqual(userGesture, true);
        return Promise.resolve({
          id: 'recording-1',
          mimeType: 'audio/webm;codecs=opus',
          ok: true,
          status: 'recording'
        });
      },
      isDestroyed: function isDestroyed() {
        return false;
      }
    }
  });

  assert.strictEqual(startResult.ok, true);
  assert.strictEqual(logger.entries.some((entry) => entry[1] === 'app_recorder.started'), true);

  const stopResult = await stopChatGptAppRecorder({
    logger: logger,
    webContents: {
      executeJavaScript: function executeJavaScript(scriptText, userGesture) {
        assert.strictEqual(scriptText, APP_RECORDER_STOP_SCRIPT);
        assert.strictEqual(userGesture, true);
        return Promise.resolve({
          base64: Buffer.from('webm').toString('base64'),
          byteLength: 4,
          chunkCount: 2,
          durationMs: 300,
          id: 'recording-1',
          mimeType: 'audio/webm',
          ok: true,
          status: 'stopped'
        });
      },
      isDestroyed: function isDestroyed() {
        return false;
      }
    }
  });

  assert.strictEqual(stopResult.ok, true);
  assert.strictEqual(stopResult.byteLength, 4);
  assert.strictEqual(logger.entries.some((entry) => entry[1] === 'app_recorder.stopped'), true);

  const destroyedResult = await startChatGptAppRecorder({
    webContents: {
      executeJavaScript: function executeJavaScript() {
        throw new Error('should not execute');
      },
      isDestroyed: function isDestroyed() {
        return true;
      }
    }
  });

  assert.strictEqual(destroyedResult.ok, false);
}

module.exports = {
  run: run
};
