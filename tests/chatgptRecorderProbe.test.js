'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  RECORDER_PROBE_INSTALL_SCRIPT,
  RECORDER_PROBE_SNAPSHOT_SCRIPT,
  captureChatGptRecorderProbeSnapshot,
  installChatGptRecorderProbe,
  sanitizePathSegment,
  summarizeRecorderProbeSnapshot
} = require('../src/main/chatgptRecorderProbe');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createLogger() {
  const entries = [];

  return {
    entries: entries,
    debug: function debug(event, details) {
      entries.push(['debug', event, details]);
    },
    info: function info(event, details) {
      entries.push(['info', event, details]);
    },
    warn: function warn(event, details) {
      entries.push(['warn', event, details]);
    }
  };
}

async function run() {
  assert.strictEqual(RECORDER_PROBE_INSTALL_SCRIPT.indexOf('MediaRecorder') !== -1, true);
  assert.strictEqual(RECORDER_PROBE_INSTALL_SCRIPT.indexOf('FormData') !== -1, true);
  assert.strictEqual(RECORDER_PROBE_INSTALL_SCRIPT.indexOf('fetch.transcribe_called') !== -1, true);
  assert.strictEqual(RECORDER_PROBE_SNAPSHOT_SCRIPT.indexOf('__GENERAL_STT_RECORDER_PROBE__') !== -1, true);
  assert.strictEqual(sanitizePathSegment('../after response'), 'after-response');

  assert.deepStrictEqual(summarizeRecorderProbeSnapshot({
    counters: {
      eventsDropped: 2
    },
    events: [{ type: 'a' }, { type: 'b' }],
    installed: true,
    recorders: {
      one: {}
    }
  }), {
    eventCount: 2,
    eventsDropped: 2,
    installed: true,
    recorderCount: 1
  });

  const logger = createLogger();
  const installResult = await installChatGptRecorderProbe({
    logger: logger,
    webContents: {
      executeJavaScript: function executeJavaScript(scriptText, userGesture) {
        assert.strictEqual(scriptText, RECORDER_PROBE_INSTALL_SCRIPT);
        assert.strictEqual(userGesture, true);
        return Promise.resolve({
          installed: true,
          patches: {
            MediaRecorder: true
          }
        });
      },
      isDestroyed: function isDestroyed() {
        return false;
      }
    }
  });

  assert.strictEqual(installResult, true);
  assert.strictEqual(logger.entries.some((entry) => entry[1] === 'recorder_probe.installed'), true);

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-stt-recorder-probe-'));
  const artifactPath = await captureChatGptRecorderProbeSnapshot({
    label: 'after response',
    logger: logger,
    nowFn: () => new Date('2026-06-06T09:00:00.000Z'),
    outputDir: outputDir,
    requestId: '999.1',
    webContents: {
      executeJavaScript: function executeJavaScript(scriptText, userGesture) {
        assert.strictEqual(scriptText, RECORDER_PROBE_SNAPSHOT_SCRIPT);
        assert.strictEqual(userGesture, true);
        return Promise.resolve({
          counters: {
            eventsDropped: 0
          },
          events: [{
            details: {
              data: {
                size: 123,
                type: 'audio/webm;codecs=opus'
              }
            },
            type: 'media_recorder.dataavailable'
          }],
          installed: true,
          recorders: {
            'recorder-1': {
              totalDataAvailableBytes: 123
            }
          }
        });
      },
      isDestroyed: function isDestroyed() {
        return false;
      }
    }
  });

  assert.strictEqual(artifactPath, path.join(outputDir, 'recorder-probe-after-response.json'));
  const artifact = readJson(artifactPath);
  assert.strictEqual(artifact.label, 'after-response');
  assert.strictEqual(artifact.recordedAt, '2026-06-06T09:00:00.000Z');
  assert.strictEqual(artifact.requestId, '999.1');
  assert.strictEqual(artifact.snapshot.events[0].type, 'media_recorder.dataavailable');
  assert.strictEqual(logger.entries.some((entry) => entry[1] === 'recorder_probe.snapshot_written'), true);

  const destroyedResult = await captureChatGptRecorderProbeSnapshot({
    label: 'destroyed',
    logger: logger,
    outputDir: outputDir,
    requestId: '999.2',
    webContents: {
      executeJavaScript: function executeJavaScript() {
        throw new Error('should not execute');
      },
      isDestroyed: function isDestroyed() {
        return true;
      }
    }
  });

  assert.strictEqual(destroyedResult, null);

  const failedResult = await captureChatGptRecorderProbeSnapshot({
    label: 'failed',
    logger: logger,
    nowFn: () => new Date('2026-06-06T09:00:01.000Z'),
    outputDir: outputDir,
    requestId: '999.3',
    webContents: {
      executeJavaScript: function executeJavaScript() {
        return Promise.reject(new Error('renderer failed'));
      }
    }
  });

  assert.strictEqual(failedResult, null);
  const failedArtifact = readJson(path.join(outputDir, 'recorder-probe-failed-failed.json'));
  assert.strictEqual(failedArtifact.error, 'renderer failed');
  assert.strictEqual(failedArtifact.requestId, '999.3');
}

module.exports = {
  run: run
};
