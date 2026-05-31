'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  buildPermissionKey,
  createPermissionRequestHandler,
  createPersistentPermissionStore,
  isTrustedAppFileUrl,
  isTrustedChatGptOrigin,
  originFromUrl,
  readPermissionState,
  shouldShowForLoginUrl
} = require('../src/main/permissions');

async function run() {
  assert.strictEqual(isTrustedChatGptOrigin('https://chatgpt.com'), true);
  assert.strictEqual(isTrustedChatGptOrigin('https://auth.openai.com/login'), true);
  assert.strictEqual(isTrustedChatGptOrigin('https://example.com'), false);
  assert.strictEqual(isTrustedAppFileUrl(
    pathToFileURL(path.join('/tmp', 'general-stt', 'src', 'renderer', 'miniOverlay.html')).href,
    path.join('/tmp', 'general-stt')
  ), true);
  assert.strictEqual(isTrustedAppFileUrl(
    pathToFileURL(path.join('/tmp', 'other-app', 'miniOverlay.html')).href,
    path.join('/tmp', 'general-stt')
  ), false);
  assert.strictEqual(originFromUrl('https://chatgpt.com/c/abc'), 'https://chatgpt.com');
  assert.strictEqual(buildPermissionKey('media', 'https://chatgpt.com/c/abc'), 'media:https://chatgpt.com');
  assert.strictEqual(shouldShowForLoginUrl('https://chatgpt.com/auth/login'), true);
  assert.strictEqual(shouldShowForLoginUrl('https://auth.openai.com/u/login'), true);
  assert.strictEqual(shouldShowForLoginUrl('https://chatgpt.com/'), false);

  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-stt-permissions-'));
  const storagePath = path.join(storageDir, 'permissions.json');
  const store = createPersistentPermissionStore(storagePath);

  let showCount = 0;
  let callbackValue = null;
  const trustedMediaRequests = [];
  const permissionLogCalls = [];
  const permissionLogger = {
    debug: function debug(event, details) {
      permissionLogCalls.push(['debug', event, details]);
    },
    error: function error(event, details) {
      permissionLogCalls.push(['error', event, details]);
    },
    info: function info(event, details) {
      permissionLogCalls.push(['info', event, details]);
    },
    warn: function warn(event, details) {
      permissionLogCalls.push(['warn', event, details]);
    }
  };
  const handler = createPermissionRequestHandler({
    dialog: {
      showMessageBox: function showMessageBox() {
        return Promise.resolve({ response: 0 });
      }
    },
    logger: permissionLogger,
    onTrustedMediaRequest: function onTrustedMediaRequest(payload) {
      trustedMediaRequests.push(payload.requestingUrl);
    },
    permissionStore: store,
    showPermissionWindow: function showPermissionWindow() {
      showCount += 1;
    },
    trustedFileRoot: path.join('/tmp', 'general-stt')
  });

  await new Promise((resolve) => {
    handler(null, 'media', function callback(value) {
      callbackValue = value;
      resolve();
    }, {
      requestingUrl: pathToFileURL(path.join('/tmp', 'general-stt', 'src', 'renderer', 'miniOverlay.html')).href
    });
  });

  assert.strictEqual(showCount, 0);
  assert.strictEqual(callbackValue, true);

  await new Promise((resolve) => {
    handler(null, 'media', function callback(value) {
      callbackValue = value;
      resolve();
    }, {
      requestingUrl: 'https://chatgpt.com/'
    });
  });

  assert.strictEqual(showCount, 1);
  assert.strictEqual(callbackValue, true);
  assert.strictEqual(store.hasGrant('media', 'https://chatgpt.com/'), true);
  assert.strictEqual(readPermissionState(storagePath).grants['media:https://chatgpt.com'], true);
  assert.deepStrictEqual(trustedMediaRequests, ['https://chatgpt.com/']);

  await new Promise((resolve) => {
    handler(null, 'media', function callback(value) {
      callbackValue = value;
      resolve();
    }, {
      requestingUrl: 'https://chatgpt.com/'
    });
  });

  assert.strictEqual(showCount, 1);
  assert.strictEqual(callbackValue, true);
  assert.deepStrictEqual(trustedMediaRequests, [
    'https://chatgpt.com/',
    'https://chatgpt.com/'
  ]);

  const onceHandler = createPermissionRequestHandler({
    dialog: {
      showMessageBox: function showMessageBox() {
        return Promise.resolve({ response: 1 });
      }
    },
    permissionStore: createPersistentPermissionStore(path.join(storageDir, 'once.json')),
    showPermissionWindow: function showPermissionWindow() {}
  });

  await new Promise((resolve) => {
    onceHandler(null, 'media', function callback(value) {
      callbackValue = value;
      resolve();
    }, {
      requestingUrl: 'https://chatgpt.com/'
    });
  });

  assert.strictEqual(callbackValue, true);

  handler(null, 'media', function callback(value) {
    callbackValue = value;
  }, {
    requestingUrl: 'https://example.com/'
  });
  assert.strictEqual(callbackValue, false);
  assert.strictEqual(permissionLogCalls.some((call) => {
    return call[0] === 'debug' && call[1] === 'permission.request_denied_untrusted';
  }), true);
  assert.strictEqual(permissionLogCalls.some((call) => {
    return call[0] === 'warn' && call[1] === 'permission.request_denied_untrusted';
  }), false);
}

module.exports = {
  run: run
};
