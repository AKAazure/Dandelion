'use strict';

const assert = require('assert');
const EventEmitter = require('events');

const {
  installAppRuntimeDiagnostics,
  installWindowRuntimeDiagnostics,
  normalizeGoneDetails
} = require('../src/main/runtimeDiagnostics');

function createLogger() {
  return {
    entries: [],
    debug: function debug(event, details) {
      this.entries.push(['debug', event, details || {}]);
    },
    error: function error(event, details) {
      this.entries.push(['error', event, details || {}]);
    },
    info: function info(event, details) {
      this.entries.push(['info', event, details || {}]);
    },
    warn: function warn(event, details) {
      this.entries.push(['warn', event, details || {}]);
    }
  };
}

function createWindow(url) {
  const browserWindow = new EventEmitter();
  const webContents = new EventEmitter();

  webContents.getURL = function getURL() {
    return url;
  };
  browserWindow.webContents = webContents;

  return browserWindow;
}

function run() {
  assert.deepStrictEqual(normalizeGoneDetails({
    exitCode: 9,
    ignored: true,
    name: 'Utility',
    reason: 'crashed',
    serviceName: 'network.mojom.NetworkService',
    type: 'Utility'
  }), {
    exitCode: 9,
    name: 'Utility',
    reason: 'crashed',
    serviceName: 'network.mojom.NetworkService',
    type: 'Utility'
  });

  const appLogger = createLogger();
  const app = new EventEmitter();

  assert.strictEqual(installAppRuntimeDiagnostics({
    app: app,
    logger: appLogger
  }), true);
  app.emit('child-process-gone', {}, {
    exitCode: 1,
    reason: 'abnormal-exit',
    type: 'GPU'
  });
  assert.deepStrictEqual(appLogger.entries, [[
    'error',
    'runtime.child_process.gone',
    {
      exitCode: 1,
      reason: 'abnormal-exit',
      type: 'GPU'
    }
  ]]);

  const windowLogger = createLogger();
  const browserWindow = createWindow('https://chatgpt.com/');

  assert.strictEqual(installWindowRuntimeDiagnostics({
    browserWindow: browserWindow,
    label: 'chatgpt',
    logger: windowLogger
  }), true);
  browserWindow.emit('unresponsive');
  browserWindow.emit('responsive');
  browserWindow.webContents.emit('render-process-gone', {}, {
    exitCode: 7,
    reason: 'oom'
  });
  browserWindow.webContents.emit('unresponsive');
  browserWindow.webContents.emit('responsive');

  assert.deepStrictEqual(windowLogger.entries, [
    [
      'error',
      'runtime.window.unresponsive',
      {
        label: 'chatgpt'
      }
    ],
    [
      'info',
      'runtime.window.responsive',
      {
        label: 'chatgpt'
      }
    ],
    [
      'error',
      'runtime.renderer.gone',
      {
        exitCode: 7,
        label: 'chatgpt',
        reason: 'oom',
        url: 'https://chatgpt.com/'
      }
    ],
    [
      'error',
      'runtime.web_contents.unresponsive',
      {
        label: 'chatgpt',
        url: 'https://chatgpt.com/'
      }
    ],
    [
      'info',
      'runtime.web_contents.responsive',
      {
        label: 'chatgpt',
        url: 'https://chatgpt.com/'
      }
    ]
  ]);

  assert.strictEqual(installAppRuntimeDiagnostics({}), false);
  assert.strictEqual(installWindowRuntimeDiagnostics({}), false);
}

module.exports = {
  run: run
};
