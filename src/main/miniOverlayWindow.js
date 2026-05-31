'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MINI_OVERLAY_SIZE = {
  height: 84,
  width: 196
};

const DEFAULT_MINI_OVERLAY_MARGIN = {
  bottom: 44,
  right: 28
};

const DEFAULT_MINI_OVERLAY_EDGE_PADDING = 8;

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

function getAllWorkAreas(screenApi) {
  if (!screenApi || typeof screenApi.getAllDisplays !== 'function') {
    return [getPrimaryWorkArea(screenApi)];
  }

  const displays = screenApi.getAllDisplays();

  if (!Array.isArray(displays) || displays.length === 0) {
    return [getPrimaryWorkArea(screenApi)];
  }

  return displays.map((display) => display && display.workArea).filter(Boolean);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampAxis(value, size, start, length, padding) {
  const min = start + padding;
  const max = start + length - size - padding;

  if (max < min) {
    return Math.round(start + ((length - size) / 2));
  }

  return Math.round(clamp(value, min, max));
}

function distanceToWorkArea(point, workArea) {
  const left = workArea.x;
  const right = workArea.x + workArea.width;
  const top = workArea.y;
  const bottom = workArea.y + workArea.height;
  const dx = point.x < left ? left - point.x : Math.max(0, point.x - right);
  const dy = point.y < top ? top - point.y : Math.max(0, point.y - bottom);

  return (dx * dx) + (dy * dy);
}

function findNearestWorkArea(screenApi, point) {
  const workAreas = getAllWorkAreas(screenApi);
  const targetPoint = point || {
    x: 0,
    y: 0
  };

  return workAreas.reduce((best, workArea) => {
    if (!best) {
      return workArea;
    }

    return distanceToWorkArea(targetPoint, workArea) < distanceToWorkArea(targetPoint, best)
      ? workArea
      : best;
  }, null) || getPrimaryWorkArea(screenApi);
}

/**
 * 构造 mini overlay 的 BrowserWindow 参数。
 *
 * overlay 必须是透明、无边框、不可 focus、跳过 taskbar 的窗口，这样它能常驻
 * 右下角显示音量波形，同时不抢走游戏或其他前台应用的焦点。
 *
 * @param {string} preloadPath mini overlay preload 脚本路径。
 * @param {string} [iconPath] app icon 路径。
 * @param {string} [sessionPartition] Electron session partition。
 * @returns {object} BrowserWindow 构造参数。
 */
function buildMiniOverlayWindowOptions(preloadPath, iconPath, sessionPartition) {
  const options = {
    acceptFirstMouse: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    focusable: false,
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    height: DEFAULT_MINI_OVERLAY_SIZE.height,
    maximizable: false,
    minimizable: false,
    movable: false,
    resizable: false,
    roundedCorners: true,
    show: false,
    skipTaskbar: true,
    title: 'Dandelion Mini',
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: sessionPartition || 'persist:chatgpt',
      preload: preloadPath,
      sandbox: false
    },
    width: DEFAULT_MINI_OVERLAY_SIZE.width
  };

  if (iconPath) {
    options.icon = iconPath;
  }

  return options;
}

/**
 * 计算 mini overlay 在主屏右下角的 bounds。
 *
 * @param {object} displayWorkArea Electron display workArea。
 * @param {object} [options] 可选尺寸和边距。
 * @returns {object} BrowserWindow bounds。
 */
function calculateMiniOverlayBounds(displayWorkArea, options) {
  const opts = options || {};
  const size = opts.size || DEFAULT_MINI_OVERLAY_SIZE;
  const margin = opts.margin || DEFAULT_MINI_OVERLAY_MARGIN;
  const workArea = displayWorkArea || getPrimaryWorkArea();

  return {
    height: size.height,
    width: size.width,
    x: Math.round(workArea.x + workArea.width - size.width - margin.right),
    y: Math.round(workArea.y + workArea.height - size.height - margin.bottom)
  };
}

/**
 * 把 overlay bounds 限制在某个 display workArea 内。
 *
 * 这个函数允许 x/y 为负数，因为 Windows 多屏布局里左侧屏幕通常是负坐标。
 *
 * @param {object} bounds 原始 BrowserWindow bounds。
 * @param {object} workArea 目标 display workArea。
 * @param {object} [options] 可选边距。
 * @returns {object} clamp 后的 bounds。
 */
function clampMiniOverlayBounds(bounds, workArea, options) {
  const opts = options || {};
  const padding = Number.isFinite(opts.edgePadding)
    ? opts.edgePadding
    : DEFAULT_MINI_OVERLAY_EDGE_PADDING;
  const area = workArea || getPrimaryWorkArea();

  return {
    height: bounds.height,
    width: bounds.width,
    x: clampAxis(bounds.x, bounds.width, area.x, area.width, padding),
    y: clampAxis(bounds.y, bounds.height, area.y, area.height, padding)
  };
}

/**
 * 标准化持久化的 mini overlay 位置。
 *
 * @param {*} placement 原始位置对象。
 * @returns {{x:number,y:number}|null} 合法位置，非法时返回 `null`。
 */
function normalizeMiniOverlayPlacement(placement) {
  if (!placement || typeof placement !== 'object') {
    return null;
  }

  const x = Number(placement.x);
  const y = Number(placement.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y)
  };
}

/**
 * 根据保存位置或默认右下角计算 overlay bounds。
 *
 * @param {object} [screenApi] Electron screen API。
 * @param {object} [options] 可选尺寸、边距和持久化位置。
 * @returns {object} BrowserWindow bounds。
 */
function resolveMiniOverlayBounds(screenApi, options) {
  const opts = options || {};
  const size = opts.size || DEFAULT_MINI_OVERLAY_SIZE;
  const placement = normalizeMiniOverlayPlacement(opts.placement);

  if (!placement) {
    return calculateMiniOverlayBounds(getPrimaryWorkArea(screenApi), opts);
  }

  const bounds = {
    height: size.height,
    width: size.width,
    x: placement.x,
    y: placement.y
  };
  const workArea = findNearestWorkArea(screenApi, {
    x: bounds.x + (bounds.width / 2),
    y: bounds.y + (bounds.height / 2)
  });

  return clampMiniOverlayBounds(bounds, workArea, opts);
}

/**
 * 根据 drag 起点和当前鼠标屏幕坐标计算 overlay bounds。
 *
 * @param {object} startBounds drag 开始时的窗口 bounds。
 * @param {object} startPoint drag 开始时的鼠标屏幕坐标。
 * @param {object} currentPoint 当前鼠标屏幕坐标。
 * @param {object} [screenApi] Electron screen API。
 * @param {object} [options] 可选边距。
 * @returns {object} drag 后的 BrowserWindow bounds。
 */
function calculateMiniOverlayDragBounds(startBounds, startPoint, currentPoint, screenApi, options) {
  const deltaX = Number(currentPoint.x) - Number(startPoint.x);
  const deltaY = Number(currentPoint.y) - Number(startPoint.y);
  const bounds = {
    height: startBounds.height,
    width: startBounds.width,
    x: Math.round(startBounds.x + deltaX),
    y: Math.round(startBounds.y + deltaY)
  };
  const workArea = findNearestWorkArea(screenApi, currentPoint);

  return clampMiniOverlayBounds(bounds, workArea, options);
}

/**
 * 读取保存的 mini overlay 位置。
 *
 * @param {string} storagePath 位置 JSON 文件路径。
 * @returns {{x:number,y:number}|null} 保存位置；无效或不存在时返回 `null`。
 */
function readMiniOverlayPlacement(storagePath) {
  if (!storagePath || !fs.existsSync(storagePath)) {
    return null;
  }

  try {
    return normalizeMiniOverlayPlacement(JSON.parse(fs.readFileSync(storagePath, 'utf8')));
  } catch (error) {
    return null;
  }
}

/**
 * 保存 mini overlay 位置。
 *
 * @param {string} storagePath 位置 JSON 文件路径。
 * @param {object} bounds 当前窗口 bounds。
 * @returns {boolean} 保存成功时返回 `true`。
 */
function writeMiniOverlayPlacement(storagePath, bounds) {
  const placement = normalizeMiniOverlayPlacement(bounds);

  if (!storagePath || !placement) {
    return false;
  }

  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(storagePath, JSON.stringify({
    height: bounds.height,
    timestamp: Date.now(),
    width: bounds.width,
    x: placement.x,
    y: placement.y
  }, null, 2));
  return true;
}

/**
 * 显示 mini overlay。
 *
 * @param {object} browserWindow Electron BrowserWindow 兼容对象。
 * @param {object} [screenApi] Electron screen API。
 * @param {object} [options] 可选尺寸和边距。
 * @returns {object|null} 实际应用的 bounds；没有窗口时返回 `null`。
 */
function showMiniOverlayWindow(browserWindow, screenApi, options) {
  if (!browserWindow) {
    return null;
  }

  const bounds = resolveMiniOverlayBounds(screenApi, options);

  if (typeof browserWindow.setSkipTaskbar === 'function') {
    browserWindow.setSkipTaskbar(true);
  }
  if (typeof browserWindow.setBounds === 'function') {
    browserWindow.setBounds(bounds);
  }
  if (typeof browserWindow.setAlwaysOnTop === 'function') {
    browserWindow.setAlwaysOnTop(true, 'screen-saver');
  }
  if (typeof browserWindow.setVisibleOnAllWorkspaces === 'function') {
    browserWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    });
  }

  if (typeof browserWindow.showInactive === 'function') {
    browserWindow.showInactive();
  } else if (typeof browserWindow.show === 'function') {
    browserWindow.show();
  }

  return bounds;
}

/**
 * 隐藏 mini overlay。
 *
 * @param {object} browserWindow Electron BrowserWindow 兼容对象。
 */
function hideMiniOverlayWindow(browserWindow) {
  if (!browserWindow) {
    return;
  }

  if (typeof browserWindow.hide === 'function') {
    browserWindow.hide();
  }
}

/**
 * 切换 mini overlay 是否可 focus。
 *
 * 录音和处理中阶段必须不抢焦点；成功和失败阶段允许 focus，方便用户选择
 * 文本和点击复制按钮。
 *
 * @param {object} browserWindow Electron BrowserWindow 兼容对象。
 * @param {boolean} focusable 是否允许 focus。
 * @returns {boolean} 已调用 setFocusable 时返回 `true`。
 */
function setMiniOverlayFocusable(browserWindow, focusable) {
  if (!browserWindow || typeof browserWindow.setFocusable !== 'function') {
    return false;
  }

  browserWindow.setFocusable(Boolean(focusable));
  return true;
}

module.exports = {
  DEFAULT_MINI_OVERLAY_MARGIN: DEFAULT_MINI_OVERLAY_MARGIN,
  DEFAULT_MINI_OVERLAY_SIZE: DEFAULT_MINI_OVERLAY_SIZE,
  calculateMiniOverlayDragBounds: calculateMiniOverlayDragBounds,
  buildMiniOverlayWindowOptions: buildMiniOverlayWindowOptions,
  calculateMiniOverlayBounds: calculateMiniOverlayBounds,
  clampMiniOverlayBounds: clampMiniOverlayBounds,
  hideMiniOverlayWindow: hideMiniOverlayWindow,
  normalizeMiniOverlayPlacement: normalizeMiniOverlayPlacement,
  readMiniOverlayPlacement: readMiniOverlayPlacement,
  resolveMiniOverlayBounds: resolveMiniOverlayBounds,
  setMiniOverlayFocusable: setMiniOverlayFocusable,
  showMiniOverlayWindow: showMiniOverlayWindow,
  writeMiniOverlayPlacement: writeMiniOverlayPlacement
};
