'use strict';

const childProcess = require('child_process');

const WINDOWS_SYSTEM_SOUNDS = {
  asterisk: 'Asterisk',
  beep: 'Beep',
  exclamation: 'Exclamation',
  hand: 'Hand',
  question: 'Question'
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

function normalizeSystemSoundName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return WINDOWS_SYSTEM_SOUNDS[normalized] || WINDOWS_SYSTEM_SOUNDS.asterisk;
}

function buildPlayWindowsSystemSoundCommand(name) {
  return '[System.Media.SystemSounds]::' + normalizeSystemSoundName(name) + '.Play(); ' +
    'Start-Sleep -Milliseconds 320';
}

/**
 * 播放 Windows 系统提示音。
 *
 * 非 Windows 环境直接返回 `false`，这样 WSL/Linux 开发环境可以跑测试而不
 * 触发真实系统声音。默认使用 `Asterisk`，接近 Windows 的普通提示音。
 *
 * @param {string} [name] Windows system sound 名称。
 * @param {object} [options] 可选依赖。
 * @param {object} [options.logger] 可选 logger。
 * @param {Function} [options.spawn] 可选 spawn 函数，主要用于测试。
 * @param {string} [options.platform] 可选 platform，主要用于测试。
 * @returns {boolean} 已发出播放请求时返回 `true`。
 */
function playWindowsSystemSound(name, options) {
  const soundOptions = options || {};
  const logger = soundOptions.logger || defaultLogger();
  const platform = soundOptions.platform || process.platform;
  const spawn = soundOptions.spawn || childProcess.spawn;
  const soundName = normalizeSystemSoundName(name);

  if (platform !== 'win32') {
    logger.debug('sound.play.skipped', {
      platform: platform,
      sound: soundName
    });
    return false;
  }

  try {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      buildPlayWindowsSystemSoundCommand(soundName)
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });

    logger.info('sound.play.spawned', {
      pid: child && child.pid,
      sound: soundName
    });

    if (child && typeof child.once === 'function') {
      child.once('error', function onSoundProcessError(error) {
        logger.warn('sound.play.process_error', {
          error: error && error.message ? error.message : String(error),
          sound: soundName
        });
      });
      child.once('close', function onSoundProcessClosed(code, signal) {
        const payload = {
          exitCode: code,
          signal: signal,
          sound: soundName
        };

        if (code === 0) {
          logger.debug('sound.play.process_closed', payload);
          return;
        }

        logger.warn('sound.play.process_closed', payload);
      });
    }

    if (child && typeof child.unref === 'function') {
      child.unref();
    }

    return true;
  } catch (error) {
    logger.error('sound.play.spawn_failed', {
      error: error
    });
    return false;
  }
}

module.exports = {
  buildPlayWindowsSystemSoundCommand: buildPlayWindowsSystemSoundCommand,
  normalizeSystemSoundName: normalizeSystemSoundName,
  playWindowsSystemSound: playWindowsSystemSound
};
