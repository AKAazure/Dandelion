'use strict';

const assert = require('assert');

const {
  MINI_OVERLAY_STATES,
  getMiniOverlaySizeForState,
  isDictationActiveState,
  normalizeMiniOverlayState,
  shouldFocusMiniOverlay,
  shouldUseMiniOverlayMic
} = require('../src/main/miniOverlayState');

function run() {
  assert.strictEqual(normalizeMiniOverlayState('LISTENING'), MINI_OVERLAY_STATES.LISTENING);
  assert.strictEqual(normalizeMiniOverlayState('bad'), MINI_OVERLAY_STATES.IDLE);

  assert.strictEqual(shouldUseMiniOverlayMic(MINI_OVERLAY_STATES.LISTENING, true), true);
  assert.strictEqual(shouldUseMiniOverlayMic(MINI_OVERLAY_STATES.LISTENING, false), false);
  assert.strictEqual(shouldUseMiniOverlayMic(MINI_OVERLAY_STATES.IDLE, true), false);
  assert.strictEqual(shouldUseMiniOverlayMic(MINI_OVERLAY_STATES.PROCESSING, true), false);
  assert.strictEqual(shouldUseMiniOverlayMic(MINI_OVERLAY_STATES.SUCCESS, true), false);
  assert.strictEqual(shouldUseMiniOverlayMic(MINI_OVERLAY_STATES.ERROR, true), false);
  assert.strictEqual(isDictationActiveState(MINI_OVERLAY_STATES.LISTENING), true);
  assert.strictEqual(isDictationActiveState(MINI_OVERLAY_STATES.PROCESSING), true);
  assert.strictEqual(isDictationActiveState(MINI_OVERLAY_STATES.IDLE), false);
  assert.strictEqual(isDictationActiveState(MINI_OVERLAY_STATES.SUCCESS), false);
  assert.strictEqual(isDictationActiveState(MINI_OVERLAY_STATES.ERROR), false);

  assert.strictEqual(shouldFocusMiniOverlay(MINI_OVERLAY_STATES.SUCCESS), true);
  assert.strictEqual(shouldFocusMiniOverlay(MINI_OVERLAY_STATES.ERROR), true);
  assert.strictEqual(shouldFocusMiniOverlay(MINI_OVERLAY_STATES.LISTENING), false);

  assert.deepStrictEqual(getMiniOverlaySizeForState(MINI_OVERLAY_STATES.IDLE), {
    height: 84,
    width: 196
  });
  assert.deepStrictEqual(getMiniOverlaySizeForState(MINI_OVERLAY_STATES.SUCCESS), {
    height: 180,
    width: 340
  });
}

module.exports = {
  run: run
};
