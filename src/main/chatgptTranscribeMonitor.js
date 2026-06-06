'use strict';

const fs = require('fs');
const path = require('path');

const REMOTE_DEBUG_BODY_FILE = 'response-body.json';

function noop() {}

function defaultLogger() {
  return {
    debug: noop,
    error: noop,
    info: noop,
    warn: noop
  };
}

/**
 * 标准化 remote debug 保存目录。
 *
 * @param {string} value 原始目录配置。
 * @returns {string} 去空白后的目录；未配置时为空字符串。
 */
function readRemoteDebugLogDir(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

/**
 * 把 requestId 等值清理成安全的路径片段。
 *
 * @param {string} value 原始路径片段。
 * @returns {string} 可用于文件夹名的片段。
 */
function sanitizePathSegment(value) {
  return String(value || 'request')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .slice(0, 120) || 'request';
}

/**
 * 写入 JSON artifact，必要时自动创建父目录。
 *
 * @param {string} filePath artifact 路径。
 * @param {*} value 可 JSON 序列化的内容。
 */
function safeJsonWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

/**
 * 构造某条 remote request 的 artifact 目录。
 *
 * @param {string} rootDir remote debug 根目录。
 * @param {string} requestId CDP requestId。
 * @param {number} startedAt request 开始时间戳。
 * @returns {string} 该 request 的 artifact 目录。
 */
function buildRemoteDebugRequestDir(rootDir, requestId, startedAt) {
  return path.join(
    rootDir,
    new Date(startedAt).toISOString().replace(/[:.]/g, '-'),
    sanitizePathSegment(requestId)
  );
}

/**
 * 写入某个 request 的 remote debug artifact。
 *
 * @param {object} request pending request 信息。
 * @param {string} fileName artifact 文件名。
 * @param {*} payload artifact 内容。
 * @returns {string} 写入路径；未启用时为空字符串。
 */
function writeRemoteDebugArtifact(request, fileName, payload) {
  if (!request || !request.remoteDebugDir) {
    return '';
  }

  const artifactPath = path.join(request.remoteDebugDir, fileName);
  safeJsonWrite(artifactPath, payload);
  return artifactPath;
}

/**
 * 判断一个 network request 是否像 ChatGPT 的语音转写请求。
 *
 * @param {string} url request URL。
 * @param {string} method HTTP method。
 * @returns {boolean} 非 GET 且 URL 命中 transcribe endpoint 时返回 `true`。
 */
function isLikelyTranscribeRequest(url, method) {
  const normalizedUrl = String(url || '').toLowerCase();
  const normalizedMethod = String(method || '').toUpperCase();

  if (normalizedMethod === 'GET') {
    return false;
  }

  return normalizedUrl.indexOf('/backend-api/transcribe') !== -1 ||
    normalizedUrl.indexOf('/transcribe') !== -1;
}

/**
 * 从未知 JSON 结构里递归查找 transcript 文本。
 *
 * ChatGPT 内部 response shape 可能调整，所以这里优先查常见字段，再递归
 * 扫描子节点，保持 monitor 对小幅网页改版的容错。
 *
 * @param {*} value JSON value。
 * @returns {string} 找到的第一个非空文本。
 */
function recursiveFindTranscriptText(value) {
  return findTranscriptText(value, true);
}

function findTranscriptText(value, allowRawString) {
  if (typeof value === 'string') {
    if (!allowRawString) {
      return '';
    }

    return value.trim();
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const text = findTranscriptText(value[index], false);

      if (text) {
        return text;
      }
    }
    return '';
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const preferredKeys = ['text', 'transcript', 'transcription'];

  for (let index = 0; index < preferredKeys.length; index += 1) {
    const key = preferredKeys[index];

    if (typeof value[key] === 'string' && value[key].trim()) {
      return value[key].trim();
    }
  }

  const keys = Object.keys(value);

  for (let index = 0; index < keys.length; index += 1) {
    const text = findTranscriptText(value[keys[index]], false);

    if (text) {
      return text;
    }
  }

  return '';
}

/**
 * 从 Chrome DevTools Protocol response body 中提取 transcript。
 *
 * @param {string} body CDP 返回的 response body。
 * @param {boolean} base64Encoded body 是否为 base64。
 * @returns {string} 转写文本；无法解析时返回空字符串。
 */
function extractTranscriptTextFromResponseBody(body, base64Encoded) {
  if (!body) {
    return '';
  }

  let decodedBody = String(body);

  if (base64Encoded) {
    try {
      decodedBody = Buffer.from(decodedBody, 'base64').toString('utf8');
    } catch (error) {
      return '';
    }
  }

  const trimmedBody = decodedBody.trim();

  if (!trimmedBody) {
    return '';
  }

  try {
    return recursiveFindTranscriptText(JSON.parse(trimmedBody));
  } catch (error) {
    return trimmedBody;
  }
}

/**
 * 创建 ChatGPT transcribe request 监听器。
 *
 * 使用 Electron `webContents.debugger` 接入 Chrome DevTools Protocol 的
 * Network domain。`session.webRequest` 只能拿到请求和 status，不能读取
 * response body；这里需要 response body 来直接提取最终 transcript。
 *
 * @param {object} options monitor 依赖。
 * @param {object} options.webContents Electron WebContents。
 * @param {Function} [options.onStarted] 发现 transcribe request 时调用。
 * @param {Function} [options.onSucceeded] transcribe response 2xx 完成时调用。
 * @param {Function} [options.onFailed] transcribe request 失败时调用。
 * @param {object} [options.logger] 可选 logger。
 * @param {string} [options.remoteDebugLogDir] 原样保存 remote CDP 细节的目录。
 * @returns {object} monitor controller。
 */
function createChatGptTranscribeMonitor(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Transcribe monitor options are required.');
  }

  if (!options.webContents || !options.webContents.debugger) {
    throw new TypeError('webContents.debugger is required.');
  }

  const webContents = options.webContents;
  const debuggerApi = webContents.debugger;
  const logger = options.logger || defaultLogger();
  const remoteDebugLogDir = readRemoteDebugLogDir(options.remoteDebugLogDir);
  const pendingRequests = {};
  let started = false;

  function log(level, message, details) {
    if (logger && typeof logger[level] === 'function') {
      logger[level](message, details);
    }
  }

  function callIfFunction(fn, payload) {
    if (typeof fn === 'function') {
      fn(payload);
    }
  }

  function removeRequest(requestId) {
    const request = pendingRequests[requestId];
    delete pendingRequests[requestId];
    return request;
  }

  function writeRemoteDebug(request, fileName, payload) {
    if (!remoteDebugLogDir || !request) {
      return '';
    }

    try {
      return writeRemoteDebugArtifact(request, fileName, payload);
    } catch (error) {
      log('warn', 'transcribe.remote_debug_write_failed', {
        error: error.message,
        fileName: fileName,
        requestId: request.requestId
      });
      return '';
    }
  }

  // CDP requestWillBeSent may omit large request bodies. Ask CDP for the
  // request post data separately so remote-debug artifacts preserve more of
  // the actual payload when Chromium exposes it.
  function captureRequestPostData(request) {
    if (!remoteDebugLogDir || !request) {
      return;
    }

    debuggerApi.sendCommand('Network.getRequestPostData', {
      requestId: request.requestId
    }).then((response) => {
      writeRemoteDebug(request, 'request-post-data.json', {
        cdpCommand: 'Network.getRequestPostData',
        recordedAt: new Date().toISOString(),
        request: request,
        response: response
      });
    }).catch((error) => {
      writeRemoteDebug(request, 'request-post-data-unavailable.json', {
        cdpCommand: 'Network.getRequestPostData',
        error: {
          message: error.message,
          name: error.name,
          stack: error.stack
        },
        recordedAt: new Date().toISOString(),
        request: request
      });
    });
  }

  function handleRequestWillBeSent(params) {
    const request = params && params.request;

    if (!params || !request || !isLikelyTranscribeRequest(request.url, request.method)) {
      return;
    }

    const startedAt = Date.now();
    pendingRequests[params.requestId] = {
      method: request.method,
      requestId: params.requestId,
      remoteDebugDir: remoteDebugLogDir ?
        buildRemoteDebugRequestDir(remoteDebugLogDir, params.requestId, startedAt) :
        '',
      startedAt: startedAt,
      statusCode: 0,
      statusText: '',
      url: request.url
    };
    writeRemoteDebug(pendingRequests[params.requestId], 'request-will-be-sent.json', {
      cdpMethod: 'Network.requestWillBeSent',
      params: params,
      recordedAt: new Date().toISOString()
    });
    captureRequestPostData(pendingRequests[params.requestId]);
    callIfFunction(options.onStarted, pendingRequests[params.requestId]);
  }

  function handleResponseReceived(params) {
    const request = params && pendingRequests[params.requestId];

    if (!request || !params.response) {
      return;
    }

    request.statusCode = params.response.status || 0;
    request.statusText = params.response.statusText || '';
    request.mimeType = params.response.mimeType || '';
    writeRemoteDebug(request, 'response-received.json', {
      cdpMethod: 'Network.responseReceived',
      params: params,
      recordedAt: new Date().toISOString()
    });
  }

  function handleLoadingFailed(params) {
    const request = params && removeRequest(params.requestId);

    if (!request) {
      return;
    }

    writeRemoteDebug(request, 'loading-failed.json', {
      cdpMethod: 'Network.loadingFailed',
      params: params,
      recordedAt: new Date().toISOString()
    });
    callIfFunction(options.onFailed, Object.assign({}, request, {
      errorText: params.errorText || 'Transcribe request failed.'
    }));
  }

  function handleLoadingFinished(params) {
    const request = params && removeRequest(params.requestId);

    if (!request) {
      return;
    }

    writeRemoteDebug(request, 'loading-finished.json', {
      cdpMethod: 'Network.loadingFinished',
      params: params,
      recordedAt: new Date().toISOString()
    });

    if (request.statusCode < 200 || request.statusCode >= 300) {
      callIfFunction(options.onFailed, Object.assign({}, request, {
        errorText: request.statusText || 'Transcribe request returned non-2xx status.'
      }));
      return;
    }

    debuggerApi.sendCommand('Network.getResponseBody', {
      requestId: request.requestId
    }).then((response) => {
      const text = extractTranscriptTextFromResponseBody(
        response && response.body,
        response && response.base64Encoded
      );
      writeRemoteDebug(request, REMOTE_DEBUG_BODY_FILE, {
        cdpCommand: 'Network.getResponseBody',
        recordedAt: new Date().toISOString(),
        request: request,
        response: response,
        transcript: {
          text: text,
          textLength: text.length
        }
      });
      callIfFunction(options.onSucceeded, Object.assign({}, request, {
        base64Encoded: Boolean(response && response.base64Encoded),
        remoteDebugDir: request.remoteDebugDir,
        text: text
      }));
    }).catch((error) => {
      log('warn', 'transcribe.response_body_read_failed', {
        error: error.message,
        url: request.url
      });
      writeRemoteDebug(request, 'response-body-read-failed.json', {
        cdpCommand: 'Network.getResponseBody',
        error: {
          message: error.message,
          name: error.name,
          stack: error.stack
        },
        recordedAt: new Date().toISOString(),
        request: request
      });
      callIfFunction(options.onSucceeded, Object.assign({}, request, {
        base64Encoded: false,
        remoteDebugDir: request.remoteDebugDir,
        text: ''
      }));
    });
  }

  function handleDebuggerMessage(_event, method, params) {
    if (method === 'Network.requestWillBeSent') {
      handleRequestWillBeSent(params);
      return;
    }

    if (method === 'Network.responseReceived') {
      handleResponseReceived(params);
      return;
    }

    if (method === 'Network.loadingFailed') {
      handleLoadingFailed(params);
      return;
    }

    if (method === 'Network.loadingFinished') {
      handleLoadingFinished(params);
    }
  }

  return {
    start: function start() {
      if (started) {
        return true;
      }

      try {
        if (!debuggerApi.isAttached()) {
          debuggerApi.attach('1.3');
        }
        debuggerApi.on('message', handleDebuggerMessage);
        debuggerApi.sendCommand('Network.enable', {
          maxPostDataSize: 50 * 1024 * 1024,
          maxResourceBufferSize: 50 * 1024 * 1024,
          maxTotalBufferSize: 100 * 1024 * 1024
        }).catch((error) => {
          log('warn', 'transcribe.monitor_network_enable_failed', {
            error: error.message
          });
        });
        started = true;
        return true;
      } catch (error) {
        log('warn', 'transcribe.monitor_attach_failed', {
          error: error.message
        });
        return false;
      }
    },
    stop: function stop() {
      if (!started) {
        return;
      }

      debuggerApi.removeListener('message', handleDebuggerMessage);
      Object.keys(pendingRequests).forEach((requestId) => {
        delete pendingRequests[requestId];
      });
      started = false;
    },
    isStarted: function isStarted() {
      return started;
    }
  };
}

module.exports = {
  REMOTE_DEBUG_BODY_FILE: REMOTE_DEBUG_BODY_FILE,
  buildRemoteDebugRequestDir: buildRemoteDebugRequestDir,
  createChatGptTranscribeMonitor: createChatGptTranscribeMonitor,
  extractTranscriptTextFromResponseBody: extractTranscriptTextFromResponseBody,
  isLikelyTranscribeRequest: isLikelyTranscribeRequest,
  recursiveFindTranscriptText: recursiveFindTranscriptText,
  sanitizePathSegment: sanitizePathSegment
};
