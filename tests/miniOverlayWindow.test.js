'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildMiniOverlayWindowOptions,
  calculateMiniOverlayDragBounds,
  calculateMiniOverlayBounds,
  clampMiniOverlayBounds,
  hideMiniOverlayWindow,
  normalizeMiniOverlayPlacement,
  readMiniOverlayPlacement,
  resolveMiniOverlayBounds,
  setMiniOverlayFocusable,
  showMiniOverlayWindow,
  writeMiniOverlayPlacement
} = require('../src/main/miniOverlayWindow');

function createFakeWindow() {
  return {
    bounds: null,
    calls: [],
    getBounds: function getBounds() {
      return this.bounds;
    },
    hide: function hide() {
      this.calls.push(['hide']);
    },
    setAlwaysOnTop: function setAlwaysOnTop(value, level) {
      this.calls.push(['setAlwaysOnTop', value, level]);
    },
    setBounds: function setBounds(bounds) {
      this.bounds = bounds;
      this.calls.push(['setBounds', bounds]);
    },
    setFocusable: function setFocusable(value) {
      this.calls.push(['setFocusable', value]);
    },
    setSkipTaskbar: function setSkipTaskbar(value) {
      this.calls.push(['setSkipTaskbar', value]);
    },
    setVisibleOnAllWorkspaces: function setVisibleOnAllWorkspaces(value, options) {
      this.calls.push(['setVisibleOnAllWorkspaces', value, options]);
    },
    showInactive: function showInactive() {
      this.calls.push(['showInactive']);
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

const fakeMultiScreen = {
  getAllDisplays: function getAllDisplays() {
    return [
      {
        id: 1,
        workArea: {
          height: 900,
          width: 1200,
          x: -1200,
          y: 0
        }
      },
      {
        id: 2,
        workArea: {
          height: 900,
          width: 1200,
          x: 0,
          y: 0
        }
      }
    ];
  },
  getPrimaryDisplay: function getPrimaryDisplay() {
    return {
      id: 2,
      workArea: {
        height: 900,
        width: 1200,
        x: 0,
        y: 0
      }
    };
  }
};

function run() {
  const options = buildMiniOverlayWindowOptions(
    '/tmp/mini-preload.js',
    '/tmp/logo.png',
    'persist:test'
  );

  assert.strictEqual(options.focusable, false);
  assert.strictEqual(options.transparent, true);
  assert.strictEqual(options.frame, false);
  assert.strictEqual(options.skipTaskbar, true);
  assert.strictEqual(options.webPreferences.preload, '/tmp/mini-preload.js');
  assert.strictEqual(options.webPreferences.partition, 'persist:test');
  assert.strictEqual(options.icon, '/tmp/logo.png');

  assert.deepStrictEqual(calculateMiniOverlayBounds({
    height: 800,
    width: 1200,
    x: 10,
    y: 20
  }), {
    height: 84,
    width: 196,
    x: 986,
    y: 692
  });
  assert.deepStrictEqual(normalizeMiniOverlayPlacement({
    x: '-520.4',
    y: 100.6
  }), {
    x: -520,
    y: 101
  });
  assert.strictEqual(normalizeMiniOverlayPlacement({
    x: 'bad',
    y: 100
  }), null);
  assert.deepStrictEqual(clampMiniOverlayBounds({
    height: 84,
    width: 196,
    x: 2200,
    y: 1000
  }, {
    height: 900,
    width: 1200,
    x: 0,
    y: 0
  }), {
    height: 84,
    width: 196,
    x: 996,
    y: 808
  });
  assert.deepStrictEqual(resolveMiniOverlayBounds(fakeMultiScreen, {
    placement: {
      x: -880,
      y: 760
    }
  }), {
    height: 84,
    width: 196,
    x: -880,
    y: 760
  });
  assert.deepStrictEqual(calculateMiniOverlayDragBounds({
    height: 84,
    width: 196,
    x: 960,
    y: 700
  }, {
    x: 1000,
    y: 730
  }, {
    x: -640,
    y: 730
  }, fakeMultiScreen), {
    height: 84,
    width: 196,
    x: -680,
    y: 700
  });

  const overlayWindow = createFakeWindow();
  assert.deepStrictEqual(showMiniOverlayWindow(overlayWindow, fakeScreen), {
    height: 84,
    width: 196,
    x: 986,
    y: 692
  });
  assert.deepStrictEqual(overlayWindow.calls, [
    ['setSkipTaskbar', true],
    ['setBounds', {
      height: 84,
      width: 196,
      x: 986,
      y: 692
    }],
    ['setAlwaysOnTop', true, 'screen-saver'],
    ['setVisibleOnAllWorkspaces', true, {
      visibleOnFullScreen: true
    }],
    ['showInactive']
  ]);

  hideMiniOverlayWindow(overlayWindow);
  assert.deepStrictEqual(overlayWindow.calls.slice(-1), [['hide']]);

  assert.strictEqual(setMiniOverlayFocusable(overlayWindow, true), true);
  assert.deepStrictEqual(overlayWindow.calls.slice(-1), [['setFocusable', true]]);

  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-stt-mini-placement-'));
  const storagePath = path.join(storageDir, 'mini-overlay-placement.json');

  assert.strictEqual(readMiniOverlayPlacement(storagePath), null);
  assert.strictEqual(writeMiniOverlayPlacement(storagePath, {
    height: 84,
    width: 196,
    x: -680,
    y: 700
  }), true);
  assert.deepStrictEqual(readMiniOverlayPlacement(storagePath), {
    x: -680,
    y: 700
  });
}

module.exports = {
  run: run
};
