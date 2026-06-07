'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  captureChatGptDomSnapshot,
  sanitizePathSegment,
  summarizeSnapshot
} = require('../src/main/chatgptDomSnapshot');

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
  assert.strictEqual(sanitizePathSegment(' after response '), 'after-response');
  assert.strictEqual(sanitizePathSegment('../bad path'), 'bad-path');

  assert.deepStrictEqual(summarizeSnapshot({
    inputCandidates: [{ text: 'a' }],
    latestInputTextLength: 10,
    latestUserMessageTextLength: 20,
    selectedTextLength: 30,
    userMessageCandidates: [{ text: 'b' }, { text: 'c' }]
  }), {
    inputCandidateCount: 1,
    latestInputTextLength: 10,
    latestUserMessageTextLength: 20,
    selectedTextLength: 30,
    userMessageCandidateCount: 2
  });

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-stt-dom-snapshot-'));
  const logger = createLogger();
  const artifactPath = await captureChatGptDomSnapshot({
    label: 'after response',
    logger: logger,
    nowFn: () => new Date('2026-06-06T08:00:00.000Z'),
    outputDir: outputDir,
    requestId: '123.4',
    webContents: {
      executeJavaScript: function executeJavaScript(scriptText, userGesture) {
        assert.strictEqual(scriptText.indexOf('captureGeneralSttDomSnapshot') !== -1, true);
        assert.strictEqual(userGesture, true);
        return Promise.resolve({
          inputCandidates: [{
            selector: '#prompt-textarea',
            text: 'dom input text',
            textLength: 14
          }],
          latestInputText: 'dom input text',
          latestInputTextLength: 14,
          latestUserMessageText: '',
          latestUserMessageTextLength: 0,
          selectedText: 'dom input text',
          selectedTextLength: 14,
          userMessageCandidates: []
        });
      },
      isDestroyed: function isDestroyed() {
        return false;
      }
    }
  });

  assert.strictEqual(artifactPath, path.join(outputDir, 'dom-snapshot-after-response.json'));
  const artifact = readJson(artifactPath);
  assert.strictEqual(artifact.label, 'after-response');
  assert.strictEqual(artifact.recordedAt, '2026-06-06T08:00:00.000Z');
  assert.strictEqual(artifact.requestId, '123.4');
  assert.strictEqual(artifact.snapshot.selectedText, 'dom input text');
  assert.strictEqual(logger.entries.some((entry) => entry[1] === 'transcript.dom_snapshot.written'), true);

  const destroyedResult = await captureChatGptDomSnapshot({
    label: 'destroyed',
    logger: logger,
    outputDir: outputDir,
    requestId: '123.5',
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

  const failedResult = await captureChatGptDomSnapshot({
    label: 'failed',
    logger: logger,
    nowFn: () => new Date('2026-06-06T08:00:01.000Z'),
    outputDir: outputDir,
    requestId: '123.6',
    webContents: {
      executeJavaScript: function executeJavaScript() {
        return Promise.reject(new Error('renderer unavailable'));
      }
    }
  });

  assert.strictEqual(failedResult, null);
  const failedArtifact = readJson(path.join(outputDir, 'dom-snapshot-failed-failed.json'));
  assert.strictEqual(failedArtifact.error, 'renderer unavailable');
  assert.strictEqual(failedArtifact.requestId, '123.6');
}

module.exports = {
  run: run
};
