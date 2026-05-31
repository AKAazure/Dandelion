'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildLogFilePath,
  cleanupOldLogs,
  createAppLogger,
  normalizeLogLevel,
  sanitizeLogDetails
} = require('../src/main/appLogger');

function readLogLines(logFilePath) {
  return fs.readFileSync(logFilePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function run() {
  assert.strictEqual(normalizeLogLevel('INFO'), 'info');
  assert.strictEqual(normalizeLogLevel('bad'), 'info');
  assert.deepStrictEqual(sanitizeLogDetails({
    text: 'secret transcript',
    token: 'abc123',
    url: 'https://chatgpt.com/backend-api/transcribe?secret=1',
    nested: {
      errorText: 'Internal Server Error'
    }
  }), {
    text: '[redacted length=17]',
    token: '[redacted length=6]',
    url: {
      origin: 'https://chatgpt.com',
      pathname: '/backend-api/transcribe'
    },
    nested: {
      errorText: 'Internal Server Error'
    }
  });

  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-stt-logs-'));
  const now = new Date('2026-05-16T12:34:56.000Z');
  const consoleCalls = [];
  const logger = createAppLogger({
    console: {
      debug: function debug(event, details) {
        consoleCalls.push(['debug', event, details]);
      },
      error: function error(event, details) {
        consoleCalls.push(['error', event, details]);
      },
      info: function info(event, details) {
        consoleCalls.push(['info', event, details]);
      },
      warn: function warn(event, details) {
        consoleCalls.push(['warn', event, details]);
      }
    },
    level: 'info',
    logDir: logDir,
    nowFn: function nowFn() {
      return now;
    },
    retentionDays: 7
  });

  assert.strictEqual(logger.debug('debug.skipped'), false);
  assert.strictEqual(logger.info('dictation.started', {
    source: 'test',
    text: 'hello world'
  }), true);
  assert.strictEqual(logger.warn('dictation.warning'), true);

  const logFilePath = buildLogFilePath(logDir, now);
  const entries = readLogLines(logFilePath);

  assert.strictEqual(entries.length, 2);
  assert.deepStrictEqual(entries[0], {
    ts: '2026-05-16T12:34:56.000Z',
    level: 'info',
    event: 'dictation.started',
    details: {
      source: 'test',
      text: '[redacted length=11]'
    }
  });
  assert.strictEqual(entries[1].event, 'dictation.warning');
  assert.deepStrictEqual(consoleCalls.map((call) => call[0]), ['info', 'warn']);
  assert.strictEqual(logger.getLogDir(), logDir);

  const oldLogPath = path.join(logDir, 'app-2026-05-01.log');
  const recentLogPath = path.join(logDir, 'app-2026-05-15.log');
  fs.writeFileSync(oldLogPath, '{}\n');
  fs.writeFileSync(recentLogPath, '{}\n');

  assert.strictEqual(cleanupOldLogs(logDir, 7, now), 1);
  assert.strictEqual(fs.existsSync(oldLogPath), false);
  assert.strictEqual(fs.existsSync(recentLogPath), true);

  const disabledLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-stt-disabled-'));
  const disabledLogger = createAppLogger({
    console: {
      info: function info() {}
    },
    enabled: false,
    logDir: disabledLogDir,
    nowFn: function nowFn() {
      return now;
    }
  });

  assert.strictEqual(disabledLogger.info('disabled.logger'), true);
  assert.deepStrictEqual(fs.readdirSync(disabledLogDir), []);
}

module.exports = {
  run: run
};
