'use strict';

const assert = require('assert');

const {
  buildWebKeyEvents,
  createChatGptShortcutBridge,
  normalizeElectronAccelerator,
  normalizeWebChord
} = require('../src/shortcut/chatgptShortcutBridge');

function createFakeGlobalShortcut(registerResult) {
  const handlers = {};
  const calls = [];

  return {
    calls: calls,
    press: function press(accelerator) {
      assert.strictEqual(typeof handlers[accelerator], 'function');
      return handlers[accelerator]();
    },
    register: function register(accelerator, callback) {
      calls.push(['register', accelerator]);

      if (registerResult instanceof Error) {
        throw registerResult;
      }

      if (registerResult === false) {
        return false;
      }

      handlers[accelerator] = callback;
      return true;
    },
    unregister: function unregister(accelerator) {
      calls.push(['unregister', accelerator]);
      delete handlers[accelerator];
    }
  };
}

function createFakeWebContents() {
  return {
    destroyed: false,
    events: [],
    focusCount: 0,
    focus: function focus() {
      this.focusCount += 1;
    },
    isDestroyed: function isDestroyed() {
      return this.destroyed;
    },
    sendInputEvent: function sendInputEvent(event) {
      this.events.push(event);
    }
  };
}

function test(name, fn) {
  try {
    fn();
    console.log('ok - ' + name);
  } catch (error) {
    console.error('not ok - ' + name);
    throw error;
  }
}

test('normalizes user binding into an Electron accelerator', function () {
  assert.strictEqual(normalizeElectronAccelerator('ctrl + shift + r'), 'Control+Shift+R');
  assert.strictEqual(normalizeElectronAccelerator('Win+Alt+D'), 'Super+Alt+D');
  assert.strictEqual(normalizeElectronAccelerator('F1'), 'F1');
  assert.strictEqual(normalizeElectronAccelerator('Ctrl+F1'), 'Control+F1');
  assert.strictEqual(normalizeElectronAccelerator('Alt+Comma'), 'Alt+,');
  assert.strictEqual(normalizeElectronAccelerator('Alt+Period'), 'Alt+.');
  assert.strictEqual(normalizeElectronAccelerator('Shift+LessThan'), 'Shift+<');
  assert.strictEqual(normalizeElectronAccelerator('Shift+GreaterThan'), 'Shift+>');
  assert.strictEqual(normalizeElectronAccelerator('Escape'), 'Esc');
  assert.strictEqual(normalizeElectronAccelerator('Ctrl+Alt+Escape'), 'Control+Alt+Esc');
  assert.throws(function normalizeFnBinding() {
    normalizeElectronAccelerator('Fn+F1');
  }, /Fn key is not supported/);
});

test('normalizes ChatGPT target chord into webContents modifier format', function () {
  assert.deepStrictEqual(normalizeWebChord('Ctrl+Shift+D'), {
    keyCode: 'D',
    modifiers: ['control', 'shift']
  });
  assert.deepStrictEqual(normalizeWebChord('Escape'), {
    keyCode: 'Escape',
    modifiers: []
  });
});

test('builds keyDown and keyUp events for the target chord', function () {
  assert.deepStrictEqual(buildWebKeyEvents('Ctrl+Shift+D'), [
    {
      type: 'keyDown',
      keyCode: 'D',
      modifiers: ['control', 'shift']
    },
    {
      type: 'keyUp',
      keyCode: 'D',
      modifiers: ['control', 'shift']
    }
  ]);
});

test('builds Escape key events for cancel dictation', function () {
  assert.deepStrictEqual(buildWebKeyEvents('Escape'), [
    {
      type: 'keyDown',
      keyCode: 'Escape',
      modifiers: []
    },
    {
      type: 'keyUp',
      keyCode: 'Escape',
      modifiers: []
    }
  ]);
});

test('maps custom host binding to ChatGPT Ctrl+Shift+D web events', function () {
  const globalShortcut = createFakeGlobalShortcut();
  const webContents = createFakeWebContents();
  const bridge = createChatGptShortcutBridge({
    customBinding: 'Alt+Shift+R',
    globalShortcut: globalShortcut,
    webContents: webContents
  });

  assert.strictEqual(bridge.start(), true);
  assert.deepStrictEqual(globalShortcut.calls, [['register', 'Alt+Shift+R']]);
  assert.strictEqual(bridge.isRegistered(), true);

  assert.strictEqual(globalShortcut.press('Alt+Shift+R'), true);
  assert.strictEqual(webContents.focusCount, 0);
  assert.deepStrictEqual(webContents.events, [
    {
      type: 'keyDown',
      keyCode: 'D',
      modifiers: ['control', 'shift']
    },
    {
      type: 'keyUp',
      keyCode: 'D',
      modifiers: ['control', 'shift']
    }
  ]);
});

test('can focus webContents before sending the ChatGPT shortcut when requested', function () {
  const globalShortcut = createFakeGlobalShortcut();
  const webContents = createFakeWebContents();
  const bridge = createChatGptShortcutBridge({
    customBinding: 'Alt+Shift+R',
    focusBeforeSend: true,
    globalShortcut: globalShortcut,
    webContents: webContents
  });

  bridge.start();
  assert.strictEqual(globalShortcut.press('Alt+Shift+R'), true);
  assert.strictEqual(webContents.focusCount, 1);
});

test('runs beforeSend and afterSend around web shortcut events', function () {
  const calls = [];
  const globalShortcut = createFakeGlobalShortcut();
  const webContents = createFakeWebContents();
  const bridge = createChatGptShortcutBridge({
    afterSend: function afterSend(context) {
      calls.push(['afterSend', context.savedWindow]);
    },
    beforeSend: function beforeSend(details) {
      calls.push(['beforeSend', details.accelerator]);
      return {
        savedWindow: '12345'
      };
    },
    customBinding: 'Alt+Shift+R',
    globalShortcut: globalShortcut,
    webContents: webContents
  });

  bridge.start();
  assert.strictEqual(globalShortcut.press('Alt+Shift+R'), true);
  assert.deepStrictEqual(calls, [
    ['beforeSend', 'Alt+Shift+R'],
    ['afterSend', '12345']
  ]);
});

test('can skip sending web events from beforeSend', function () {
  const calls = [];
  const globalShortcut = createFakeGlobalShortcut();
  const webContents = createFakeWebContents();
  const bridge = createChatGptShortcutBridge({
    afterSend: function afterSend(context) {
      calls.push(['afterSend', context.skipReason]);
    },
    beforeSend: function beforeSend() {
      return {
        skipReason: 'not_listening',
        skipSend: true
      };
    },
    customBinding: 'Alt+Shift+S',
    globalShortcut: globalShortcut,
    webContents: webContents
  });

  bridge.start();
  assert.strictEqual(globalShortcut.press('Alt+Shift+S'), false);
  assert.deepStrictEqual(webContents.events, []);
  assert.deepStrictEqual(calls, [
    ['afterSend', 'not_listening']
  ]);
});

test('does not register the same binding twice', function () {
  const globalShortcut = createFakeGlobalShortcut();
  const webContents = createFakeWebContents();
  const bridge = createChatGptShortcutBridge({
    customBinding: 'Alt+Shift+R',
    globalShortcut: globalShortcut,
    webContents: webContents
  });

  assert.strictEqual(bridge.start(), true);
  assert.strictEqual(bridge.start(), true);
  assert.deepStrictEqual(globalShortcut.calls, [['register', 'Alt+Shift+R']]);
});

test('registers correctly when start is called without controller this binding', function () {
  const globalShortcut = createFakeGlobalShortcut();
  const webContents = createFakeWebContents();
  const bridge = createChatGptShortcutBridge({
    customBinding: 'Alt+Shift+R',
    globalShortcut: globalShortcut,
    webContents: webContents
  });
  const start = bridge.start;

  assert.strictEqual(start(), true);
  assert.strictEqual(globalShortcut.press('Alt+Shift+R'), true);
  assert.deepStrictEqual(webContents.events, [
    {
      type: 'keyDown',
      keyCode: 'D',
      modifiers: ['control', 'shift']
    },
    {
      type: 'keyUp',
      keyCode: 'D',
      modifiers: ['control', 'shift']
    }
  ]);
});

test('unregisters the host binding on stop', function () {
  const globalShortcut = createFakeGlobalShortcut();
  const webContents = createFakeWebContents();
  const bridge = createChatGptShortcutBridge({
    customBinding: 'Alt+Shift+R',
    globalShortcut: globalShortcut,
    webContents: webContents
  });

  bridge.start();
  bridge.stop();

  assert.strictEqual(bridge.isRegistered(), false);
  assert.deepStrictEqual(globalShortcut.calls, [
    ['register', 'Alt+Shift+R'],
    ['unregister', 'Alt+Shift+R']
  ]);
});

test('returns false when Electron refuses to register the binding', function () {
  const globalShortcut = createFakeGlobalShortcut(false);
  const webContents = createFakeWebContents();
  const bridge = createChatGptShortcutBridge({
    customBinding: 'Alt+Shift+R',
    globalShortcut: globalShortcut,
    webContents: webContents
  });

  assert.strictEqual(bridge.start(), false);
  assert.strictEqual(bridge.isRegistered(), false);
  assert.deepStrictEqual(globalShortcut.calls, [['register', 'Alt+Shift+R']]);
});

test('returns false when Electron throws while registering the binding', function () {
  const globalShortcut = createFakeGlobalShortcut(new TypeError('conversion failure'));
  const webContents = createFakeWebContents();
  const bridge = createChatGptShortcutBridge({
    customBinding: 'Alt+Comma',
    globalShortcut: globalShortcut,
    webContents: webContents
  });

  assert.strictEqual(bridge.start(), false);
  assert.strictEqual(bridge.isRegistered(), false);
  assert.deepStrictEqual(globalShortcut.calls, [['register', 'Alt+,']]);
});

test('does not send web events after webContents is destroyed', function () {
  const globalShortcut = createFakeGlobalShortcut();
  const webContents = createFakeWebContents();
  const bridge = createChatGptShortcutBridge({
    customBinding: 'Alt+Shift+R',
    globalShortcut: globalShortcut,
    webContents: webContents
  });

  webContents.destroyed = true;

  assert.strictEqual(bridge.trigger(), false);
  assert.strictEqual(webContents.focusCount, 0);
  assert.deepStrictEqual(webContents.events, []);
});
