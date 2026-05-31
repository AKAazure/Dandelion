'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadAppConfig,
  isPackagedElectronRuntime,
  normalizeWindowMode,
  readBooleanEnv,
  readCliFlag,
  readConfigString,
  readEnvFirst,
  readPositiveIntEnv,
  readCliValue,
  resolveDefaultConfigRoot,
  resolveDefaultUserDataDir,
  resolveConfigFilePath
} = require('../src/main/appConfig');

function run() {
  assert.strictEqual(normalizeWindowMode('smart'), 'smart');
  assert.strictEqual(normalizeWindowMode('mini'), 'mini');
  assert.strictEqual(normalizeWindowMode('bad-mode'), 'mini');
  assert.strictEqual(readCliFlag(['--smoke-test'], 'smoke-test'), true);
  assert.strictEqual(readCliFlag([], 'smoke-test'), false);
  assert.strictEqual(readCliValue(['--start-mode=smart'], 'start-mode'), 'smart');
  assert.strictEqual(
    resolveConfigFilePath({}, ['--config=config/test.json'], '/tmp/general-stt'),
    path.join('/tmp/general-stt', 'config', 'test.json')
  );
  assert.strictEqual(readEnvFirst({ A: '', B: 'value' }, ['A', 'B'], 'fallback'), 'value');
  assert.strictEqual(readConfigString({ a: { b: ' value ' } }, ['a', 'b'], 'fallback'), 'value');
  assert.strictEqual(readBooleanEnv({ A: 'false' }, 'A', true), false);
  assert.strictEqual(readBooleanEnv({ A: 'yes' }, 'A', false), true);
  assert.strictEqual(readPositiveIntEnv({ A: '1000' }, 'A', 2500), 1000);
  assert.strictEqual(readPositiveIntEnv({ A: 'bad' }, 'A', 2500), 2500);
  assert.strictEqual(isPackagedElectronRuntime({
    defaultApp: true,
    versions: {
      electron: '42.1.0'
    }
  }), false);
  assert.strictEqual(isPackagedElectronRuntime({
    defaultApp: false,
    versions: {
      electron: '42.1.0'
    }
  }), true);
  assert.strictEqual(resolveDefaultConfigRoot({
    defaultApp: false,
    resourcesPath: 'C:\\Program Files\\Dandelion\\resources',
    versions: {
      electron: '42.1.0'
    }
  }), 'C:\\Program Files\\Dandelion\\resources');
  assert.strictEqual(resolveDefaultUserDataDir({
    defaultApp: false,
    env: {
      APPDATA: 'C:\\Users\\akira\\AppData\\Roaming'
    },
    versions: {
      electron: '42.1.0'
    }
  }), path.join('C:\\Users\\akira\\AppData\\Roaming', 'Dandelion'));

  const missingConfigPath = path.join(os.tmpdir(), 'general-stt-missing-config.json');
  const defaultConfig = loadAppConfig({
    GENERAL_STT_USER_DATA_DIR: '/tmp/general-stt-test'
  }, ['--config=' + missingConfigPath]);

  assert.strictEqual(defaultConfig.autoPasteTranscript, true);
  assert.strictEqual(defaultConfig.configFilePath, missingConfigPath);
  assert.strictEqual(defaultConfig.dictationBindings.start.binding, 'Alt+Shift+R');
  assert.strictEqual(defaultConfig.dictationBindings.stop.binding, 'Alt+Shift+S');
  assert.strictEqual(defaultConfig.dictationBindings.cancel.binding, 'Escape');
  assert.strictEqual(defaultConfig.dictationBindings.start.targetChord, 'Ctrl+Shift+D');
  assert.strictEqual(defaultConfig.dictationBindings.stop.targetChord, 'Ctrl+Shift+D');
  assert.strictEqual(defaultConfig.dictationBindings.cancel.targetChord, 'Escape');
  assert.deepStrictEqual(defaultConfig.logging, {
    enabled: true,
    level: 'info',
    retentionDays: 7
  });
  assert.strictEqual(defaultConfig.startMode, 'mini');
  assert.strictEqual(defaultConfig.transcriptStableMs, 2500);

  const config = loadAppConfig({
    DANDELION_AUTO_PASTE: 'false',
    DANDELION_CHATGPT_URL: 'https://chatgpt.com/?model=test',
    DANDELION_SESSION_PARTITION: 'persist:test',
    DANDELION_START_MODE: 'corner',
    DANDELION_START_BINDING: 'Ctrl+Alt+Space',
    DANDELION_START_TARGET_CHORD: 'Ctrl+Shift+D',
    DANDELION_STOP_BINDING: 'Ctrl+Alt+Period',
    DANDELION_STOP_TARGET_CHORD: 'Enter',
    DANDELION_CANCEL_BINDING: 'Ctrl+Alt+Escape',
    DANDELION_CANCEL_TARGET_CHORD: 'Escape',
    DANDELION_LOG_ENABLED: 'false',
    DANDELION_LOG_LEVEL: 'warn',
    DANDELION_LOG_RETENTION_DAYS: '30',
    DANDELION_TRANSCRIPT_STABLE_MS: '1200',
    DANDELION_USER_DATA_DIR: '/tmp/general-stt-test'
  }, ['--config=' + missingConfigPath]);

  assert.deepStrictEqual(config, {
    chatGptUrl: 'https://chatgpt.com/?model=test',
    autoPasteTranscript: false,
    configFilePath: missingConfigPath,
    dictationBindings: {
      start: {
        action: 'start',
        binding: 'Ctrl+Alt+Space',
        label: '开始听写',
        targetChord: 'Ctrl+Shift+D'
      },
      stop: {
        action: 'stop',
        binding: 'Ctrl+Alt+Period',
        label: '结束听写',
        targetChord: 'Enter'
      },
      cancel: {
        action: 'cancel',
        binding: 'Ctrl+Alt+Escape',
        label: '取消听写',
        targetChord: 'Escape'
      }
    },
    logging: {
      enabled: false,
      level: 'warn',
      retentionDays: 30
    },
    sessionPartition: 'persist:test',
    shortcutsEnabled: true,
    smokeTest: false,
    startMode: 'corner',
    transcriptStableMs: 1200,
    userDataDir: '/tmp/general-stt-test'
  });

  const legacyConfig = loadAppConfig({
    GENERAL_STT_CUSTOM_BINDING: 'Alt+Shift+D',
    GENERAL_STT_TARGET_CHORD: 'Ctrl+Shift+D',
    GENERAL_STT_USER_DATA_DIR: '/tmp/general-stt-test'
  }, ['--config=' + missingConfigPath]);

  assert.strictEqual(legacyConfig.dictationBindings.start.binding, 'Alt+Shift+D');
  assert.strictEqual(legacyConfig.dictationBindings.stop.binding, 'Alt+Shift+S');
  assert.strictEqual(legacyConfig.dictationBindings.cancel.binding, 'Escape');
  assert.strictEqual(legacyConfig.dictationBindings.start.targetChord, 'Ctrl+Shift+D');
  assert.strictEqual(legacyConfig.dictationBindings.stop.targetChord, 'Ctrl+Shift+D');
  assert.strictEqual(legacyConfig.dictationBindings.cancel.targetChord, 'Escape');

  const cliConfig = loadAppConfig({
    GENERAL_STT_START_MODE: 'hidden',
    GENERAL_STT_USER_DATA_DIR: '/tmp/general-stt-test'
  }, [
    '--config=' + missingConfigPath,
    '--start-mode=smart',
    '--smoke-test',
    '--disable-shortcuts',
    '--chatgpt-url=about:blank'
  ]);

  assert.strictEqual(cliConfig.chatGptUrl, 'about:blank');
  assert.strictEqual(cliConfig.shortcutsEnabled, false);
  assert.strictEqual(cliConfig.smokeTest, true);
  assert.strictEqual(cliConfig.startMode, 'smart');

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'general-stt-config-'));
  const configPath = path.join(configDir, 'general-stt.json');
  fs.writeFileSync(configPath, JSON.stringify({
    autoPasteTranscript: false,
    bindings: {
      start: 'F1',
      stop: 'F2',
      cancel: 'Escape'
    },
    chatGptUrl: 'https://chatgpt.com/?file=config',
    startMode: 'smart',
    logging: {
      enabled: true,
      level: 'error',
      retentionDays: 14
    },
    targetChords: {
      start: 'Ctrl+Shift+D',
      stop: 'Enter',
      cancel: 'Escape'
    },
    transcriptStableMs: 900,
    userDataDir: '/tmp/general-stt-file-user-data'
  }));

  const fileConfig = loadAppConfig({}, ['--config=' + configPath]);

  assert.strictEqual(fileConfig.autoPasteTranscript, false);
  assert.strictEqual(fileConfig.chatGptUrl, 'https://chatgpt.com/?file=config');
  assert.strictEqual(fileConfig.configFilePath, configPath);
  assert.strictEqual(fileConfig.dictationBindings.start.binding, 'F1');
  assert.strictEqual(fileConfig.dictationBindings.stop.binding, 'F2');
  assert.strictEqual(fileConfig.dictationBindings.cancel.binding, 'Escape');
  assert.strictEqual(fileConfig.dictationBindings.stop.targetChord, 'Enter');
  assert.strictEqual(fileConfig.dictationBindings.cancel.targetChord, 'Escape');
  assert.deepStrictEqual(fileConfig.logging, {
    enabled: true,
    level: 'error',
    retentionDays: 14
  });
  assert.strictEqual(fileConfig.startMode, 'smart');
  assert.strictEqual(fileConfig.transcriptStableMs, 900);
  assert.strictEqual(fileConfig.userDataDir, '/tmp/general-stt-file-user-data');

  const envOverrideConfig = loadAppConfig({
    GENERAL_STT_START_BINDING: 'Ctrl+Alt+R'
  }, ['--config=' + configPath]);

  assert.strictEqual(envOverrideConfig.dictationBindings.start.binding, 'Ctrl+Alt+R');
  assert.strictEqual(envOverrideConfig.dictationBindings.stop.binding, 'F2');
  assert.strictEqual(envOverrideConfig.dictationBindings.cancel.binding, 'Escape');
}

module.exports = {
  run: run
};
