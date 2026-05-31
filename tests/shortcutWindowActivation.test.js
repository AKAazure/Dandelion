'use strict';

const assert = require('assert');

const {
  prepareWindowForShortcut,
  restoreWindowAfterShortcut
} = require('../src/main/shortcutWindowActivation');
const { WINDOW_MODES } = require('../src/main/windowModes');

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
    setOpacity: function setOpacity(opacity) {
      this.calls.push(['setOpacity', opacity]);
    },
    setSkipTaskbar: function setSkipTaskbar(value) {
      this.calls.push(['setSkipTaskbar', value]);
    },
    show: function show() {
      this.calls.push(['show']);
    },
    showInactive: function showInactive() {
      this.calls.push(['showInactive']);
    }
  };
}

function run() {
  const hiddenWindow = createFakeWindow();
  const hiddenContext = prepareWindowForShortcut(hiddenWindow, WINDOW_MODES.HIDDEN);

  assert.deepStrictEqual(hiddenWindow.calls, [
    ['setSkipTaskbar', true],
    ['setBounds', {
      height: 1,
      width: 1,
      x: -32000,
      y: -32000
    }],
    ['setOpacity', 0],
    ['showInactive']
  ]);
  assert.strictEqual(hiddenContext.hiddenMode, true);
  assert.strictEqual(hiddenContext.dispatchDelayMs, 220);
  assert.strictEqual(hiddenContext.offscreenBoundsChanged, true);
  assert.strictEqual(hiddenContext.opacityChanged, true);
  assert.strictEqual(hiddenContext.transparentActivation, true);

  restoreWindowAfterShortcut(hiddenWindow, hiddenContext);
  assert.deepStrictEqual(hiddenWindow.calls, [
    ['setSkipTaskbar', true],
    ['setBounds', {
      height: 1,
      width: 1,
      x: -32000,
      y: -32000
    }],
    ['setOpacity', 0],
    ['showInactive'],
    ['hide'],
    ['setOpacity', 1]
  ]);

  const miniWindow = createFakeWindow();
  const miniContext = prepareWindowForShortcut(miniWindow, WINDOW_MODES.MINI);

  assert.deepStrictEqual(miniWindow.calls, [
    ['setSkipTaskbar', true],
    ['setBounds', {
      height: 1,
      width: 1,
      x: -32000,
      y: -32000
    }],
    ['setOpacity', 0],
    ['showInactive']
  ]);
  assert.strictEqual(miniContext.hiddenMode, true);
  assert.strictEqual(miniContext.dispatchDelayMs, 220);

  const visibleWindow = createFakeWindow();
  const visibleContext = prepareWindowForShortcut(visibleWindow, WINDOW_MODES.SMART);

  assert.deepStrictEqual(visibleWindow.calls, [
    ['show'],
    ['focus']
  ]);
  assert.strictEqual(visibleContext.hiddenMode, false);
  assert.strictEqual(visibleContext.dispatchDelayMs, 0);
  restoreWindowAfterShortcut(visibleWindow, visibleContext);
  assert.deepStrictEqual(visibleWindow.calls, [
    ['show'],
    ['focus']
  ]);
}

module.exports = {
  run: run
};
