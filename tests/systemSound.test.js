'use strict';

const assert = require('assert');
const EventEmitter = require('events');

const {
  buildPlayWindowsSystemSoundCommand,
  normalizeSystemSoundName,
  playWindowsSystemSound
} = require('../src/main/systemSound');

function run() {
  assert.strictEqual(normalizeSystemSoundName('asterisk'), 'Asterisk');
  assert.strictEqual(normalizeSystemSoundName('Exclamation'), 'Exclamation');
  assert.strictEqual(normalizeSystemSoundName('bad'), 'Asterisk');
  assert.strictEqual(
    buildPlayWindowsSystemSoundCommand('asterisk'),
    '[System.Media.SystemSounds]::Asterisk.Play(); Start-Sleep -Milliseconds 320'
  );

  const calls = [];
  const child = new EventEmitter();
  child.pid = 1234;
  child.unref = function unref() {
    calls.push(['unref']);
  };
  const logger = {
    debug: function debug(event, details) {
      calls.push(['debug', event, details]);
    },
    error: function error(event, details) {
      calls.push(['error', event, details]);
    },
    info: function info(event, details) {
      calls.push(['info', event, details]);
    },
    warn: function warn(event, details) {
      calls.push(['warn', event, details]);
    }
  };
  const spawnArgs = [];

  assert.strictEqual(playWindowsSystemSound('asterisk', {
    logger: logger,
    platform: 'win32',
    spawn: function spawn() {
      spawnArgs.push(Array.prototype.slice.call(arguments));
      return child;
    }
  }), true);
  assert.strictEqual(spawnArgs[0][0], 'powershell.exe');
  assert.strictEqual(calls[0][0], 'info');
  assert.strictEqual(calls[0][1], 'sound.play.spawned');
  assert.strictEqual(calls[0][2].pid, 1234);
  assert.deepStrictEqual(calls[1], ['unref']);

  child.emit('close', 0, null);
  assert.strictEqual(calls[2][0], 'debug');
  assert.strictEqual(calls[2][1], 'sound.play.process_closed');
  assert.strictEqual(calls[2][2].exitCode, 0);

  const failedCalls = [];
  assert.strictEqual(playWindowsSystemSound('asterisk', {
    logger: {
      debug: function debug() {},
      error: function error(event, details) {
        failedCalls.push([event, details]);
      },
      info: function info() {},
      warn: function warn() {}
    },
    platform: 'win32',
    spawn: function spawnFailed() {
      throw new Error('spawn failed');
    }
  }), false);
  assert.strictEqual(failedCalls[0][0], 'sound.play.spawn_failed');
}

module.exports = {
  run: run
};
