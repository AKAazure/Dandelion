'use strict';

const assert = require('assert');

const { applyWindowMode, buildMainWindowOptions, WINDOW_MODES } = require('../src/main/windowModes');

function createFakeWindow() {
  return {
    calls: [],
    focus: function focus() {
      this.calls.push(['focus']);
    },
    hide: function hide() {
      this.calls.push(['hide']);
    },
    setBounds: function setBounds(bounds) {
      this.calls.push(['setBounds', bounds]);
    },
    setSkipTaskbar: function setSkipTaskbar(value) {
      this.calls.push(['setSkipTaskbar', value]);
    },
    show: function show() {
      this.calls.push(['show']);
    }
  };
}

const fakeScreen = {
  getPrimaryDisplay: function getPrimaryDisplay() {
    return {
      workArea: {
        height: 800,
        width: 1200,
        x: 10,
        y: 20
      }
    };
  }
};

function run() {
  const options = buildMainWindowOptions('/tmp/preload.js', '/tmp/logo.png');
  assert.strictEqual(options.icon, '/tmp/logo.png');
  assert.strictEqual(options.show, false);
  assert.strictEqual(options.webPreferences.preload, '/tmp/preload.js');
  assert.strictEqual(options.webPreferences.partition, 'persist:chatgpt');

  const hiddenWindow = createFakeWindow();
  assert.strictEqual(applyWindowMode(hiddenWindow, WINDOW_MODES.HIDDEN), WINDOW_MODES.HIDDEN);
  assert.deepStrictEqual(hiddenWindow.calls, [
    ['setSkipTaskbar', true],
    ['hide']
  ]);

  const miniWindow = createFakeWindow();
  assert.strictEqual(applyWindowMode(miniWindow, WINDOW_MODES.MINI), WINDOW_MODES.MINI);
  assert.deepStrictEqual(miniWindow.calls, [
    ['setSkipTaskbar', true],
    ['hide']
  ]);

  const smartWindow = createFakeWindow();
  assert.strictEqual(
    applyWindowMode(smartWindow, WINDOW_MODES.SMART, { screen: fakeScreen }),
    WINDOW_MODES.SMART
  );
  assert.deepStrictEqual(smartWindow.calls, [
    ['setSkipTaskbar', false],
    ['setBounds', {
      height: 720,
      width: 960,
      x: 130,
      y: 60
    }],
    ['show'],
    ['focus']
  ]);

  const tinyWindow = createFakeWindow();
  assert.strictEqual(
    applyWindowMode(tinyWindow, WINDOW_MODES.TINY, { screen: fakeScreen }),
    WINDOW_MODES.TINY
  );
  assert.deepStrictEqual(tinyWindow.calls, [
    ['setSkipTaskbar', false],
    ['setBounds', {
      height: 80,
      width: 120,
      x: 1066,
      y: 692
    }],
    ['show']
  ]);
}

module.exports = {
  run: run
};
