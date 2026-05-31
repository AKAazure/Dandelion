'use strict';

const MINI_OVERLAY_STATES = {
  ERROR: 'error',
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SUCCESS: 'success'
};

const COMPACT_OVERLAY_SIZE = {
  height: 84,
  width: 196
};

const RESULT_OVERLAY_SIZE = {
  height: 180,
  width: 340
};

function normalizeMiniOverlayState(state) {
  const normalized = String(state || '').trim().toLowerCase();
  const validStates = Object.keys(MINI_OVERLAY_STATES).map((key) => MINI_OVERLAY_STATES[key]);

  if (validStates.indexOf(normalized) === -1) {
    return MINI_OVERLAY_STATES.IDLE;
  }

  return normalized;
}

/**
 * 判断 overlay 状态是否需要读取本地麦克风。
 *
 * @param {string} state 当前 overlay 状态。
 * @param {boolean} visible overlay 是否可见。
 * @returns {boolean} 只有可见且处于 listening 时返回 `true`。
 */
function shouldUseMiniOverlayMic(state, visible) {
  return Boolean(visible) && normalizeMiniOverlayState(state) === MINI_OVERLAY_STATES.LISTENING;
}

/**
 * 判断当前 overlay 状态是否属于一轮活跃听写。
 *
 * @param {string} state 当前 overlay 状态。
 * @returns {boolean} listening 或 processing 时返回 `true`。
 */
function isDictationActiveState(state) {
  const normalized = normalizeMiniOverlayState(state);
  return normalized === MINI_OVERLAY_STATES.LISTENING ||
    normalized === MINI_OVERLAY_STATES.PROCESSING;
}

/**
 * 判断 overlay 是否应允许 focus 和文本选择。
 *
 * @param {string} state 当前 overlay 状态。
 * @returns {boolean} 成功或失败结果态返回 `true`。
 */
function shouldFocusMiniOverlay(state) {
  const normalized = normalizeMiniOverlayState(state);
  return normalized === MINI_OVERLAY_STATES.SUCCESS || normalized === MINI_OVERLAY_STATES.ERROR;
}

/**
 * 根据状态选择 overlay 窗口尺寸。
 *
 * @param {string} state 当前 overlay 状态。
 * @returns {object} BrowserWindow size。
 */
function getMiniOverlaySizeForState(state) {
  if (shouldFocusMiniOverlay(state)) {
    return {
      height: RESULT_OVERLAY_SIZE.height,
      width: RESULT_OVERLAY_SIZE.width
    };
  }

  return {
    height: COMPACT_OVERLAY_SIZE.height,
    width: COMPACT_OVERLAY_SIZE.width
  };
}

module.exports = {
  COMPACT_OVERLAY_SIZE: COMPACT_OVERLAY_SIZE,
  MINI_OVERLAY_STATES: MINI_OVERLAY_STATES,
  RESULT_OVERLAY_SIZE: RESULT_OVERLAY_SIZE,
  getMiniOverlaySizeForState: getMiniOverlaySizeForState,
  isDictationActiveState: isDictationActiveState,
  normalizeMiniOverlayState: normalizeMiniOverlayState,
  shouldFocusMiniOverlay: shouldFocusMiniOverlay,
  shouldUseMiniOverlayMic: shouldUseMiniOverlayMic
};
