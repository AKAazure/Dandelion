'use strict';

const assert = require('assert');

const {
  DEFAULT_CAPTURE_FOREGROUND_WINDOW_TIMEOUT_MS,
  buildCaptureForegroundWindowCommand,
  buildRestoreForegroundWindowCommand,
  canUseForegroundWindowApi,
  captureForegroundWindow,
  normalizeWindowHandle
} = require('../src/main/foregroundWindow');

function run() {
  assert.strictEqual(canUseForegroundWindowApi('win32'), true);
  assert.strictEqual(canUseForegroundWindowApi('linux'), false);
  assert.strictEqual(normalizeWindowHandle(' 12345 \n'), '12345');
  assert.strictEqual(normalizeWindowHandle('0'), '');
  assert.strictEqual(normalizeWindowHandle('123; bad'), '');

  assert.ok(buildCaptureForegroundWindowCommand().indexOf('GetForegroundWindow') !== -1);
  assert.ok(buildRestoreForegroundWindowCommand('12345').indexOf('SetForegroundWindow') !== -1);
  assert.ok(buildRestoreForegroundWindowCommand('12345').indexOf('[IntPtr]12345') !== -1);

  const calls = [];
  const fakeChildProcess = {
    spawnSync: function spawnSync(command, args, options) {
      calls.push({
        args: args,
        command: command,
        options: options
      });
      return {
        status: 0,
        stdout: ' 12345 \r\n'
      };
    }
  };

  assert.strictEqual(captureForegroundWindow({
    childProcess: fakeChildProcess,
    platform: 'win32'
  }), '12345');
  assert.strictEqual(calls[0].command, 'powershell.exe');
  assert.strictEqual(calls[0].options.timeout, DEFAULT_CAPTURE_FOREGROUND_WINDOW_TIMEOUT_MS);
  assert.strictEqual(calls[0].options.windowsHide, true);

  const timeoutChildProcess = {
    spawnSync: function spawnSync() {
      return {
        error: new Error('spawnSync powershell.exe ETIMEDOUT'),
        status: null,
        stdout: ''
      };
    }
  };

  assert.strictEqual(captureForegroundWindow({
    childProcess: timeoutChildProcess,
    platform: 'win32',
    timeoutMs: 25
  }), '');
}

module.exports = {
  run: run
};
