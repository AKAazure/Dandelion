'use strict';

const path = require('path');

const DEFAULT_ICON_RELATIVE_PATH = path.join('assets', 'logo.png');

/**
 * 解析 app icon 的绝对路径。
 *
 * @param {string} appRoot 仓库或 app 根目录。
 * @returns {string} `assets/logo.png` 的绝对路径。
 */
function resolveAppIconPath(appRoot) {
  return path.join(appRoot, DEFAULT_ICON_RELATIVE_PATH);
}

/**
 * 从 PNG 文件创建 Electron nativeImage。
 *
 * @param {object} nativeImage Electron `nativeImage` 模块。
 * @param {string} iconPath PNG 文件路径。
 * @returns {object} Electron nativeImage。
 */
function createAppIcon(nativeImage, iconPath) {
  if (!nativeImage || typeof nativeImage.createFromPath !== 'function') {
    throw new TypeError('nativeImage.createFromPath is required.');
  }

  return nativeImage.createFromPath(iconPath);
}

module.exports = {
  DEFAULT_ICON_RELATIVE_PATH: DEFAULT_ICON_RELATIVE_PATH,
  createAppIcon: createAppIcon,
  resolveAppIconPath: resolveAppIconPath
};
