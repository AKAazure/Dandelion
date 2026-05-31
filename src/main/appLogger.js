'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_LEVEL = 'info';
const DEFAULT_RETENTION_DAYS = 7;
const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const SENSITIVE_KEYS = [
  'authorization',
  'body',
  'clipboard',
  'cookie',
  'cookies',
  'password',
  'responsebody',
  'text',
  'token',
  'transcript',
  'transcription'
];

function noop() {}

function defaultConsole() {
  return {
    debug: noop,
    error: noop,
    info: noop,
    warn: noop
  };
}

/**
 * 标准化日志级别。
 *
 * @param {string} level 原始日志级别。
 * @returns {string} 合法日志级别。
 */
function normalizeLogLevel(level) {
  const normalized = String(level || '').trim().toLowerCase();

  if (Object.prototype.hasOwnProperty.call(LOG_LEVELS, normalized)) {
    return normalized;
  }

  return DEFAULT_LOG_LEVEL;
}

function normalizeRetentionDays(value) {
  const normalized = Number.parseInt(value, 10);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return DEFAULT_RETENTION_DAYS;
  }

  return normalized;
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

/**
 * 按本地时区生成日志文件日期。
 *
 * 日志内容里的 `ts` 保持 ISO UTC 时间，便于跨机器比较；日志文件名使用
 * 本地日期，方便用户按当天定位 `app-YYYY-MM-DD.log`。
 *
 * @param {Date} date 日期对象。
 * @returns {string} `YYYY-MM-DD` 日期字符串。
 */
function getDateStamp(date) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate())
  ].join('-');
}

/**
 * 构造每日 JSONL 日志文件路径。
 *
 * @param {string} logDir 日志目录。
 * @param {Date} date 当前日期。
 * @returns {string} 日志文件路径。
 */
function buildLogFilePath(logDir, date) {
  return path.join(logDir, 'app-' + getDateStamp(date) + '.log');
}

function shouldLogLevel(currentLevel, requestedLevel) {
  return LOG_LEVELS[requestedLevel] >= LOG_LEVELS[currentLevel];
}

function normalizeEventName(event) {
  const normalized = String(event || '').trim();
  return normalized || 'app.log';
}

function safeUrl(value) {
  try {
    const parsed = new URL(String(value));
    return {
      origin: parsed.origin,
      pathname: parsed.pathname
    };
  } catch (error) {
    return String(value || '');
  }
}

function redactValue(value) {
  const text = String(value || '');
  return '[redacted length=' + text.length + ']';
}

function isSensitiveKey(key) {
  const normalized = String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SENSITIVE_KEYS.indexOf(normalized) !== -1 ||
    normalized.indexOf('token') !== -1 ||
    normalized.indexOf('cookie') !== -1 ||
    normalized.indexOf('secret') !== -1;
}

function isUrlKey(key) {
  const normalized = String(key || '').toLowerCase();
  return normalized === 'url' ||
    normalized === 'rawurl' ||
    normalized === 'requestingurl' ||
    normalized.endsWith('url');
}

/**
 * 清理日志 details，避免把 transcript、cookie、token 等敏感内容写入本地日志。
 *
 * @param {*} value 原始 details value。
 * @param {string} [key] 当前字段名。
 * @param {number} [depth] 当前递归深度。
 * @returns {*} 可安全写入日志的 value。
 */
function sanitizeLogDetails(value, key, depth) {
  const currentDepth = Number.isFinite(depth) ? depth : 0;

  if (key && isSensitiveKey(key)) {
    return redactValue(value);
  }

  if (key && isUrlKey(key)) {
    return safeUrl(value);
  }

  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack
    };
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (currentDepth >= 5) {
    return '[truncated]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogDetails(item, '', currentDepth + 1));
  }

  return Object.keys(value).reduce((result, childKey) => {
    result[childKey] = sanitizeLogDetails(value[childKey], childKey, currentDepth + 1);
    return result;
  }, {});
}

/**
 * 删除超过保留天数的本地日志文件。
 *
 * @param {string} logDir 日志目录。
 * @param {number} retentionDays 保留天数。
 * @param {Date} now 当前日期。
 * @returns {number} 删除的日志文件数量。
 */
function cleanupOldLogs(logDir, retentionDays, now) {
  if (!logDir || !fs.existsSync(logDir)) {
    return 0;
  }

  const keepDays = normalizeRetentionDays(retentionDays);
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - keepDays + 1);
  const entries = fs.readdirSync(logDir);
  let deleted = 0;

  entries.forEach((entry) => {
    const match = /^app-(\d{4}-\d{2}-\d{2})\.log$/.exec(entry);

    if (!match) {
      return;
    }

    const entryDate = new Date(match[1] + 'T00:00:00');

    if (entryDate < cutoff) {
      fs.unlinkSync(path.join(logDir, entry));
      deleted += 1;
    }
  });

  return deleted;
}

/**
 * 创建 app 本地 JSONL logger。
 *
 * logger 保持和现有模块一致的 `debug/info/warn/error(event, details)` 调用
 * 方式。默认 mirror 到 console，同时在 enabled 时写入每日 JSONL 文件。
 *
 * @param {object} options logger 配置。
 * @param {string} options.logDir 日志目录。
 * @param {boolean} [options.enabled] 是否写入本地文件。
 * @param {string} [options.level] 最低日志级别。
 * @param {number} [options.retentionDays] 日志保留天数。
 * @param {object} [options.console] console 兼容对象。
 * @param {Function} [options.nowFn] 当前时间函数，主要用于测试。
 * @returns {object} logger。
 */
function createAppLogger(options) {
  const loggerOptions = options || {};
  const enabled = loggerOptions.enabled !== false;
  const logDir = loggerOptions.logDir || '';
  const level = normalizeLogLevel(loggerOptions.level);
  const retentionDays = normalizeRetentionDays(loggerOptions.retentionDays);
  const consoleApi = loggerOptions.console || defaultConsole();
  const nowFn = typeof loggerOptions.nowFn === 'function' ? loggerOptions.nowFn : () => new Date();
  let cleanupDone = false;

  function ensureReady() {
    if (!enabled || !logDir) {
      return;
    }

    fs.mkdirSync(logDir, { recursive: true });

    if (!cleanupDone) {
      try {
        cleanupOldLogs(logDir, retentionDays, nowFn());
      } catch (error) {
        if (consoleApi && typeof consoleApi.warn === 'function') {
          consoleApi.warn('app.logger.cleanup_failed', error.message);
        }
      } finally {
        cleanupDone = true;
      }
    }
  }

  function write(levelName, event, details) {
    const normalizedLevel = normalizeLogLevel(levelName);

    if (!shouldLogLevel(level, normalizedLevel)) {
      return false;
    }

    const timestamp = nowFn();
    const entry = {
      ts: timestamp.toISOString(),
      level: normalizedLevel,
      event: normalizeEventName(event)
    };

    if (details !== undefined) {
      entry.details = sanitizeLogDetails(details);
    }

    if (consoleApi && typeof consoleApi[normalizedLevel] === 'function') {
      consoleApi[normalizedLevel](entry.event, entry.details || '');
    }

    if (!enabled || !logDir) {
      return true;
    }

    try {
      ensureReady();
      fs.appendFileSync(buildLogFilePath(logDir, timestamp), JSON.stringify(entry) + '\n', 'utf8');
      return true;
    } catch (error) {
      if (consoleApi && typeof consoleApi.error === 'function') {
        consoleApi.error('app.logger.write_failed', error.message);
      }
      return false;
    }
  }

  return {
    debug: function debug(event, details) {
      return write('debug', event, details);
    },
    error: function error(event, details) {
      return write('error', event, details);
    },
    getLogDir: function getLogDir() {
      return logDir;
    },
    info: function info(event, details) {
      return write('info', event, details);
    },
    warn: function warn(event, details) {
      return write('warn', event, details);
    }
  };
}

module.exports = {
  DEFAULT_LOG_LEVEL: DEFAULT_LOG_LEVEL,
  DEFAULT_RETENTION_DAYS: DEFAULT_RETENTION_DAYS,
  LOG_LEVELS: LOG_LEVELS,
  buildLogFilePath: buildLogFilePath,
  cleanupOldLogs: cleanupOldLogs,
  createAppLogger: createAppLogger,
  getDateStamp: getDateStamp,
  normalizeLogLevel: normalizeLogLevel,
  sanitizeLogDetails: sanitizeLogDetails
};
