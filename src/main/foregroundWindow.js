'use strict';

const childProcess = require('child_process');

function buildCaptureForegroundWindowCommand() {
  return [
    '$signature = \'[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();\';',
    'Add-Type -Namespace GeneralStt -Name NativeMethods -MemberDefinition $signature;',
    '[GeneralStt.NativeMethods]::GetForegroundWindow().ToInt64()'
  ].join(' ');
}

function buildRestoreForegroundWindowCommand(handle) {
  return [
    '$signature = \'[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);\';',
    'Add-Type -Namespace GeneralStt -Name NativeMethods -MemberDefinition $signature;',
    '[GeneralStt.NativeMethods]::SetForegroundWindow([IntPtr]' + handle + ') | Out-Null'
  ].join(' ');
}

/**
 * 判断当前平台是否支持 Windows foreground window API。
 *
 * @param {string} [platform] Node platform 字符串，默认使用 `process.platform`。
 * @returns {boolean} Windows 平台返回 `true`。
 */
function canUseForegroundWindowApi(platform) {
  return (platform || process.platform) === 'win32';
}

/**
 * 标准化 Win32 HWND 字符串。
 *
 * PowerShell 会把 `IntPtr` 输出成十进制整数；这里仅接受正整数，避免把
 * 任意字符串拼进后续 PowerShell 命令。
 *
 * @param {string|number} handle 原始窗口句柄。
 * @returns {string} 可安全拼接进 restore 命令的十进制 HWND。
 */
function normalizeWindowHandle(handle) {
  const normalized = String(handle || '').trim();

  if (!/^[1-9][0-9]*$/.test(normalized)) {
    return '';
  }

  return normalized;
}

/**
 * 捕获当前 Windows 前台窗口 HWND。
 *
 * 非 Windows 环境返回空字符串，方便测试和开发环境运行。这个函数只读取
 * 前台窗口，不改变焦点。
 *
 * @returns {string} 当前前台窗口 HWND；失败时返回空字符串。
 */
function captureForegroundWindow() {
  if (!canUseForegroundWindowApi()) {
    return '';
  }

  const result = childProcess.spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    buildCaptureForegroundWindowCommand()
  ], {
    encoding: 'utf8',
    windowsHide: true
  });

  if (result.error || result.status !== 0) {
    return '';
  }

  return normalizeWindowHandle(result.stdout);
}

/**
 * 恢复指定 Windows 前台窗口。
 *
 * @param {string|number} handle `captureForegroundWindow()` 返回的 HWND。
 * @returns {boolean} 已发出恢复请求时返回 `true`。
 */
function restoreForegroundWindow(handle) {
  const normalizedHandle = normalizeWindowHandle(handle);

  if (!normalizedHandle || !canUseForegroundWindowApi()) {
    return false;
  }

  childProcess.spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    buildRestoreForegroundWindowCommand(normalizedHandle)
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  }).unref();

  return true;
}

module.exports = {
  buildCaptureForegroundWindowCommand: buildCaptureForegroundWindowCommand,
  buildRestoreForegroundWindowCommand: buildRestoreForegroundWindowCommand,
  canUseForegroundWindowApi: canUseForegroundWindowApi,
  captureForegroundWindow: captureForegroundWindow,
  normalizeWindowHandle: normalizeWindowHandle,
  restoreForegroundWindow: restoreForegroundWindow
};
