'use strict';

function noop() {}

function normalizeLogger(logger) {
  const input = logger || {};

  return {
    debug: typeof input.debug === 'function' ? input.debug.bind(input) : noop,
    error: typeof input.error === 'function' ? input.error.bind(input) : noop,
    info: typeof input.info === 'function' ? input.info.bind(input) : noop,
    warn: typeof input.warn === 'function' ? input.warn.bind(input) : noop
  };
}

function safeCall(target, methodName, fallback) {
  if (!target || typeof target[methodName] !== 'function') {
    return fallback;
  }

  try {
    return target[methodName]();
  } catch (error) {
    return fallback;
  }
}

/**
 * 只保留 Electron process-gone details 里有诊断价值且适合写入日志的字段。
 *
 * @param {object} details Electron 事件传入的 details。
 * @returns {object} 可写入 app log 的精简 details。
 */
function normalizeGoneDetails(details) {
  const input = details || {};
  const result = {};

  [
    'exitCode',
    'name',
    'reason',
    'serviceName',
    'type'
  ].forEach((key) => {
    if (input[key] !== undefined) {
      result[key] = input[key];
    }
  });

  return result;
}

/**
 * 给 Electron app 注册 native child process 诊断日志。
 *
 * 这个 hook 不改变进程生命周期，只把 GPU、utility、renderer 等子进程异常退出
 * 写进 app log，方便把 Windows WER 的 AppHang/AppCrash 和 Electron 内部事件连起来。
 *
 * @param {object} options 诊断依赖。
 * @param {object} options.app Electron app 对象。
 * @param {object} options.logger app logger。
 * @returns {boolean} 成功注册时返回 `true`。
 */
function installAppRuntimeDiagnostics(options) {
  const opts = options || {};
  const app = opts.app;
  const logger = normalizeLogger(opts.logger);

  if (!app || typeof app.on !== 'function') {
    return false;
  }

  app.on('child-process-gone', function onChildProcessGone(_event, details) {
    logger.error('runtime.child_process.gone', normalizeGoneDetails(details));
  });

  return true;
}

/**
 * 给 BrowserWindow 和它的 WebContents 注册 hang / renderer gone 诊断日志。
 *
 * 这个 hook 覆盖两类边界：窗口本身进入 unresponsive/responsive，以及承载网页的
 * renderer process 被 Chromium 标记为 gone。日志里带 label 和当前 URL，方便区分
 * ChatGPT 主窗口与 mini overlay。
 *
 * @param {object} options 诊断依赖。
 * @param {object} options.browserWindow Electron BrowserWindow。
 * @param {string} options.label 窗口标签。
 * @param {object} options.logger app logger。
 * @returns {boolean} 成功注册时返回 `true`。
 */
function installWindowRuntimeDiagnostics(options) {
  const opts = options || {};
  const browserWindow = opts.browserWindow;
  const label = String(opts.label || 'window');
  const logger = normalizeLogger(opts.logger);

  if (!browserWindow || typeof browserWindow.on !== 'function') {
    return false;
  }

  browserWindow.on('unresponsive', function onWindowUnresponsive() {
    logger.error('runtime.window.unresponsive', {
      label: label
    });
  });

  browserWindow.on('responsive', function onWindowResponsive() {
    logger.info('runtime.window.responsive', {
      label: label
    });
  });

  const webContents = browserWindow.webContents;

  if (webContents && typeof webContents.on === 'function') {
    webContents.on('render-process-gone', function onRenderProcessGone(_event, details) {
      logger.error('runtime.renderer.gone', Object.assign({
        label: label,
        url: safeCall(webContents, 'getURL', '')
      }, normalizeGoneDetails(details)));
    });

    webContents.on('unresponsive', function onWebContentsUnresponsive() {
      logger.error('runtime.web_contents.unresponsive', {
        label: label,
        url: safeCall(webContents, 'getURL', '')
      });
    });

    webContents.on('responsive', function onWebContentsResponsive() {
      logger.info('runtime.web_contents.responsive', {
        label: label,
        url: safeCall(webContents, 'getURL', '')
      });
    });
  }

  return true;
}

module.exports = {
  installAppRuntimeDiagnostics: installAppRuntimeDiagnostics,
  installWindowRuntimeDiagnostics: installWindowRuntimeDiagnostics,
  normalizeGoneDetails: normalizeGoneDetails
};
