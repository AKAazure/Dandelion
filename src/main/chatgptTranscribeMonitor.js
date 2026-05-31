'use strict';

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

  function handleRequestWillBeSent(params) {
    const request = params && params.request;

    if (!params || !request || !isLikelyTranscribeRequest(request.url, request.method)) {
      return;
    }

    pendingRequests[params.requestId] = {
      method: request.method,
      requestId: params.requestId,
      startedAt: Date.now(),
      statusCode: 0,
      statusText: '',
      url: request.url
    };
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
  }

  function handleLoadingFailed(params) {
    const request = params && removeRequest(params.requestId);

    if (!request) {
      return;
    }

    callIfFunction(options.onFailed, Object.assign({}, request, {
      errorText: params.errorText || 'Transcribe request failed.'
    }));
  }

  function handleLoadingFinished(params) {
    const request = params && removeRequest(params.requestId);

    if (!request) {
      return;
    }

    if (request.statusCode < 200 || request.statusCode >= 300) {
      callIfFunction(options.onFailed, Object.assign({}, request, {
        errorText: request.statusText || 'Transcribe request returned non-2xx status.'
      }));
      return;
    }

    debuggerApi.sendCommand('Network.getResponseBody', {
      requestId: request.requestId
    }).then((response) => {
      callIfFunction(options.onSucceeded, Object.assign({}, request, {
        base64Encoded: Boolean(response && response.base64Encoded),
        text: extractTranscriptTextFromResponseBody(
          response && response.body,
          response && response.base64Encoded
        )
      }));
    }).catch((error) => {
      log('warn', 'transcribe.response_body_read_failed', {
        error: error.message,
        url: request.url
      });
      callIfFunction(options.onSucceeded, Object.assign({}, request, {
        base64Encoded: false,
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
        debuggerApi.sendCommand('Network.enable').catch((error) => {
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
  createChatGptTranscribeMonitor: createChatGptTranscribeMonitor,
  extractTranscriptTextFromResponseBody: extractTranscriptTextFromResponseBody,
  isLikelyTranscribeRequest: isLikelyTranscribeRequest,
  recursiveFindTranscriptText: recursiveFindTranscriptText
};
