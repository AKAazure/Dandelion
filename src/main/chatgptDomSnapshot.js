'use strict';

const fs = require('fs');
const path = require('path');

const DOM_SNAPSHOT_SCRIPT = [
  '(function captureGeneralSttDomSnapshot() {',
  '  const inputSelectors = ["#prompt-textarea", "textarea", "[contenteditable=\\"true\\"]"];',
  '  const userMessageSelectors = [',
  '    "[data-message-author-role=\\"user\\"]",',
  '    "[data-testid*=\\"conversation-turn\\"] [data-message-author-role=\\"user\\"]"',
  '  ];',
  '  function textFromElement(element) {',
  '    if (!element) { return ""; }',
  '    if (typeof element.value === "string") { return element.value.trim(); }',
  '    return (element.innerText || element.textContent || "").trim();',
  '  }',
  '  function summarizeElement(element, selector, selectorIndex, elementIndex) {',
  '    const text = textFromElement(element);',
  '    return {',
  '      selector: selector,',
  '      selectorIndex: selectorIndex,',
  '      elementIndex: elementIndex,',
  '      tagName: element.tagName || "",',
  '      id: element.id || "",',
  '      role: element.getAttribute("role") || "",',
  '      ariaLabel: element.getAttribute("aria-label") || "",',
  '      dataTestId: element.getAttribute("data-testid") || "",',
  '      isContentEditable: Boolean(element.isContentEditable),',
  '      text: text,',
  '      textLength: text.length',
  '    };',
  '  }',
  '  function collect(selectors) {',
  '    const candidates = [];',
  '    selectors.forEach(function collectSelector(selector, selectorIndex) {',
  '      Array.prototype.slice.call(document.querySelectorAll(selector)).forEach(function collectElement(element, elementIndex) {',
  '        candidates.push(summarizeElement(element, selector, selectorIndex, elementIndex));',
  '      });',
  '    });',
  '    return candidates;',
  '  }',
  '  function latestText(candidates) {',
  '    for (let index = candidates.length - 1; index >= 0; index -= 1) {',
  '      if (candidates[index].text) { return candidates[index].text; }',
  '    }',
  '    return "";',
  '  }',
  '  const inputCandidates = collect(inputSelectors);',
  '  const userMessageCandidates = collect(userMessageSelectors);',
  '  const latestInputText = latestText(inputCandidates);',
  '  const latestUserMessageText = latestText(userMessageCandidates);',
  '  const selectedText = latestInputText || latestUserMessageText;',
  '  const activeElement = document.activeElement ? summarizeElement(document.activeElement, "document.activeElement", -1, -1) : null;',
  '  return {',
  '    href: window.location.href,',
  '    title: document.title || "",',
  '    readyState: document.readyState,',
  '    activeElement: activeElement,',
  '    inputCandidates: inputCandidates,',
  '    userMessageCandidates: userMessageCandidates,',
  '    latestInputText: latestInputText,',
  '    latestInputTextLength: latestInputText.length,',
  '    latestUserMessageText: latestUserMessageText,',
  '    latestUserMessageTextLength: latestUserMessageText.length,',
  '    selectedText: selectedText,',
  '    selectedTextLength: selectedText.length',
  '  };',
  '}())'
].join('\n');

function noop() {}

function defaultLogger() {
  return {
    debug: noop,
    error: noop,
    info: noop,
    warn: noop
  };
}

function sanitizePathSegment(value) {
  const text = String(value || '').trim();
  const sanitized = text
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');
  return sanitized || 'snapshot';
}

function safeJsonWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function summarizeSnapshot(snapshot) {
  const inputCandidates = Array.isArray(snapshot && snapshot.inputCandidates) ?
    snapshot.inputCandidates :
    [];
  const userMessageCandidates = Array.isArray(snapshot && snapshot.userMessageCandidates) ?
    snapshot.userMessageCandidates :
    [];

  return {
    inputCandidateCount: inputCandidates.length,
    latestInputTextLength: Number(snapshot && snapshot.latestInputTextLength) || 0,
    latestUserMessageTextLength: Number(snapshot && snapshot.latestUserMessageTextLength) || 0,
    selectedTextLength: Number(snapshot && snapshot.selectedTextLength) || 0,
    userMessageCandidateCount: userMessageCandidates.length
  };
}

/**
 * 从 ChatGPT 页面抓取一次 DOM transcript snapshot，并写入 request debug 目录。
 *
 * artifact 不经过普通 logger 的 redaction，会保留候选 input/user message 的原文。
 * 调用方应只把它写到显式排障用的 `remote-debug` 目录。
 *
 * @param {object} options 抓取设置。
 * @param {object} options.webContents Electron `WebContents`。
 * @param {string} options.outputDir artifact 输出目录。
 * @param {string} options.label 文件名 label，例如 `after-transcribe-response`。
 * @param {string} [options.requestId] transcribe request id。
 * @param {object} [options.logger] app logger。
 * @param {Function} [options.nowFn] 当前时间函数，主要用于测试。
 * @returns {Promise<string|null>} 成功写入时返回 artifact 路径。
 */
function captureChatGptDomSnapshot(options) {
  const snapshotOptions = options || {};
  const logger = snapshotOptions.logger || defaultLogger();
  const outputDir = String(snapshotOptions.outputDir || '').trim();
  const label = sanitizePathSegment(snapshotOptions.label);
  const nowFn = typeof snapshotOptions.nowFn === 'function' ?
    snapshotOptions.nowFn :
    () => new Date();
  const webContents = snapshotOptions.webContents;

  if (!outputDir || !webContents || typeof webContents.executeJavaScript !== 'function') {
    if (logger && typeof logger.debug === 'function') {
      logger.debug('transcript.dom_snapshot.skipped_unavailable', {
        label: label,
        requestId: snapshotOptions.requestId || ''
      });
    }
    return Promise.resolve(null);
  }

  if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
    if (logger && typeof logger.debug === 'function') {
      logger.debug('transcript.dom_snapshot.skipped_destroyed', {
        label: label,
        requestId: snapshotOptions.requestId || ''
      });
    }
    return Promise.resolve(null);
  }

  const artifactPath = path.join(outputDir, 'dom-snapshot-' + label + '.json');

  return Promise.resolve(webContents.executeJavaScript(DOM_SNAPSHOT_SCRIPT, true))
    .then((snapshot) => {
      const payload = {
        label: label,
        recordedAt: nowFn().toISOString(),
        requestId: String(snapshotOptions.requestId || ''),
        snapshot: snapshot
      };

      safeJsonWrite(artifactPath, payload);

      if (logger && typeof logger.info === 'function') {
        logger.info('transcript.dom_snapshot.written', Object.assign({
          artifactPath: artifactPath,
          label: label,
          requestId: snapshotOptions.requestId || ''
        }, summarizeSnapshot(snapshot)));
      }

      return artifactPath;
    })
    .catch((error) => {
      const failedPath = path.join(outputDir, 'dom-snapshot-' + label + '-failed.json');

      try {
        safeJsonWrite(failedPath, {
          error: error && error.message ? error.message : String(error),
          label: label,
          recordedAt: nowFn().toISOString(),
          requestId: String(snapshotOptions.requestId || '')
        });
      } catch (writeError) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn('transcript.dom_snapshot.write_failed', {
            error: writeError.message,
            label: label,
            requestId: snapshotOptions.requestId || ''
          });
        }
      }

      if (logger && typeof logger.warn === 'function') {
        logger.warn('transcript.dom_snapshot.failed', {
          error: error && error.message ? error.message : String(error),
          label: label,
          requestId: snapshotOptions.requestId || ''
        });
      }

      return null;
    });
}

module.exports = {
  DOM_SNAPSHOT_SCRIPT: DOM_SNAPSHOT_SCRIPT,
  captureChatGptDomSnapshot: captureChatGptDomSnapshot,
  sanitizePathSegment: sanitizePathSegment,
  summarizeSnapshot: summarizeSnapshot
};
