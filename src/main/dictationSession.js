'use strict';

const DEFAULT_START_CONFIRMATION_MS = 1500;
const DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_MAX_MS = 120000;
const DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_SCALE_MS = 30000;
const DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_CURVE_MS = 3300;
const DEFAULT_MAX_START_RETRIES = 1;

const DICTATION_PHASES = {
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  WAITING_RESPONSE: 'waiting_response'
};

function noop() {}

function defaultLogger() {
  return {
    debug: noop,
    error: noop,
    info: noop,
    warn: noop
  };
}

function readNonNegativeInt(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

/**
 * 按听写时长计算 stop 后等待 transcribe request 的 timeout。
 *
 * 短听写保持接近 base timeout；长听写按时长平方增加等待时间，
 * 让 ChatGPT 处理长音频时有更多时间发出 request。当前曲线系数基于
 * 2026-05-31 两次 late-request 样本反推，保证 113s / 161s 听写的默认
 * timeout 都比当时实际 request-start 延迟多出至少 50%。
 *
 * @param {number} listeningDurationMs 本轮听写持续时间。
 * @param {object} [options] timeout 参数。
 * @returns {number} 计算后的 timeout ms。
 */
function calculateTranscribeRequestTimeoutMs(listeningDurationMs, options) {
  const settings = options || {};
  const baseTimeoutMs = readNonNegativeInt(
    settings.baseTimeoutMs,
    DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_MS
  );

  if (baseTimeoutMs === 0) {
    return 0;
  }

  const maxTimeoutMs = Math.max(baseTimeoutMs, readNonNegativeInt(
    settings.maxTimeoutMs,
    DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_MAX_MS
  ));
  const scaleMs = readPositiveInt(
    settings.scaleMs,
    DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_SCALE_MS
  );
  const curveMs = readPositiveInt(
    settings.curveMs,
    DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_CURVE_MS
  );
  const durationMs = readNonNegativeInt(listeningDurationMs, 0);
  const dynamicExtraMs = Math.round(Math.pow(durationMs / scaleMs, 2) * curveMs);

  return Math.min(maxTimeoutMs, baseTimeoutMs + dynamicExtraMs);
}

/**
 * 创建听写 session 状态控制器。
 *
 * 它只管理“开始是否到达网页”“停止后是否看到 transcribe request”
 * 和相关 timer，不直接操作 Electron window 或 overlay。
 *
 * @param {object} [options] 可选依赖和 timeout 设置。
 * @returns {object} session controller。
 */
function createDictationSession(options) {
  const settings = options || {};
  const logger = settings.logger || defaultLogger();
  const setTimeoutFn = settings.setTimeoutFn || setTimeout;
  const clearTimeoutFn = settings.clearTimeoutFn || clearTimeout;
  const startConfirmationMs = readNonNegativeInt(
    settings.startConfirmationMs,
    DEFAULT_START_CONFIRMATION_MS
  );
  const transcribeRequestTimeoutMs = readNonNegativeInt(
    settings.transcribeRequestTimeoutMs,
    DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_MS
  );
  const transcribeRequestTimeoutMaxMs = readNonNegativeInt(
    settings.transcribeRequestTimeoutMaxMs,
    DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_MAX_MS
  );
  const transcribeRequestTimeoutScaleMs = readPositiveInt(
    settings.transcribeRequestTimeoutScaleMs,
    DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_SCALE_MS
  );
  const maxStartRetries = readNonNegativeInt(
    settings.maxStartRetries,
    DEFAULT_MAX_START_RETRIES
  );
  const nowFn = typeof settings.nowFn === 'function' ? settings.nowFn : Date.now;
  let phase = DICTATION_PHASES.IDLE;
  let mediaRequestSeen = false;
  let transcribeRequestSeen = false;
  let startRetryCount = 0;
  let startConfirmationTimer = null;
  let transcribeRequestTimer = null;
  let listeningStartedAtMs = null;
  let lastListeningDurationMs = 0;
  let activeTranscribeRequestTimeoutMs = transcribeRequestTimeoutMs;

  function clearStartConfirmationTimer() {
    if (startConfirmationTimer) {
      clearTimeoutFn(startConfirmationTimer);
      startConfirmationTimer = null;
    }
  }

  function clearTranscribeRequestTimer() {
    if (transcribeRequestTimer) {
      clearTimeoutFn(transcribeRequestTimer);
      transcribeRequestTimer = null;
    }
  }

  function getSnapshot() {
    return {
      listeningDurationMs: getListeningDurationMs(),
      mediaRequestSeen: mediaRequestSeen,
      phase: phase,
      startRetryCount: startRetryCount,
      transcribeRequestSeen: transcribeRequestSeen,
      transcribeRequestTimeoutMs: activeTranscribeRequestTimeoutMs
    };
  }

  function getListeningDurationMs() {
    if (listeningStartedAtMs === null) {
      return lastListeningDurationMs;
    }

    return Math.max(0, nowFn() - listeningStartedAtMs);
  }

  function scheduleStartConfirmationTimer() {
    clearStartConfirmationTimer();

    if (startConfirmationMs === 0) {
      return;
    }

    startConfirmationTimer = setTimeoutFn(function onStartConfirmationTimeout() {
      startConfirmationTimer = null;

      if (phase !== DICTATION_PHASES.LISTENING || mediaRequestSeen) {
        return;
      }

      if (startRetryCount < maxStartRetries && typeof settings.retryStart === 'function') {
        startRetryCount += 1;
        logger.warn('dictation.start.unconfirmed_retry', {
          maxRetries: maxStartRetries,
          retry: startRetryCount,
          timeoutMs: startConfirmationMs
        });
        settings.retryStart({
          reason: 'media_request_not_observed',
          retry: startRetryCount
        });
        return;
      }

      logger.warn('dictation.start.unconfirmed', {
        maxRetries: maxStartRetries,
        timeoutMs: startConfirmationMs
      });

      if (typeof settings.onStartUnconfirmed === 'function') {
        settings.onStartUnconfirmed(getSnapshot());
      }
    }, startConfirmationMs);
  }

  function scheduleTranscribeRequestTimer() {
    clearTranscribeRequestTimer();

    if (activeTranscribeRequestTimeoutMs === 0) {
      return;
    }

    transcribeRequestTimer = setTimeoutFn(function onTranscribeRequestTimeout() {
      transcribeRequestTimer = null;

      if (
        phase !== DICTATION_PHASES.PROCESSING ||
        transcribeRequestSeen
      ) {
        return;
      }

      logger.warn('dictation.transcribe_request.timeout', {
        listeningDurationMs: lastListeningDurationMs,
        timeoutMs: activeTranscribeRequestTimeoutMs
      });

      if (typeof settings.onMissingTranscribeRequest === 'function') {
        settings.onMissingTranscribeRequest(getSnapshot());
      }
    }, activeTranscribeRequestTimeoutMs);
  }

  function resetToIdle() {
    clearStartConfirmationTimer();
    clearTranscribeRequestTimer();
    phase = DICTATION_PHASES.IDLE;
    mediaRequestSeen = false;
    transcribeRequestSeen = false;
    startRetryCount = 0;
    listeningStartedAtMs = null;
    lastListeningDurationMs = 0;
    activeTranscribeRequestTimeoutMs = transcribeRequestTimeoutMs;
  }

  return {
    /**
     * 判断当前是否允许发送 stop 快捷键。
     *
     * @returns {boolean} 当前处于 listening 时返回 `true`。
     */
    canSendStop: function canSendStop() {
      return phase === DICTATION_PHASES.LISTENING;
    },

    /**
     * 取消当前 session，并清理所有等待 timer。
     */
    cancel: function cancel() {
      resetToIdle();
      logger.info('dictation.session.cancelled');
    },

    /**
     * 返回当前 session 快照，便于测试和诊断日志使用。
     *
     * @returns {object} 当前状态快照。
     */
    getSnapshot: getSnapshot,

    /**
     * 标记 start 快捷键已经发送到网页。
     */
    markStartShortcutSent: function markStartShortcutSent() {
      clearTranscribeRequestTimer();
      phase = DICTATION_PHASES.LISTENING;
      mediaRequestSeen = false;
      transcribeRequestSeen = false;
      listeningStartedAtMs = nowFn();
      lastListeningDurationMs = 0;
      activeTranscribeRequestTimeoutMs = transcribeRequestTimeoutMs;
      logger.info('dictation.start.sent_waiting_for_media_request', {
        startConfirmationMs: startConfirmationMs,
        startRetryCount: startRetryCount
      });
      scheduleStartConfirmationTimer();
    },

    /**
     * 标记 ChatGPT 页面已经请求 media 权限。
     *
     * 这是当前可观察到的“网页端收到了开始听写快捷键并尝试打开麦克风”的信号。
     */
    markTrustedMediaRequest: function markTrustedMediaRequest() {
      if (phase !== DICTATION_PHASES.LISTENING) {
        logger.debug('dictation.media_request_ignored_inactive', {
          phase: phase
        });
        return false;
      }

      if (!mediaRequestSeen) {
        mediaRequestSeen = true;
        clearStartConfirmationTimer();
        logger.info('dictation.start.confirmed', {
          signal: 'trusted_media_request',
          startRetryCount: startRetryCount
        });
      }

      return true;
    },

    /**
     * 标记 stop 快捷键已经发送到网页，并开始等待 transcribe request。
     *
     * @returns {boolean} 成功进入 processing 时返回 `true`。
     */
    markStopShortcutSent: function markStopShortcutSent() {
      if (phase !== DICTATION_PHASES.LISTENING) {
        logger.warn('dictation.stop.ignored_not_listening', {
          phase: phase
        });
        return false;
      }

      clearStartConfirmationTimer();
      lastListeningDurationMs = getListeningDurationMs();
      listeningStartedAtMs = null;
      activeTranscribeRequestTimeoutMs = calculateTranscribeRequestTimeoutMs(
        lastListeningDurationMs,
        {
          baseTimeoutMs: transcribeRequestTimeoutMs,
          maxTimeoutMs: transcribeRequestTimeoutMaxMs,
          scaleMs: transcribeRequestTimeoutScaleMs
        }
      );
      phase = DICTATION_PHASES.PROCESSING;
      transcribeRequestSeen = false;
      logger.info('dictation.stop.sent_waiting_for_transcribe_request', {
        listeningDurationMs: lastListeningDurationMs,
        timeoutMs: activeTranscribeRequestTimeoutMs
      });
      scheduleTranscribeRequestTimer();
      return true;
    },

    /**
     * 标记已经看到 ChatGPT transcribe request。
     *
     * 看到 request 后不再使用固定 15 秒 response timeout；后续等待
     * network response、DOM fallback、用户取消或明确失败。
     */
    markTranscribeRequestStarted: function markTranscribeRequestStarted(payload) {
      if (
        phase !== DICTATION_PHASES.PROCESSING &&
        phase !== DICTATION_PHASES.WAITING_RESPONSE
      ) {
        logger.debug('dictation.transcribe_request_ignored_inactive', {
          phase: phase,
          requestId: payload && payload.requestId
        });
        return false;
      }

      transcribeRequestSeen = true;
      phase = DICTATION_PHASES.WAITING_RESPONSE;
      clearTranscribeRequestTimer();
      logger.info('dictation.transcribe_request.observed', {
        requestId: payload && payload.requestId
      });
      return true;
    },

    /**
     * 标记本轮已经完成或失败，并回到 idle。
     */
    reset: function reset() {
      resetToIdle();
    }
  };
}

module.exports = {
  DEFAULT_MAX_START_RETRIES: DEFAULT_MAX_START_RETRIES,
  DEFAULT_START_CONFIRMATION_MS: DEFAULT_START_CONFIRMATION_MS,
  DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_MAX_MS: DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_MAX_MS,
  DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_MS: DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_MS,
  DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_SCALE_MS: DEFAULT_TRANSCRIBE_REQUEST_TIMEOUT_SCALE_MS,
  DICTATION_PHASES: DICTATION_PHASES,
  calculateTranscribeRequestTimeoutMs: calculateTranscribeRequestTimeoutMs,
  createDictationSession: createDictationSession
};
