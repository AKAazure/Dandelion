'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createChatGptTranscribeMonitor,
  extractTranscriptTextFromResponseBody,
  isLikelyTranscribeRequest,
  recursiveFindTranscriptText
} = require('../src/main/chatgptTranscribeMonitor');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findSingleRequestDebugDir(rootDir) {
  const dateDirs = fs.readdirSync(rootDir);
  assert.strictEqual(dateDirs.length, 1);
  const requestDirs = fs.readdirSync(path.join(rootDir, dateDirs[0]));
  assert.strictEqual(requestDirs.length, 1);
  return path.join(rootDir, dateDirs[0], requestDirs[0]);
}

function createFakeDebugger(responseBody, requestPostData) {
  const listeners = {};

  return {
    attached: false,
    commands: [],
    attach: function attach(version) {
      this.attached = true;
      this.commands.push(['attach', version]);
    },
    emit: function emit(method, params) {
      if (listeners.message) {
        listeners.message({}, method, params);
      }
    },
    isAttached: function isAttached() {
      return this.attached;
    },
    on: function on(eventName, listener) {
      listeners[eventName] = listener;
      this.commands.push(['on', eventName]);
    },
    removeListener: function removeListener(eventName) {
      delete listeners[eventName];
      this.commands.push(['removeListener', eventName]);
    },
    sendCommand: function sendCommand(command, params) {
      this.commands.push(['sendCommand', command, params || null]);

      if (command === 'Network.getResponseBody') {
        return Promise.resolve(responseBody);
      }

      if (command === 'Network.getRequestPostData') {
        return Promise.resolve({
          postData: requestPostData || ''
        });
      }

      return Promise.resolve({});
    }
  };
}

function buildMultipart(boundary, fileBuffer) {
  return Buffer.concat([
    Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="file"; filename="whisper.webm"\r\n' +
      'Content-Type: audio/webm;codecs=opus\r\n' +
      '\r\n',
      'utf8'
    ),
    fileBuffer,
    Buffer.from(
      '\r\n--' + boundary + '--\r\n',
      'utf8'
    )
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function run() {
  assert.strictEqual(isLikelyTranscribeRequest('https://chatgpt.com/backend-api/transcribe', 'POST'), true);
  assert.strictEqual(isLikelyTranscribeRequest('https://chatgpt.com/backend-api/conversation', 'POST'), false);
  assert.strictEqual(isLikelyTranscribeRequest('https://chatgpt.com/backend-api/transcribe', 'GET'), false);
  assert.strictEqual(recursiveFindTranscriptText({ text: ' hello ' }), 'hello');
  assert.strictEqual(recursiveFindTranscriptText({ data: { transcript: 'world' } }), 'world');
  assert.strictEqual(recursiveFindTranscriptText({ data: { text: 'actual text' }, status: 'ok' }), 'actual text');
  assert.strictEqual(
    extractTranscriptTextFromResponseBody(JSON.stringify({ text: 'network text' }), false),
    'network text'
  );
  assert.strictEqual(
    extractTranscriptTextFromResponseBody(Buffer.from(JSON.stringify({ text: 'base64 text' })).toString('base64'), true),
    'base64 text'
  );

  const started = [];
  const succeeded = [];
  const remoteDebugDir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-stt-remote-debug-'));
  const fakeDebugger = createFakeDebugger({
    base64Encoded: false,
    body: JSON.stringify({
      details: {
        transcript: 'hello from network'
      },
      text: 'short text'
    })
  }, 'remote post data from getRequestPostData');
  const monitor = createChatGptTranscribeMonitor({
    onStarted: function onStarted(payload) {
      started.push(payload.url);
    },
    onSucceeded: function onSucceeded(payload) {
      succeeded.push({
        remoteDebugDir: payload.remoteDebugDir,
        statusCode: payload.statusCode,
        text: payload.text
      });
    },
    remoteDebugLogDir: remoteDebugDir,
    webContents: {
      debugger: fakeDebugger
    }
  });

  assert.strictEqual(monitor.start(), true);
  fakeDebugger.emit('Network.requestWillBeSent', {
    request: {
      headers: {
        authorization: 'Bearer remote-token-for-debug',
        'content-type': 'multipart/form-data; boundary=test'
      },
      method: 'POST',
      postData: 'raw multipart remote request body',
      url: 'https://chatgpt.com/backend-api/transcribe'
    },
    requestId: '1'
  });
  fakeDebugger.emit('Network.responseReceived', {
    requestId: '1',
    response: {
      headers: {
        'content-type': 'application/json',
        'x-debug-remote': 'yes'
      },
      mimeType: 'application/json',
      status: 200,
      statusText: 'OK'
    }
  });
  fakeDebugger.emit('Network.loadingFinished', {
    requestId: '1'
  });
  await sleep(0);
  await sleep(0);

  assert.deepStrictEqual(started, ['https://chatgpt.com/backend-api/transcribe']);
  assert.strictEqual(succeeded.length, 1);
  assert.strictEqual(succeeded[0].statusCode, 200);
  assert.strictEqual(succeeded[0].text, 'short text');
  assert.ok(succeeded[0].remoteDebugDir);

  const requestDebugDir = findSingleRequestDebugDir(remoteDebugDir);
  assert.strictEqual(succeeded[0].remoteDebugDir, requestDebugDir);
  assert.strictEqual(
    readJson(path.join(requestDebugDir, 'request-will-be-sent.json')).params.request.postData,
    'raw multipart remote request body'
  );
  assert.strictEqual(
    readJson(path.join(requestDebugDir, 'request-will-be-sent.json')).params.request.headers.authorization,
    'Bearer remote-token-for-debug'
  );
  assert.strictEqual(
    readJson(path.join(requestDebugDir, 'request-post-data.json')).response.postData,
    'remote post data from getRequestPostData'
  );
  assert.strictEqual(
    readJson(path.join(requestDebugDir, 'response-received.json')).params.response.headers['x-debug-remote'],
    'yes'
  );
  assert.deepStrictEqual(readJson(path.join(requestDebugDir, 'loading-finished.json')).params, {
    requestId: '1'
  });
  assert.deepStrictEqual(readJson(path.join(requestDebugDir, 'response-body.json')).transcript, {
    text: 'short text',
    textLength: 10
  });
  assert.deepStrictEqual(succeeded, [{
    remoteDebugDir: requestDebugDir,
    statusCode: 200,
    text: 'short text'
  }]);
  monitor.stop();

  const replacementRemoteDebugDir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-stt-replacement-debug-'));
  const replacementBoundary = '----WebKitFormBoundaryReplacement';
  const originalUpload = Buffer.from('short-original-upload');
  const replacementUpload = Buffer.from('longer-app-recording-upload');
  const replacementDebugger = createFakeDebugger({
    base64Encoded: false,
    body: JSON.stringify({
      text: 'replacement text'
    })
  }, 'replacement post data');
  const replacementMonitor = createChatGptTranscribeMonitor({
    onSucceeded: function onSucceeded() {},
    remoteDebugLogDir: replacementRemoteDebugDir,
    uploadReplacement: {
      enabled: true,
      getRecording: function getRecording() {
        return Promise.resolve({
          base64: replacementUpload.toString('base64'),
          byteLength: replacementUpload.length,
          chunkCount: 2,
          durationMs: 1234,
          id: 'app-recording-test',
          mimeType: 'audio/webm;codecs=opus',
          ok: true
        });
      }
    },
    webContents: {
      debugger: replacementDebugger
    }
  });

  assert.strictEqual(replacementMonitor.start(), true);
  assert.strictEqual(
    replacementDebugger.commands.some((command) => command[0] === 'sendCommand' && command[1] === 'Fetch.enable'),
    true
  );
  replacementDebugger.emit('Fetch.requestPaused', {
    networkId: '3',
    request: {
      headers: {
        authorization: 'Bearer replacement-token',
        'content-length': String(originalUpload.length),
        'content-type': 'multipart/form-data; boundary=' + replacementBoundary
      },
      method: 'POST',
      postData: buildMultipart(replacementBoundary, originalUpload).toString('base64'),
      url: 'https://chatgpt.com/backend-api/transcribe'
    },
    requestId: 'fetch-3'
  });
  await sleep(0);
  await sleep(0);

  const continueCommand = replacementDebugger.commands.find((command) => {
    return command[0] === 'sendCommand' && command[1] === 'Fetch.continueRequest';
  });
  assert.ok(continueCommand);
  assert.strictEqual(continueCommand[2].requestId, 'fetch-3');
  assert.strictEqual(
    Buffer.from(continueCommand[2].postData, 'base64').indexOf(replacementUpload) !== -1,
    true
  );
  assert.strictEqual(
    Buffer.from(continueCommand[2].postData, 'base64').indexOf(originalUpload),
    -1
  );
  assert.strictEqual(
    continueCommand[2].headers.some((entry) => entry.name.toLowerCase() === 'content-length'),
    false
  );

  replacementDebugger.emit('Network.requestWillBeSent', {
    request: {
      method: 'POST',
      url: 'https://chatgpt.com/backend-api/transcribe'
    },
    requestId: '3'
  });
  replacementDebugger.emit('Network.responseReceived', {
    requestId: '3',
    response: {
      mimeType: 'application/json',
      status: 200,
      statusText: 'OK'
    }
  });
  replacementDebugger.emit('Network.loadingFinished', {
    requestId: '3'
  });
  await sleep(0);
  await sleep(0);

  const replacementRequestDebugDir = findSingleRequestDebugDir(replacementRemoteDebugDir);
  assert.strictEqual(fs.existsSync(path.join(replacementRequestDebugDir, 'app-recording.webm')), true);
  assert.strictEqual(
    fs.readFileSync(path.join(replacementRequestDebugDir, 'app-recording.webm')).equals(replacementUpload),
    true
  );
  assert.strictEqual(
    readJson(path.join(replacementRequestDebugDir, 'request-replacement-decision.json')).replaced,
    true
  );
  assert.strictEqual(
    readJson(path.join(replacementRequestDebugDir, 'request-replacement-new-summary.json')).summary.replacementFileBytes,
    replacementUpload.length
  );
  assert.strictEqual(
    readJson(path.join(replacementRequestDebugDir, 'request-will-be-sent.json')).params.requestId,
    '3'
  );
  replacementMonitor.stop();

  const failed = [];
  const failingDebugger = createFakeDebugger({
    base64Encoded: false,
    body: ''
  });
  const failingMonitor = createChatGptTranscribeMonitor({
    onFailed: function onFailed(payload) {
      failed.push({
        errorText: payload.errorText,
        statusCode: payload.statusCode
      });
    },
    webContents: {
      debugger: failingDebugger
    }
  });

  assert.strictEqual(failingMonitor.start(), true);
  failingDebugger.emit('Network.requestWillBeSent', {
    request: {
      method: 'POST',
      url: 'https://chatgpt.com/backend-api/transcribe'
    },
    requestId: '2'
  });
  failingDebugger.emit('Network.responseReceived', {
    requestId: '2',
    response: {
      status: 500,
      statusText: 'Internal Server Error'
    }
  });
  failingDebugger.emit('Network.loadingFinished', {
    requestId: '2'
  });

  assert.deepStrictEqual(failed, [{
    errorText: 'Internal Server Error',
    statusCode: 500
  }]);
  failingMonitor.stop();
}

module.exports = {
  run: run
};
