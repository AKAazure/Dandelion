'use strict';

const assert = require('assert');

const {
  buildCaptureForegroundWindowCommand,
  buildRestoreForegroundWindowCommand,
  canUseForegroundWindowApi,
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
}

module.exports = {
  run: run
};
