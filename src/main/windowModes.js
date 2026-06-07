'use strict';

const WINDOW_MODES = {
  CORNER: 'corner',
  HIDDEN: 'hidden',
  MINI: 'mini',
  SMART: 'smart',
  TINY: 'tiny'
};

const DEFAULT_SMART_BOUNDS = {
  height: 720,
  width: 960
};

const DEFAULT_TINY_BOUNDS = {
  height: 80,
  width: 120
};

/**
 * 计算居中窗口 bounds。
 *
 * @param {object} displayWorkArea 屏幕工作区。
 * @param {object} size 窗口尺寸。
 * @returns {object} Electron BrowserWindow bounds。
 */
function centerBounds(displayWorkArea, size) {
  return {
    height: size.height,
    width: size.width,
    x: Math.round(displayWorkArea.x + (displayWorkArea.width - size.width) / 2),
    y: Math.round(displayWorkArea.y + (displayWorkArea.height - size.height) / 2)
  };
}

/**
 * 计算右下角窗口 bounds。
 *
 * @param {object} displayWorkArea 屏幕工作区。
 * @param {object} size 窗口尺寸。
 * @returns {object} Electron BrowserWindow bounds。
 */
function cornerBounds(displayWorkArea, size) {
  return {
    height: size.height,
    width: size.width,
    x: Math.round(displayWorkArea.x + displayWorkArea.width - size.width - 24),
    y: Math.round(displayWorkArea.y + displayWorkArea.height - size.height - 48)
  };
}

function getPrimaryWorkArea(screenApi) {
  const fallback = {
    height: 900,
    width: 1440,
    x: 0,
    y: 0
  };

  if (!screenApi || typeof screenApi.getPrimaryDisplay !== 'function') {
    return fallback;
  }

  const display = screenApi.getPrimaryDisplay();
  return (display && display.workArea) || fallback;
}

/**
 * 构造主窗口初始参数。
 *
 * Electron 的 BrowserWindow 不适合真正创建 `0x0` 窗口，所以初始窗口保持
 * 一个可用尺寸，再通过 `applyWindowMode` 控制隐藏、极小化或展示。ChatGPT
 * dictation 和 app recorder 都跑在这个 WebContents 中，所以关闭 background
 * throttling，避免 mini / hidden 模式下长录音被 Chromium 后台节流截短。
 *
 * @param {string} preloadPath ChatGPT preload 脚本路径。
 * @param {string} [iconPath] app icon 路径。
 * @returns {object} BrowserWindow 构造参数。
 */
function buildMainWindowOptions(preloadPath, iconPath) {
  const options = {
    backgroundColor: '#ffffff',
    height: DEFAULT_SMART_BOUNDS.height,
    show: false,
    title: 'Dandelion',
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:chatgpt',
      preload: preloadPath,
      sandbox: false
    },
    width: DEFAULT_SMART_BOUNDS.width
  };

  if (iconPath) {
    options.icon = iconPath;
  }

  return options;
}

/**
 * 根据模式调整 BrowserWindow。
 *
 * 这个函数只处理窗口外观和可见性，不处理快捷键、登录状态或网页逻辑，
 * 这样托盘菜单、登录引导和测试都能复用同一套模式切换行为。
 *
 * @param {object} browserWindow Electron BrowserWindow 兼容对象。
 * @param {string} mode 目标窗口模式。
 * @param {object} [options] 依赖和可选参数。
 * @returns {string} 实际应用的模式。
 */
function applyWindowMode(browserWindow, mode, options) {
  const selectedMode = Object.keys(WINDOW_MODES)
    .map((key) => WINDOW_MODES[key])
    .indexOf(mode) === -1
    ? WINDOW_MODES.HIDDEN
    : mode;
  const opts = options || {};
  const workArea = getPrimaryWorkArea(opts.screen);

  if (selectedMode === WINDOW_MODES.HIDDEN || selectedMode === WINDOW_MODES.MINI) {
    if (typeof browserWindow.setSkipTaskbar === 'function') {
      browserWindow.setSkipTaskbar(true);
    }
    browserWindow.hide();
    return selectedMode;
  }

  if (selectedMode === WINDOW_MODES.TINY) {
    if (typeof browserWindow.setSkipTaskbar === 'function') {
      browserWindow.setSkipTaskbar(false);
    }
    if (typeof browserWindow.setBounds === 'function') {
      browserWindow.setBounds(cornerBounds(workArea, DEFAULT_TINY_BOUNDS));
    }
    browserWindow.show();
    return selectedMode;
  }

  if (selectedMode === WINDOW_MODES.CORNER) {
    if (typeof browserWindow.setSkipTaskbar === 'function') {
      browserWindow.setSkipTaskbar(false);
    }
    if (typeof browserWindow.setBounds === 'function') {
      browserWindow.setBounds(cornerBounds(workArea, {
        height: 480,
        width: 640
      }));
    }
    browserWindow.show();
    return selectedMode;
  }

  if (typeof browserWindow.setSkipTaskbar === 'function') {
    browserWindow.setSkipTaskbar(false);
  }
  if (typeof browserWindow.setBounds === 'function') {
    browserWindow.setBounds(centerBounds(workArea, DEFAULT_SMART_BOUNDS));
  }
  browserWindow.show();
  if (typeof browserWindow.focus === 'function') {
    browserWindow.focus();
  }
  return WINDOW_MODES.SMART;
}

module.exports = {
  DEFAULT_SMART_BOUNDS: DEFAULT_SMART_BOUNDS,
  DEFAULT_TINY_BOUNDS: DEFAULT_TINY_BOUNDS,
  WINDOW_MODES: WINDOW_MODES,
  applyWindowMode: applyWindowMode,
  buildMainWindowOptions: buildMainWindowOptions,
  centerBounds: centerBounds,
  cornerBounds: cornerBounds
};
