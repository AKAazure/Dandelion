'use strict';

const { WINDOW_MODES } = require('./windowModes');

const BACKGROUND_SHORTCUT_BOUNDS = {
  height: 1,
  width: 1,
  x: -32000,
  y: -32000
};

function callIfPresent(target, methodName) {
  if (target && typeof target[methodName] === 'function') {
    target[methodName]();
    return true;
  }

  return false;
}

function setOpacityIfPresent(browserWindow, opacity) {
  if (browserWindow && typeof browserWindow.setOpacity === 'function') {
    browserWindow.setOpacity(opacity);
    return true;
  }

  return false;
}

function setBoundsIfPresent(browserWindow, bounds) {
  if (browserWindow && typeof browserWindow.setBounds === 'function') {
    browserWindow.setBounds(bounds);
    return true;
  }

  return false;
}

/**
 * 为发送网页快捷键准备 BrowserWindow。
 *
 * 隐藏和 mini 模式下不再直接显示窗口，而是先把窗口移到屏幕外并设成完全
 * 透明，再临时 show，让 webContents 能收到快捷键，同时避免用户看到窗口
 * 闪现。非后台模式保留现有可见窗口行为。
 *
 * @param {object} browserWindow Electron BrowserWindow 兼容对象。
 * @param {string} currentMode 当前窗口模式。
 * @returns {object} 后续恢复窗口状态所需的 context。
 */
function prepareWindowForShortcut(browserWindow, currentMode) {
  const hiddenMode = currentMode === WINDOW_MODES.HIDDEN || currentMode === WINDOW_MODES.MINI;
  const context = {
    dispatchDelayMs: hiddenMode ? 220 : 0,
    hiddenMode: hiddenMode,
    offscreenBoundsChanged: false,
    opacityChanged: false,
    transparentActivation: false
  };

  if (!browserWindow) {
    return context;
  }

  if (hiddenMode) {
    if (typeof browserWindow.setSkipTaskbar === 'function') {
      browserWindow.setSkipTaskbar(true);
    }
    context.offscreenBoundsChanged = setBoundsIfPresent(browserWindow, BACKGROUND_SHORTCUT_BOUNDS);
    context.opacityChanged = setOpacityIfPresent(browserWindow, 0);
    context.transparentActivation = true;

    if (!callIfPresent(browserWindow, 'showInactive')) {
      callIfPresent(browserWindow, 'show');
    }
    return context;
  }

  callIfPresent(browserWindow, 'show');
  callIfPresent(browserWindow, 'focus');
  return context;
}

/**
 * 恢复快捷键触发前的隐藏窗口状态。
 *
 * @param {object} browserWindow Electron BrowserWindow 兼容对象。
 * @param {object} context `prepareWindowForShortcut` 返回的 context。
 */
function restoreWindowAfterShortcut(browserWindow, context) {
  if (!browserWindow || !context || !context.hiddenMode) {
    return;
  }

  callIfPresent(browserWindow, 'hide');

  if (context.opacityChanged) {
    setOpacityIfPresent(browserWindow, 1);
  }
}

module.exports = {
  BACKGROUND_SHORTCUT_BOUNDS: BACKGROUND_SHORTCUT_BOUNDS,
  prepareWindowForShortcut: prepareWindowForShortcut,
  restoreWindowAfterShortcut: restoreWindowAfterShortcut
};
