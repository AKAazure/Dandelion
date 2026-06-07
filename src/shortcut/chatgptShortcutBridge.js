'use strict';

const ELECTRON_MODIFIER_ALIASES = {
  alt: 'Alt',
  option: 'Alt',
  cmd: 'Command',
  command: 'Command',
  cmdorctrl: 'CommandOrControl',
  commandorcontrol: 'CommandOrControl',
  control: 'Control',
  ctrl: 'Control',
  meta: 'Super',
  shift: 'Shift',
  super: 'Super',
  win: 'Super',
  windows: 'Super'
};

const ELECTRON_KEY_ALIASES = {
  apostrophe: "'",
  backquote: '`',
  backslash: '\\',
  closebracket: ']',
  comma: ',',
  dot: '.',
  esc: 'Esc',
  escape: 'Esc',
  greater: '>',
  greaterthan: '>',
  grave: '`',
  less: '<',
  lessthan: '<',
  minus: '-',
  openbracket: '[',
  period: '.',
  quote: "'",
  semicolon: ';',
  slash: '/'
};

const WEB_MODIFIER_ALIASES = {
  alt: 'alt',
  option: 'alt',
  command: 'meta',
  control: 'control',
  ctrl: 'control',
  meta: 'meta',
  shift: 'shift',
  super: 'meta',
  win: 'meta',
  windows: 'meta'
};

const WEB_KEY_ALIASES = {
  esc: 'Escape',
  escape: 'Escape'
};

const DEFAULT_CHATGPT_DICTATION_CHORD = {
  keyCode: 'D',
  modifiers: ['control', 'shift']
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

function isPromiseLike(value) {
  return value && typeof value.then === 'function';
}

function readNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function normalizeKeyToken(token) {
  if (token.length === 1) {
    return token.toUpperCase();
  }

  return token[0].toUpperCase() + token.slice(1);
}

function splitChord(chord) {
  if (typeof chord !== 'string') {
    throw new TypeError('Shortcut chord must be a string.');
  }

  const parts = chord
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error('Shortcut chord cannot be empty.');
  }

  return parts;
}

/**
 * 把用户配置的 binding 标准化成 Electron accelerator 字符串。
 *
 * Electron 已经支持多种 accelerator 写法，但在配置和测试里保留统一格式，
 * 可以避免把 `ctrl+shift+r`、`Control+Shift+R` 这类等价写法当成不同 binding。
 *
 * @param {string} binding 用户配置的 binding，例如 `Alt+Shift+R`。
 * @returns {string} Electron accelerator，例如 `Alt+Shift+R`。
 */
function normalizeElectronAccelerator(binding) {
  const parts = splitChord(binding);
  const modifiers = [];
  let key = null;

  parts.forEach((rawPart) => {
    const normalizedPart = rawPart.replace(/\s+/g, '').toLowerCase();

    if (normalizedPart === 'fn') {
      throw new Error('Fn key is not supported because it is handled by keyboard firmware.');
    }

    const modifier = ELECTRON_MODIFIER_ALIASES[normalizedPart];

    if (modifier) {
      if (modifiers.indexOf(modifier) === -1) {
        modifiers.push(modifier);
      }
      return;
    }

    if (key) {
      throw new Error('Shortcut chord must contain exactly one non-modifier key.');
    }

    key = ELECTRON_KEY_ALIASES[normalizedPart] || normalizeKeyToken(rawPart.replace(/\s+/g, ''));
  });

  if (!key) {
    throw new Error('Shortcut chord must contain one non-modifier key.');
  }

  return modifiers.concat(key).join('+');
}

/**
 * 把网页目标组合键标准化成 `webContents.sendInputEvent` 接受的格式。
 *
 * 当前默认目标是 ChatGPT 的 `Ctrl+Shift+D` 听写快捷键，同时保留可注入的
 * target chord，方便测试，也方便以后网页快捷键变化时调整。
 *
 * @param {string|object} chord 目标组合键字符串，或 `{ keyCode, modifiers }`。
 * @returns {{ keyCode: string, modifiers: string[] }} 标准化后的 web chord。
 */
function normalizeWebChord(chord) {
  if (!chord) {
    return {
      keyCode: DEFAULT_CHATGPT_DICTATION_CHORD.keyCode,
      modifiers: DEFAULT_CHATGPT_DICTATION_CHORD.modifiers.slice()
    };
  }

  if (typeof chord === 'object') {
    if (!chord.keyCode) {
      throw new Error('Target chord object must include keyCode.');
    }

    return {
      keyCode: normalizeKeyToken(String(chord.keyCode).trim()),
      modifiers: normalizeWebModifiers(chord.modifiers || [])
    };
  }

  const parts = splitChord(chord);
  const modifiers = [];
  let keyCode = null;

  parts.forEach((rawPart) => {
    const normalizedPart = rawPart.replace(/\s+/g, '').toLowerCase();
    const modifier = WEB_MODIFIER_ALIASES[normalizedPart];

    if (modifier) {
      if (modifiers.indexOf(modifier) === -1) {
        modifiers.push(modifier);
      }
      return;
    }

    if (keyCode) {
      throw new Error('Target chord must contain exactly one non-modifier key.');
    }

    keyCode = WEB_KEY_ALIASES[normalizedPart] || normalizeKeyToken(rawPart.replace(/\s+/g, ''));
  });

  if (!keyCode) {
    throw new Error('Target chord must contain one non-modifier key.');
  }

  return {
    keyCode: keyCode,
    modifiers: modifiers
  };
}

function normalizeWebModifiers(modifiers) {
  if (!Array.isArray(modifiers)) {
    throw new TypeError('Target chord modifiers must be an array.');
  }

  return modifiers.reduce((result, rawModifier) => {
    const modifier = WEB_MODIFIER_ALIASES[String(rawModifier).trim().toLowerCase()];

    if (!modifier) {
      throw new Error('Unsupported target chord modifier: ' + rawModifier);
    }

    if (result.indexOf(modifier) === -1) {
      result.push(modifier);
    }

    return result;
  }, []);
}

/**
 * 构造触发 ChatGPT 页面级快捷键所需的 rawKeyDown 事件。
 *
 * ChatGPT 的听写入口只需要快捷键按下阶段。这里不发送 keyUp，避免页面在
 * 停止录音时把释放阶段也解释成一次额外的快捷键输入。
 *
 * @param {{ keyCode: string, modifiers: string[] }} chord 标准化后的 web chord。
 * @returns {Array<object>} Electron input events。
 */
function buildWebKeyEvents(chord) {
  const normalizedChord = normalizeWebChord(chord);

  return [
    {
      type: 'rawKeyDown',
      keyCode: normalizedChord.keyCode,
      modifiers: normalizedChord.modifiers.slice()
    }
  ];
}

function assertBridgeOptions(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Bridge options are required.');
  }

  if (!options.customBinding) {
    throw new Error('customBinding is required.');
  }

  if (!options.globalShortcut || typeof options.globalShortcut.register !== 'function') {
    throw new TypeError('globalShortcut.register is required.');
  }

  if (typeof options.globalShortcut.unregister !== 'function') {
    throw new TypeError('globalShortcut.unregister is required.');
  }

  if (!options.webContents || typeof options.webContents.sendInputEvent !== 'function') {
    throw new TypeError('webContents.sendInputEvent is required.');
  }
}

/**
 * 创建从宿主自定义 binding 到 ChatGPT 网页快捷键的桥接 controller。
 *
 * 宿主应用应在启动时调用 `start()`，退出时调用 `stop()`。当用户按下
 * `customBinding` 时，bridge 会把 `Ctrl+Shift+D` 发送进内嵌 ChatGPT 页面，
 * 用户不需要在系统层直接按 ChatGPT 原始快捷键。
 *
 * @param {object} options bridge 依赖和设置。
 * @param {object} options.globalShortcut Electron `globalShortcut` 兼容对象。
 * @param {object} options.webContents ChatGPT 页面对应的 Electron `WebContents`。
 * @param {string} options.customBinding 用户配置的宿主 binding。
 * @param {string|object} [options.targetChord] 网页 chord，默认是 `Ctrl+Shift+D`。
 * @param {boolean} [options.focusBeforeSend] 发送按键前是否 focus 网页，默认 `false`。
 * @param {Function} [options.beforeSend] 发送按键前调用，可返回 afterSend context。
 * context 里设置 `skipSend: true` 时不会向网页发送快捷键。
 * @param {Function} [options.afterSend] 发送按键后调用，接收 beforeSend 返回值。
 * @param {object} [options.logger] 可选 logger，支持 debug/info/warn/error。
 * @returns {object} 包含 `start`、`stop`、`trigger` 的 bridge controller。
 */
function createChatGptShortcutBridge(options) {
  assertBridgeOptions(options);

  const accelerator = normalizeElectronAccelerator(options.customBinding);
  const focusBeforeSend = options.focusBeforeSend === true;
  const targetChord = normalizeWebChord(options.targetChord);
  const logger = options.logger || defaultLogger();
  const defaultDispatchDelayMs = readNonNegativeInt(options.dispatchDelayMs, 0);
  let registered = false;

  function log(level, message, details) {
    if (logger && typeof logger[level] === 'function') {
      logger[level](message, details);
    }
  }

  function isWebContentsDestroyed() {
    return (
      typeof options.webContents.isDestroyed === 'function' &&
      options.webContents.isDestroyed()
    );
  }

  function focusWebContents() {
    if (typeof options.webContents.focus === 'function') {
      options.webContents.focus();
    }
  }

  /**
   * 注册宿主自定义 binding。
   *
   * @returns {boolean} binding 注册成功或已经处于激活状态时返回 `true`。
   */
  function start() {
    if (registered) {
      return true;
    }

    let ok = false;

    try {
      ok = options.globalShortcut.register(accelerator, trigger);
    } catch (error) {
      log('error', 'shortcut_bridge.register_failed', {
        accelerator: accelerator,
        error: error.message
      });
      return false;
    }

    if (!ok) {
      log('error', 'shortcut_bridge.register_failed', {
        accelerator: accelerator
      });
      return false;
    }

    registered = true;
    log('debug', 'shortcut_bridge.registered', {
      accelerator: accelerator,
      targetChord: targetChord
    });
    return true;
  }

  /**
   * 注销宿主自定义 binding。
   */
  function stop() {
    if (!registered) {
      return;
    }

    options.globalShortcut.unregister(accelerator);
    registered = false;
    log('debug', 'shortcut_bridge.unregistered', {
      accelerator: accelerator
    });
  }

  /**
   * 立即向内嵌页面发送 ChatGPT 听写快捷键。
   *
   * @returns {boolean} 事件已经发送给页面时返回 `true`。
   */
  function trigger() {
    if (isWebContentsDestroyed()) {
      log('warn', 'shortcut_bridge.trigger_skipped_destroyed', {
        accelerator: accelerator
      });
      return false;
    }

    let hookContext = null;
    let scheduledAsyncDispatch = false;

    function sendShortcutEvents() {
      if (isWebContentsDestroyed()) {
        log('warn', 'shortcut_bridge.trigger_skipped_destroyed', {
          accelerator: accelerator
        });
        return false;
      }

      if (focusBeforeSend) {
        focusWebContents();
      }
      buildWebKeyEvents(targetChord).forEach((event) => {
        options.webContents.sendInputEvent(event);
      });

      log('debug', 'shortcut_bridge.web_events_sent', {
        accelerator: accelerator,
        targetChord: targetChord
      });
      return true;
    }

    function finishAfterSend() {
      if (typeof options.afterSend === 'function') {
        options.afterSend(hookContext);
      }
    }

    try {
      if (typeof options.beforeSend === 'function') {
        hookContext = options.beforeSend({
          accelerator: accelerator,
          targetChord: targetChord
        });
      }

      const readyToSend = hookContext && hookContext.readyToSend;
      const dispatchDelayMs = readNonNegativeInt(
        hookContext && hookContext.dispatchDelayMs,
        defaultDispatchDelayMs
      );

      if (hookContext && hookContext.skipSend) {
        log('debug', 'shortcut_bridge.trigger_skipped_by_before_send', {
          accelerator: accelerator,
          reason: hookContext.skipReason || ''
        });
        return false;
      }

      if (isPromiseLike(readyToSend) || dispatchDelayMs > 0) {
        scheduledAsyncDispatch = true;
        Promise.resolve(readyToSend)
          .catch((error) => {
            log('warn', 'shortcut_bridge.before_send_failed_continue', {
              accelerator: accelerator,
              error: error && error.message ? error.message : String(error)
            });
          })
          .then(() => {
            setTimeout(() => {
              try {
                sendShortcutEvents();
              } finally {
                finishAfterSend();
              }
            }, dispatchDelayMs);
          });
        return true;
      }

      sendShortcutEvents();
    } finally {
      if (!scheduledAsyncDispatch) {
        finishAfterSend();
      }
    }
    return true;
  }

  /**
   * 返回宿主 binding 当前是否已经注册。
   *
   * @returns {boolean} 注册状态。
   */
  function isRegistered() {
    return registered;
  }

  return {
    accelerator: accelerator,
    targetChord: {
      keyCode: targetChord.keyCode,
      modifiers: targetChord.modifiers.slice()
    },
    start: start,
    stop: stop,
    trigger: trigger,
    isRegistered: isRegistered
  };
}

module.exports = {
  DEFAULT_CHATGPT_DICTATION_CHORD: DEFAULT_CHATGPT_DICTATION_CHORD,
  buildWebKeyEvents: buildWebKeyEvents,
  createChatGptShortcutBridge: createChatGptShortcutBridge,
  normalizeElectronAccelerator: normalizeElectronAccelerator,
  ELECTRON_KEY_ALIASES: ELECTRON_KEY_ALIASES,
  normalizeWebChord: normalizeWebChord
};
