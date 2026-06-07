'use strict';

const assert = require('assert');

const { createChatGptShortcutBridge } = require('../src/shortcut/chatgptShortcutBridge');

function createFakeGlobalShortcut() {
  const handlers = {};

  return {
    press: function press(accelerator) {
      assert.strictEqual(typeof handlers[accelerator], 'function');
      return handlers[accelerator]();
    },
    register: function register(accelerator, callback) {
      handlers[accelerator] = callback;
      return true;
    },
    unregister: function unregister(accelerator) {
      delete handlers[accelerator];
    }
  };
}

function createFakeWebContents() {
  return {
    events: [],
    focusCount: 0,
    focus: function focus() {
      this.focusCount += 1;
    },
    isDestroyed: function isDestroyed() {
      return false;
    },
    sendInputEvent: function sendInputEvent(event) {
      this.events.push(event);
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function run() {
  const calls = [];
  const globalShortcut = createFakeGlobalShortcut();
  const webContents = createFakeWebContents();
  let resolveReady = null;
  const readyToSend = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const bridge = createChatGptShortcutBridge({
    afterSend: function afterSend(context) {
      calls.push(['afterSend', context.marker]);
    },
    beforeSend: function beforeSend() {
      calls.push(['beforeSend']);
      return {
        dispatchDelayMs: 10,
        marker: 'ready',
        readyToSend: readyToSend
      };
    },
    customBinding: 'Alt+Shift+R',
    focusBeforeSend: true,
    globalShortcut: globalShortcut,
    webContents: webContents
  });

  assert.strictEqual(bridge.start(), true);
  assert.strictEqual(globalShortcut.press('Alt+Shift+R'), true);
  assert.deepStrictEqual(calls, [['beforeSend']]);
  assert.deepStrictEqual(webContents.events, []);
  assert.strictEqual(webContents.focusCount, 0);

  resolveReady();
  await sleep(30);

  assert.strictEqual(webContents.focusCount, 1);
  assert.deepStrictEqual(webContents.events, [
    {
      type: 'rawKeyDown',
      keyCode: 'D',
      modifiers: ['control', 'shift']
    }
  ]);
  assert.deepStrictEqual(calls, [
    ['beforeSend'],
    ['afterSend', 'ready']
  ]);
}

module.exports = {
  run: run
};
