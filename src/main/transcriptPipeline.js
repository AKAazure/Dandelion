'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_TRANSCRIPT_STABLE_MS = 2500;

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
 * 从 preload payload 中提取 transcript 文本。
 *
 * @param {object} payload preload 发送的 transcript payload。
 * @returns {string} 去除前后空白后的文本；无有效文本时返回空字符串。
 */
function normalizeTranscriptPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  return String(payload.text || '').trim();
}

function readStoredTranscript(storagePath) {
  if (!storagePath) {
    return '';
  }

  try {
    const rawContent = fs.readFileSync(storagePath, 'utf8');
    const parsed = JSON.parse(rawContent);
    return String(parsed.text || '').trim();
  } catch (error) {
    return '';
  }
}

function writeStoredTranscript(storagePath, text, timestamp) {
  if (!storagePath || !text) {
    return false;
  }

  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(storagePath, JSON.stringify({
    text: text,
    timestamp: timestamp
  }, null, 2));
  return true;
}

function normalizeStableMs(value) {
  const normalized = Number.parseInt(value, 10);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return DEFAULT_TRANSCRIPT_STABLE_MS;
  }

  return normalized;
}

function callIfFunction(fn, payload) {
  if (typeof fn === 'function') {
    fn(payload);
  }
}

/**
 * 创建 ChatGPT transcript 到系统输入框的处理 pipeline。
 *
 * pipeline 的职责是等待候选文本稳定、去重、写入剪贴板、保存最后完成文本，
 * 再触发系统粘贴。它不直接读取 DOM，DOM 提取由 preload 完成，这样主进程
 * 逻辑可以用普通单元测试覆盖。
 *
 * @param {object} options pipeline 依赖。
 * @param {object} options.clipboard Electron clipboard 兼容对象。
 * @param {Function} options.pasteText 把文本粘贴到当前前台窗口的函数。
 * @param {string} [options.storagePath] 最后完成 transcript 的本地保存路径。
 * @param {number} [options.stableMs] 候选文本稳定多少毫秒后才视为完成。
 * @param {boolean} [options.autoPaste] 完成后是否自动粘贴，默认 `true`。
 * @param {boolean} [options.restoreLastToClipboard] 启动时是否把上次结果写回剪贴板，默认 `true`。
 * @param {Function} [options.onFinalized] transcript 完成后调用。
 * @param {Function} [options.onError] transcript 处理失败时调用。
 * @param {object} [options.logger] 可选 logger。
 * @returns {object} pipeline controller。
 */
function createTranscriptPipeline(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Transcript pipeline options are required.');
  }

  if (!options.clipboard || typeof options.clipboard.writeText !== 'function') {
    throw new TypeError('clipboard.writeText is required.');
  }

  if (typeof options.pasteText !== 'function') {
    throw new TypeError('pasteText is required.');
  }

  const logger = options.logger || defaultLogger();
  const stableMs = normalizeStableMs(options.stableMs);
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
  const autoPaste = options.autoPaste !== false;
  let candidateText = '';
  let lastText = readStoredTranscript(options.storagePath);
  let pendingTimer = null;

  function log(level, message, details) {
    if (logger && typeof logger[level] === 'function') {
      logger[level](message, details);
    }
  }

  function writeClipboard(text) {
    options.clipboard.writeText(text);
  }

  function finalizeText(text, finalizeOptions) {
    const normalizedText = String(text || '').trim();
    const force = Boolean(finalizeOptions && finalizeOptions.force);

    if (!normalizedText || (!force && normalizedText === lastText)) {
      return false;
    }

    try {
      lastText = normalizedText;
      writeClipboard(normalizedText);
      writeStoredTranscript(options.storagePath, normalizedText, Date.now());

      const pasted = autoPaste ? options.pasteText(normalizedText) : false;

      log('info', 'transcript.pipeline.finalized', {
        autoPaste: autoPaste,
        forced: force,
        length: normalizedText.length
      });
      callIfFunction(options.onFinalized, {
        autoPaste: autoPaste,
        pasted: pasted,
        text: normalizedText
      });
      return true;
    } catch (error) {
      log('error', 'transcript.pipeline.finalize_failed', {
        error: error.message,
        length: normalizedText.length
      });
      callIfFunction(options.onError, {
        error: error,
        message: error.message || 'Failed to finalize transcript.',
        text: normalizedText
      });
      return false;
    }
  }

  function finalizeCandidate() {
    return finalizeText(candidateText, {
      force: false
    });
  }

  function scheduleFinalize() {
    if (pendingTimer) {
      clearTimeoutFn(pendingTimer);
    }

    pendingTimer = setTimeoutFn(function finalizeAfterStableWindow() {
      pendingTimer = null;
      finalizeCandidate();
    }, stableMs);
  }

  if (options.restoreLastToClipboard !== false && lastText) {
    writeClipboard(lastText);
  }

  return {
    /**
     * 处理一次从 ChatGPT DOM 观察器发来的 transcript。
     *
     * @param {object} payload preload 发送的 transcript payload。
     * @returns {boolean} 成功安排完成检测时返回 `true`。
     */
    handleTranscript: function handleTranscript(payload) {
      const text = normalizeTranscriptPayload(payload);

      if (!text || text === candidateText) {
        return false;
      }

      candidateText = text;
      scheduleFinalize();
      log('debug', 'transcript.pipeline.finalize_scheduled', {
        length: candidateText.length,
        source: payload.source
      });
      return true;
    },

    /**
     * 立即完成当前候选 transcript。
     *
     * @returns {boolean} 有新文本被复制时返回 `true`。
     */
    flushPendingTranscript: function flushPendingTranscript() {
      if (pendingTimer) {
        clearTimeoutFn(pendingTimer);
        pendingTimer = null;
      }

      return finalizeCandidate();
    },

    /**
     * 立即完成指定 transcript。
     *
     * network transcribe response 已经是 ChatGPT 返回的最终文本，不需要等待
     * DOM 稳定窗口。`force` 为 `true` 时，即使文本和上次完成结果相同，也会
     * 重新写入剪贴板并触发成功状态，避免 stop 后因为 DOM 没有新变化而误报失败。
     *
     * @param {string} text 要完成的 transcript 文本。
     * @param {object} [finalizeOptions] 完成选项。
     * @param {boolean} [finalizeOptions.force] 是否跳过去重。
     * @returns {boolean} 有文本被复制时返回 `true`。
     */
    finalizeText: function finalizeTextNow(text, finalizeOptions) {
      if (pendingTimer) {
        clearTimeoutFn(pendingTimer);
        pendingTimer = null;
      }

      candidateText = String(text || '').trim();
      return finalizeText(candidateText, {
        force: finalizeOptions && finalizeOptions.force === true
      });
    },

    /**
     * 丢弃当前候选 transcript。
     *
     * 取消听写时调用。它只清除本轮候选和 pending timer，不修改 `lastText`，
     * 因此用户仍然可以从托盘菜单复制上一次已经完成的 transcript。
     *
     * @returns {boolean} 有候选文本或 timer 被清理时返回 `true`。
     */
    discardPendingTranscript: function discardPendingTranscript() {
      const hadPendingTimer = Boolean(pendingTimer);
      const hadCandidateText = Boolean(candidateText);

      if (pendingTimer) {
        clearTimeoutFn(pendingTimer);
        pendingTimer = null;
      }

      candidateText = '';
      return hadPendingTimer || hadCandidateText;
    },

    /**
     * 把最近一次完成 transcript 重新写入剪贴板。
     *
     * @returns {boolean} 剪贴板已更新时返回 `true`。
     */
    copyLastTranscriptToClipboard: function copyLastTranscriptToClipboard() {
      if (!lastText) {
        return false;
      }

      writeClipboard(lastText);
      return true;
    },

    /**
     * 返回最近一次已处理的 transcript 文本。
     *
     * @returns {string} 最近一次 transcript。
     */
    getLastText: function getLastText() {
      return lastText;
    }
  };
}

module.exports = {
  DEFAULT_TRANSCRIPT_STABLE_MS: DEFAULT_TRANSCRIPT_STABLE_MS,
  createTranscriptPipeline: createTranscriptPipeline,
  normalizeStableMs: normalizeStableMs,
  normalizeTranscriptPayload: normalizeTranscriptPayload,
  readStoredTranscript: readStoredTranscript,
  writeStoredTranscript: writeStoredTranscript
};
