'use strict';

const assert = require('assert');

const {
  createChatGptTranscribeMonitor,
  extractTranscriptTextFromResponseBody,
  isLikelyTranscribeRequest,
  recursiveFindTranscriptText
} = require('../src/main/chatgptTranscribeMonitor');

function createFakeDebugger(responseBody) {
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

      return Promise.resolve({});
    }
  };
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
  const fakeDebugger = createFakeDebugger({
    base64Encoded: false,
    body: JSON.stringify({ text: 'hello from network' })
  });
  const monitor = createChatGptTranscribeMonitor({
    onStarted: function onStarted(payload) {
      started.push(payload.url);
    },
    onSucceeded: function onSucceeded(payload) {
      succeeded.push({
        statusCode: payload.statusCode,
        text: payload.text
      });
    },
    webContents: {
      debugger: fakeDebugger
    }
  });

  assert.strictEqual(monitor.start(), true);
  fakeDebugger.emit('Network.requestWillBeSent', {
    request: {
      method: 'POST',
      url: 'https://chatgpt.com/backend-api/transcribe'
    },
    requestId: '1'
  });
  fakeDebugger.emit('Network.responseReceived', {
    requestId: '1',
    response: {
      mimeType: 'application/json',
      status: 200,
      statusText: 'OK'
    }
  });
  fakeDebugger.emit('Network.loadingFinished', {
    requestId: '1'
  });
  await sleep(0);

  assert.deepStrictEqual(started, ['https://chatgpt.com/backend-api/transcribe']);
  assert.deepStrictEqual(succeeded, [{
    statusCode: 200,
    text: 'hello from network'
  }]);
  monitor.stop();

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
