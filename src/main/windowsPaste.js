'use strict';

const childProcess = require('child_process');

/**
 * 构造 Windows SendKeys 粘贴命令。
 *
 * @returns {string} 可交给 PowerShell 执行的 `Ctrl+V` 命令。
 */
function buildPowerShellPasteCommand() {
  return [
    'Add-Type -AssemblyName System.Windows.Forms;',
    '[System.Windows.Forms.SendKeys]::SendWait("^v")'
  ].join(' ');
}

/**
 * 把剪贴板内容粘贴到当前 Windows 前台窗口。
 *
 * Electron 已经负责写剪贴板；这里只做系统级 `Ctrl+V`。非 Windows 环境中
 * 返回 `false`，让测试和开发机可以运行逻辑测试而不触发真实按键。
 *
 * @returns {boolean} 已经发出粘贴按键时返回 `true`。
 */
function pasteTextIntoForeground() {
  if (process.platform !== 'win32') {
    return false;
  }

  childProcess.spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    buildPowerShellPasteCommand()
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  }).unref();

  return true;
}

module.exports = {
  buildPowerShellPasteCommand: buildPowerShellPasteCommand,
  pasteTextIntoForeground: pasteTextIntoForeground
};
