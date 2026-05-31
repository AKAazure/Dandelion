'use strict';

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const TRUSTED_HOSTS = [
  'chatgpt.com',
  'chat.openai.com',
  'auth.openai.com'
];

function noop() {}

function defaultLogger() {
  return {
    debug: noop,
    error: noop,
    info: noop,
    warn: noop
  };
}

function hostnameMatchesTrustedHost(hostname) {
  return TRUSTED_HOSTS.some((trustedHost) => {
    return hostname === trustedHost || hostname.endsWith('.' + trustedHost);
  });
}

function originFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin;
  } catch (error) {
    return '';
  }
}

function buildPermissionKey(permission, rawUrl) {
  const origin = originFromUrl(rawUrl);

  if (!origin) {
    return '';
  }

  return permission + ':' + origin;
}

function readPermissionState(storagePath) {
  if (!storagePath || !fs.existsSync(storagePath)) {
    return {
      grants: {}
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf8'));

    if (!parsed || typeof parsed !== 'object' || !parsed.grants) {
      return {
        grants: {}
      };
    }

    return {
      grants: parsed.grants
    };
  } catch (error) {
    return {
      grants: {}
    };
  }
}

function writePermissionState(storagePath, state) {
  if (!storagePath) {
    return false;
  }

  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(storagePath, JSON.stringify(state, null, 2));
  return true;
}

/**
 * 创建本地持久权限存储。
 *
 * 当前只用于保存 ChatGPT `media` 权限的“始终允许”选择。保存粒度是
 * `permission + origin`，例如 `media:https://chatgpt.com`。
 *
 * @param {string} storagePath 权限 JSON 文件路径。
 * @returns {object} permission store。
 */
function createPersistentPermissionStore(storagePath) {
  return {
    /**
     * 判断指定权限是否已经持久允许。
     *
     * @param {string} permission Electron permission 名称。
     * @param {string} rawUrl 请求 URL。
     * @returns {boolean} 已持久允许时返回 `true`。
     */
    hasGrant: function hasGrant(permission, rawUrl) {
      const key = buildPermissionKey(permission, rawUrl);
      const state = readPermissionState(storagePath);

      return Boolean(key && state.grants[key] === true);
    },

    /**
     * 持久保存指定权限允许状态。
     *
     * @param {string} permission Electron permission 名称。
     * @param {string} rawUrl 请求 URL。
     * @returns {boolean} 保存成功时返回 `true`。
     */
    saveGrant: function saveGrant(permission, rawUrl) {
      const key = buildPermissionKey(permission, rawUrl);

      if (!key) {
        return false;
      }

      const state = readPermissionState(storagePath);
      state.grants[key] = true;
      return writePermissionState(storagePath, state);
    }
  };
}

/**
 * 判断 URL 是否属于 ChatGPT 登录和运行所需的可信 origin。
 *
 * @param {string} rawUrl 待检查的 URL。
 * @returns {boolean} URL hostname 属于可信范围时返回 `true`。
 */
function isTrustedChatGptOrigin(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return hostnameMatchesTrustedHost(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function isPathInside(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);

  return relative === '' || Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 判断 URL 是否是 app 自己加载的本地文件。
 *
 * mini overlay 需要读取麦克风音量来画声波，但它是本 app 的本地 UI，不是
 * 第三方网页。这个判断让 permission handler 只自动放行仓库/app root 内
 * 的 `file://` 页面，避免把任意本地文件都当成可信页面。
 *
 * @param {string} rawUrl 待检查的 URL。
 * @param {string} trustedFileRoot app root。
 * @returns {boolean} 本地文件位于 trusted root 内时返回 `true`。
 */
function isTrustedAppFileUrl(rawUrl, trustedFileRoot) {
  if (!trustedFileRoot) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl);

    if (parsed.protocol !== 'file:') {
      return false;
    }

    return isPathInside(trustedFileRoot, fileURLToPath(parsed));
  } catch (error) {
    return false;
  }
}

/**
 * 判断导航 URL 是否代表需要用户交互的登录页面。
 *
 * @param {string} rawUrl 待检查的 URL。
 * @returns {boolean} URL 看起来是登录页面时返回 `true`。
 */
function shouldShowForLoginUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);

    if (parsed.hostname === 'auth.openai.com') {
      return true;
    }

    return parsed.hostname === 'chatgpt.com' && parsed.pathname.indexOf('/auth') === 0;
  } catch (error) {
    return false;
  }
}

/**
 * 创建 Electron permission request handler。
 *
 * 只处理 ChatGPT 可信 origin 的 `media` 权限请求。如果本地已经保存过
 * “始终允许”，会直接放行；否则先显示窗口，再弹出原生确认框。
 *
 * @param {object} options handler 依赖。
 * @param {object} options.dialog Electron dialog 兼容对象。
 * @param {Function} options.showPermissionWindow 切换到可见窗口的函数。
 * @param {Function} [options.onTrustedMediaRequest] ChatGPT media request 信号。
 * @param {object} [options.permissionStore] 可选持久权限 store。
 * @param {object} [options.logger] 可选 logger。
 * @returns {Function} Electron `setPermissionRequestHandler` callback。
 */
function createPermissionRequestHandler(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Permission handler options are required.');
  }

  if (!options.dialog || typeof options.dialog.showMessageBox !== 'function') {
    throw new TypeError('dialog.showMessageBox is required.');
  }

  if (typeof options.showPermissionWindow !== 'function') {
    throw new TypeError('showPermissionWindow is required.');
  }

  const logger = options.logger || defaultLogger();

  return function handlePermissionRequest(webContents, permission, callback, details) {
    const requestingUrl = (details && details.requestingUrl) ||
      (webContents && typeof webContents.getURL === 'function' ? webContents.getURL() : '');

    if (permission === 'media' && isTrustedAppFileUrl(requestingUrl, options.trustedFileRoot)) {
      logger.debug('permission.media.local_file_allowed', {
        requestingUrl: requestingUrl
      });
      callback(true);
      return;
    }

    if (permission !== 'media' || !isTrustedChatGptOrigin(requestingUrl)) {
      logger.debug('permission.request_denied_untrusted', {
        permission: permission,
        requestingUrl: requestingUrl
      });
      callback(false);
      return;
    }

    if (typeof options.onTrustedMediaRequest === 'function') {
      try {
        options.onTrustedMediaRequest({
          permission: permission,
          requestingUrl: requestingUrl
        });
      } catch (error) {
        logger.warn('permission.media_signal_failed', {
          error: error && error.message ? error.message : String(error),
          requestingUrl: requestingUrl
        });
      }
    }

    if (
      options.permissionStore &&
      typeof options.permissionStore.hasGrant === 'function' &&
      options.permissionStore.hasGrant(permission, requestingUrl)
    ) {
      logger.debug('permission.media.persisted_allowed', {
        requestingUrl: requestingUrl
      });
      callback(true);
      return;
    }

    logger.debug('permission.media.prompt_shown', {
      requestingUrl: requestingUrl
    });
    options.showPermissionWindow();
    options.dialog.showMessageBox({
      buttons: ['始终允许', '仅本次允许', '拒绝'],
      cancelId: 2,
      defaultId: 0,
      message: 'ChatGPT 请求使用麦克风',
      detail: '选择“始终允许”后，本 app 会记住 ChatGPT 的麦克风权限，后续不再重复弹窗。',
      type: 'question'
    }).then((result) => {
      if (result.response === 0) {
        let saved = false;
        if (options.permissionStore && typeof options.permissionStore.saveGrant === 'function') {
          saved = options.permissionStore.saveGrant(permission, requestingUrl);
        }
        logger.debug('permission.media.always_allowed', {
          persisted: saved,
          requestingUrl: requestingUrl
        });
        callback(true);
        return;
      }

      logger.debug('permission.media.prompt_answered', {
        allowed: result.response === 1,
        response: result.response,
        requestingUrl: requestingUrl
      });
      callback(result.response === 1);
    }).catch(() => {
      logger.warn('permission.media.prompt_failed', {
        requestingUrl: requestingUrl
      });
      callback(false);
    });
  };
}

module.exports = {
  TRUSTED_HOSTS: TRUSTED_HOSTS,
  buildPermissionKey: buildPermissionKey,
  createPermissionRequestHandler: createPermissionRequestHandler,
  createPersistentPermissionStore: createPersistentPermissionStore,
  isTrustedAppFileUrl: isTrustedAppFileUrl,
  isTrustedChatGptOrigin: isTrustedChatGptOrigin,
  originFromUrl: originFromUrl,
  readPermissionState: readPermissionState,
  shouldShowForLoginUrl: shouldShowForLoginUrl
};
