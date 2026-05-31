'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_LOG_LEVEL,
  DEFAULT_RETENTION_DAYS,
  normalizeLogLevel
} = require('./appLogger');

const DEFAULT_CONFIG = {
  autoPasteTranscript: true,
  chatGptUrl: 'https://chatgpt.com',
  configFileName: path.join('config', 'dandelion.json'),
  cancelDictationBinding: 'Escape',
  cancelDictationTargetChord: 'Escape',
  sessionPartition: 'persist:chatgpt',
  startDictationBinding: 'Alt+Shift+R',
  startDictationTargetChord: 'Ctrl+Shift+D',
  startMode: 'mini',
  stopDictationBinding: 'Alt+Shift+S',
  stopDictationTargetChord: 'Ctrl+Shift+D',
  loggingEnabled: true,
  loggingLevel: DEFAULT_LOG_LEVEL,
  loggingRetentionDays: DEFAULT_RETENTION_DAYS,
  transcriptStableMs: 2500,
  userDataDirName: 'dandelion-electron'
};

const VALID_WINDOW_MODES = ['hidden', 'mini', 'tiny', 'smart', 'corner'];

/**
 * 从环境变量对象读取字符串配置。
 *
 * @param {object} env 环境变量对象。
 * @param {string} name 环境变量名。
 * @param {string} fallback 默认值。
 * @returns {string} 去除前后空白后的配置值。
 */
function readEnv(env, name, fallback) {
  const value = env && env[name];
  return value ? String(value).trim() : fallback;
}

/**
 * 按优先级读取多个环境变量名。
 *
 * @param {object} env 环境变量对象。
 * @param {string[]} names 环境变量名列表，越靠前优先级越高。
 * @param {string} fallback 默认值。
 * @returns {string} 命中的配置值，或默认值。
 */
function readEnvFirst(env, names, fallback) {
  for (let index = 0; index < names.length; index += 1) {
    const value = readEnv(env, names[index], '');

    if (value) {
      return value;
    }
  }

  return fallback;
}

/**
 * 标准化窗口模式。
 *
 * @param {string} mode 原始窗口模式。
 * @returns {string} 合法窗口模式；非法值回退到默认隐藏模式。
 */
function normalizeWindowMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();

  if (VALID_WINDOW_MODES.indexOf(normalized) === -1) {
    return DEFAULT_CONFIG.startMode;
  }

  return normalized;
}

/**
 * 从 CLI 参数里读取 `--name=value` 形式的配置。
 *
 * @param {string[]} argv CLI 参数数组。
 * @param {string} name 参数名，不包含 `--`。
 * @returns {string} 参数值；未找到时返回空字符串。
 */
function readCliValue(argv, name) {
  const prefix = '--' + name + '=';
  const args = argv || [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index]);

    if (arg.indexOf(prefix) === 0) {
      return arg.slice(prefix.length).trim();
    }
  }

  return '';
}

/**
 * 从 CLI 参数里读取 boolean flag。
 *
 * @param {string[]} argv CLI 参数数组。
 * @param {string} name 参数名，不包含 `--`。
 * @returns {boolean} 参数存在时返回 `true`。
 */
function readCliFlag(argv, name) {
  const flag = '--' + name;
  const args = argv || [];

  return args.some((arg) => String(arg) === flag);
}

/**
 * 判断当前是否是 packaged Electron app。
 *
 * `electron .` 开发模式下 `process.defaultApp` 为 `true`，packaged app 中
 * 通常为 `false` 或未定义。Node 单元测试没有 Electron runtime，也会返回
 * `false`。
 *
 * @param {object} [runtimeProcess] process 兼容对象。
 * @returns {boolean} packaged Electron runtime 返回 `true`。
 */
function isPackagedElectronRuntime(runtimeProcess) {
  const currentProcess = runtimeProcess || process;

  return Boolean(
    currentProcess &&
    currentProcess.versions &&
    currentProcess.versions.electron &&
    currentProcess.defaultApp !== true
  );
}

/**
 * 解析默认配置文件根目录。
 *
 * 开发模式使用仓库根目录；packaged app 使用 Electron `resources` 目录，
 * 对应 electron-builder 的 `extraResources` 输出位置。
 *
 * @param {object} [runtimeProcess] process 兼容对象。
 * @returns {string} 默认配置根目录。
 */
function resolveDefaultConfigRoot(runtimeProcess) {
  const currentProcess = runtimeProcess || process;

  if (isPackagedElectronRuntime(currentProcess) && currentProcess.resourcesPath) {
    return currentProcess.resourcesPath;
  }

  return path.join(__dirname, '..', '..');
}

/**
 * 解析默认 userData 目录。
 *
 * 开发模式继续写入仓库 `.runtime`，方便调试和清理；packaged Windows app
 * 写入 `%APPDATA%\Dandelion`，避免把登录态和日志放到安装目录。
 *
 * @param {object} [runtimeProcess] process 兼容对象。
 * @returns {string} 默认 userData 目录。
 */
function resolveDefaultUserDataDir(runtimeProcess) {
  const currentProcess = runtimeProcess || process;

  if (isPackagedElectronRuntime(currentProcess)) {
    const appDataRoot = readEnv(currentProcess.env || {}, 'APPDATA', '') ||
      path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appDataRoot, 'Dandelion');
  }

  return path.join(process.cwd(), '.runtime', DEFAULT_CONFIG.userDataDirName);
}

/**
 * 解析实际使用的配置文件路径。
 *
 * 优先级是 CLI `--config`、环境变量 `GENERAL_STT_CONFIG_FILE`、默认
 * `config/dandelion.json`。相对路径会基于 `cwd` 或默认配置根目录解析。
 *
 * @param {object} env 环境变量对象。
 * @param {string[]} argv CLI 参数数组。
 * @param {string} [cwd] 可选根目录，主要用于测试。
 * @returns {string} 配置文件绝对路径。
 */
function resolveConfigFilePath(env, argv, cwd) {
  const cliConfigPath = readCliValue(argv || [], 'config');
  const envConfigPath = readEnvFirst(env || {}, [
    'DANDELION_CONFIG_FILE',
    'GENERAL_STT_CONFIG_FILE'
  ], '');
  const configuredPath = cliConfigPath || envConfigPath || DEFAULT_CONFIG.configFileName;
  const rootDir = cwd || resolveDefaultConfigRoot();

  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.join(rootDir, configuredPath);
}

function readConfigFile(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error('Cannot read config file ' + configPath + ': ' + error.message);
  }
}

function readConfigString(config, pathParts, fallback) {
  let cursor = config || {};

  for (let index = 0; index < pathParts.length; index += 1) {
    if (!cursor || typeof cursor !== 'object') {
      return fallback;
    }

    cursor = cursor[pathParts[index]];
  }

  if (typeof cursor === 'string' && cursor.trim()) {
    return cursor.trim();
  }

  return fallback;
}

function readConfigBoolean(config, pathParts, fallback) {
  let cursor = config || {};

  for (let index = 0; index < pathParts.length; index += 1) {
    if (!cursor || typeof cursor !== 'object') {
      return fallback;
    }

    cursor = cursor[pathParts[index]];
  }

  if (typeof cursor === 'boolean') {
    return cursor;
  }

  return fallback;
}

function readConfigPositiveInt(config, pathParts, fallback) {
  let cursor = config || {};

  for (let index = 0; index < pathParts.length; index += 1) {
    if (!cursor || typeof cursor !== 'object') {
      return fallback;
    }

    cursor = cursor[pathParts[index]];
  }

  const value = Number.parseInt(cursor, 10);

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return value;
}

/**
 * 读取正整数环境变量配置。
 *
 * @param {object} env 环境变量对象。
 * @param {string} name 环境变量名。
 * @param {number} fallback 默认值。
 * @returns {number} 正整数配置；非法值返回默认值。
 */
function readPositiveIntEnv(env, name, fallback) {
  const rawValue = readEnv(env, name, '');
  const value = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return value;
}

/**
 * 读取 boolean 环境变量配置。
 *
 * @param {object} env 环境变量对象。
 * @param {string} name 环境变量名。
 * @param {boolean} fallback 默认值。
 * @returns {boolean} boolean 配置；空值返回默认值。
 */
function readBooleanEnv(env, name, fallback) {
  const value = readEnv(env, name, '').toLowerCase();

  if (!value) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].indexOf(value) !== -1) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].indexOf(value) !== -1) {
    return false;
  }

  return fallback;
}

/**
 * 读取桌面 app 配置。
 *
 * 目前配置来源是环境变量，后续可以替换为用户设置文件；保持这个函数独立，
 * 是为了让 Electron 主进程只依赖一个明确的配置对象，便于测试和后续 UI 接入。
 *
 * @param {object} [env] 环境变量对象，默认使用 `process.env`。
 * @param {string[]} [argv] CLI 参数数组，默认使用 `process.argv.slice(2)`。
 * @returns {object} 标准化后的 app 配置。
 */
function loadAppConfig(env, argv) {
  const sourceEnv = env || process.env;
  const sourceArgv = argv || process.argv.slice(2);
  const configFilePath = resolveConfigFilePath(sourceEnv, sourceArgv);
  const fileConfig = readConfigFile(configFilePath);
  const cliChatGptUrl = readCliValue(sourceArgv, 'chatgpt-url');
  const userDataDir = readEnvFirst(sourceEnv, [
    'DANDELION_USER_DATA_DIR',
    'GENERAL_STT_USER_DATA_DIR'
  ], '');
  const cliStartMode = readCliValue(sourceArgv, 'start-mode');
  const legacyCustomBinding = readEnvFirst(sourceEnv, [
    'DANDELION_CUSTOM_BINDING',
    'GENERAL_STT_CUSTOM_BINDING'
  ], '');
  const legacyTargetChord = readEnvFirst(sourceEnv, [
    'DANDELION_TARGET_CHORD',
    'GENERAL_STT_TARGET_CHORD'
  ], '');
  const fileStartBinding = readConfigString(
    fileConfig,
    ['bindings', 'start'],
    DEFAULT_CONFIG.startDictationBinding
  );
  const fileStopBinding = readConfigString(
    fileConfig,
    ['bindings', 'stop'],
    DEFAULT_CONFIG.stopDictationBinding
  );
  const fileCancelBinding = readConfigString(
    fileConfig,
    ['bindings', 'cancel'],
    DEFAULT_CONFIG.cancelDictationBinding
  );
  const fileStartTargetChord = readConfigString(
    fileConfig,
    ['targetChords', 'start'],
    DEFAULT_CONFIG.startDictationTargetChord
  );
  const fileStopTargetChord = readConfigString(
    fileConfig,
    ['targetChords', 'stop'],
    DEFAULT_CONFIG.stopDictationTargetChord
  );
  const fileCancelTargetChord = readConfigString(
    fileConfig,
    ['targetChords', 'cancel'],
    DEFAULT_CONFIG.cancelDictationTargetChord
  );

  return {
    autoPasteTranscript: readBooleanEnv(sourceEnv, 'DANDELION_AUTO_PASTE', readBooleanEnv(
      sourceEnv,
      'GENERAL_STT_AUTO_PASTE',
      readConfigBoolean(
      fileConfig,
      ['autoPasteTranscript'],
      DEFAULT_CONFIG.autoPasteTranscript
      )
    )),
    chatGptUrl: cliChatGptUrl || readEnvFirst(sourceEnv, [
      'DANDELION_CHATGPT_URL',
      'GENERAL_STT_CHATGPT_URL'
    ], readConfigString(
      fileConfig,
      ['chatGptUrl'],
      DEFAULT_CONFIG.chatGptUrl
    )),
    configFilePath: configFilePath,
    dictationBindings: {
      start: {
        action: 'start',
        binding: readEnvFirst(sourceEnv, [
          'DANDELION_START_BINDING',
          'DANDELION_START_DICTATION_BINDING',
          'GENERAL_STT_START_BINDING',
          'GENERAL_STT_START_DICTATION_BINDING'
        ], legacyCustomBinding || fileStartBinding),
        label: '开始听写',
        targetChord: readEnvFirst(sourceEnv, [
          'DANDELION_START_TARGET_CHORD',
          'DANDELION_START_DICTATION_TARGET_CHORD',
          'GENERAL_STT_START_TARGET_CHORD',
          'GENERAL_STT_START_DICTATION_TARGET_CHORD'
        ], legacyTargetChord || fileStartTargetChord)
      },
      stop: {
        action: 'stop',
        binding: readEnvFirst(sourceEnv, [
          'DANDELION_STOP_BINDING',
          'DANDELION_STOP_DICTATION_BINDING',
          'GENERAL_STT_STOP_BINDING',
          'GENERAL_STT_STOP_DICTATION_BINDING'
        ], fileStopBinding),
        label: '结束听写',
        targetChord: readEnvFirst(sourceEnv, [
          'DANDELION_STOP_TARGET_CHORD',
          'DANDELION_STOP_DICTATION_TARGET_CHORD',
          'GENERAL_STT_STOP_TARGET_CHORD',
          'GENERAL_STT_STOP_DICTATION_TARGET_CHORD'
        ], legacyTargetChord || fileStopTargetChord)
      },
      cancel: {
        action: 'cancel',
        binding: readEnvFirst(sourceEnv, [
          'DANDELION_CANCEL_BINDING',
          'DANDELION_CANCEL_DICTATION_BINDING',
          'GENERAL_STT_CANCEL_BINDING',
          'GENERAL_STT_CANCEL_DICTATION_BINDING'
        ], fileCancelBinding),
        label: '取消听写',
        targetChord: readEnvFirst(sourceEnv, [
          'DANDELION_CANCEL_TARGET_CHORD',
          'DANDELION_CANCEL_DICTATION_TARGET_CHORD',
          'GENERAL_STT_CANCEL_TARGET_CHORD',
          'GENERAL_STT_CANCEL_DICTATION_TARGET_CHORD'
        ], fileCancelTargetChord)
      }
    },
    logging: {
      enabled: readBooleanEnv(sourceEnv, 'DANDELION_LOG_ENABLED', readBooleanEnv(
        sourceEnv,
        'GENERAL_STT_LOG_ENABLED',
        readConfigBoolean(
        fileConfig,
        ['logging', 'enabled'],
        DEFAULT_CONFIG.loggingEnabled
        )
      )),
      level: normalizeLogLevel(readEnvFirst(sourceEnv, [
        'DANDELION_LOG_LEVEL',
        'GENERAL_STT_LOG_LEVEL'
      ], readConfigString(
        fileConfig,
        ['logging', 'level'],
        DEFAULT_CONFIG.loggingLevel
      ))),
      retentionDays: readPositiveIntEnv(sourceEnv, 'DANDELION_LOG_RETENTION_DAYS', readPositiveIntEnv(
        sourceEnv,
        'GENERAL_STT_LOG_RETENTION_DAYS',
        readConfigPositiveInt(
          fileConfig,
          ['logging', 'retentionDays'],
          DEFAULT_CONFIG.loggingRetentionDays
        )
      ))
    },
    sessionPartition: readEnvFirst(sourceEnv, [
      'DANDELION_SESSION_PARTITION',
      'GENERAL_STT_SESSION_PARTITION'
    ], readConfigString(
      fileConfig,
      ['sessionPartition'],
      DEFAULT_CONFIG.sessionPartition
    )),
    shortcutsEnabled: !readCliFlag(sourceArgv, 'disable-shortcuts'),
    startMode: normalizeWindowMode(cliStartMode || readEnvFirst(sourceEnv, [
      'DANDELION_START_MODE',
      'GENERAL_STT_START_MODE'
    ], readConfigString(
      fileConfig,
      ['startMode'],
      DEFAULT_CONFIG.startMode
    ))),
    smokeTest: readCliFlag(sourceArgv, 'smoke-test'),
    transcriptStableMs: readPositiveIntEnv(sourceEnv, 'DANDELION_TRANSCRIPT_STABLE_MS', readPositiveIntEnv(
      sourceEnv,
      'GENERAL_STT_TRANSCRIPT_STABLE_MS',
      readConfigPositiveInt(fileConfig, ['transcriptStableMs'], DEFAULT_CONFIG.transcriptStableMs)
    )),
    userDataDir: userDataDir || readConfigString(
      fileConfig,
      ['userDataDir'],
      resolveDefaultUserDataDir()
    )
  };
}

module.exports = {
  DEFAULT_CONFIG: DEFAULT_CONFIG,
  VALID_WINDOW_MODES: VALID_WINDOW_MODES,
  loadAppConfig: loadAppConfig,
  normalizeWindowMode: normalizeWindowMode,
  readBooleanEnv: readBooleanEnv,
  readCliFlag: readCliFlag,
  readConfigBoolean: readConfigBoolean,
  readConfigFile: readConfigFile,
  readConfigPositiveInt: readConfigPositiveInt,
  readConfigString: readConfigString,
  readEnvFirst: readEnvFirst,
  readPositiveIntEnv: readPositiveIntEnv,
  readCliValue: readCliValue,
  isPackagedElectronRuntime: isPackagedElectronRuntime,
  resolveDefaultConfigRoot: resolveDefaultConfigRoot,
  resolveDefaultUserDataDir: resolveDefaultUserDataDir,
  resolveConfigFilePath: resolveConfigFilePath
};
