'use strict';

const path = require('path');
const fs = require('fs');

const {
  BrowserWindow,
  dialog,
  Menu,
  Tray,
  app,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell
} = require('electron');

const { createAppLogger } = require('./appLogger');
const { createAppIcon, resolveAppIconPath } = require('./appIcon');
const { createChatGptShortcutBridge } = require('../shortcut/chatgptShortcutBridge');
const { clearChatGptInput } = require('./chatgptInput');
const { loadAppConfig } = require('./appConfig');
const {
  buildMiniOverlayWindowOptions,
  calculateMiniOverlayDragBounds,
  hideMiniOverlayWindow,
  readMiniOverlayPlacement,
  setMiniOverlayFocusable,
  showMiniOverlayWindow,
  writeMiniOverlayPlacement
} = require('./miniOverlayWindow');
const {
  MINI_OVERLAY_STATES,
  getMiniOverlaySizeForState,
  isDictationActiveState,
  normalizeMiniOverlayState,
  shouldFocusMiniOverlay
} = require('./miniOverlayState');
const {
  createDictationSession,
  DICTATION_PHASES
} = require('./dictationSession');
const {
  captureForegroundWindow,
  restoreForegroundWindow
} = require('./foregroundWindow');
const {
  createPermissionRequestHandler,
  createPersistentPermissionStore,
  isTrustedChatGptOrigin,
  shouldShowForLoginUrl
} = require('./permissions');
const { applyWindowMode, buildMainWindowOptions, WINDOW_MODES } = require('./windowModes');
const {
  prepareWindowForShortcut,
  restoreWindowAfterShortcut
} = require('./shortcutWindowActivation');
const { createChatGptTranscribeMonitor } = require('./chatgptTranscribeMonitor');
const { createTranscriptPipeline } = require('./transcriptPipeline');
const { playWindowsSystemSound } = require('./systemSound');
const { pasteTextIntoForeground } = require('./windowsPaste');

const config = loadAppConfig();
const appRoot = path.join(__dirname, '..', '..');
const appIconPath = resolveAppIconPath(appRoot);
const DEFERRED_STOP_AFTER_START_MS = 160;
const NETWORK_TRANSCRIPT_FALLBACK_MS = 5000;
const START_READY_TIMEOUT_MS = 1000;
const logger = createAppLogger({
  console: console,
  enabled: config.logging.enabled,
  level: config.logging.level,
  logDir: path.join(config.userDataDir, 'logs'),
  retentionDays: config.logging.retentionDays
});
let appIcon = null;
let mainWindow = null;
let miniOverlayWindow = null;
let tray = null;
let shortcutBridges = [];
let cancelShortcutBridge = null;
let startShortcutBridge = null;
let stopShortcutBridge = null;
let transcriptPipeline = null;
let transcribeMonitor = null;
let currentMode = config.startMode;
let miniOverlayState = MINI_OVERLAY_STATES.IDLE;
let transcriptResultEnabled = false;
let miniOverlayDragContext = null;
let startShortcutPending = false;
let stopAfterPendingStart = false;
let networkTranscriptFallbackTimer = null;
let pendingNetworkTranscript = null;
const dictationSession = createDictationSession({
  logger: logger,
  onMissingTranscribeRequest: function onMissingTranscribeRequest() {
    clearNetworkTranscriptFallback();
    sendMiniOverlayDictationState(MINI_OVERLAY_STATES.ERROR, {
      message: '未看到 ChatGPT 转写请求，请确认网页端听写已经开始或重试。'
    });
    dictationSession.reset();
  },
  retryStart: function retryStart(payload) {
    if (!startShortcutBridge || !startShortcutBridge.isRegistered()) {
      logger.warn('dictation.start.retry_unavailable', payload || {});
      return false;
    }

    logger.info('dictation.start.retry_triggered', payload || {});
    return startShortcutBridge.trigger();
  }
});

function isPromiseLike(value) {
  return value && typeof value.then === 'function';
}

function getErrorMessage(error) {
  if (error && error.message) {
    return error.message;
  }

  return String(error || 'unknown');
}

function isDictationSessionIdle() {
  return dictationSession.getSnapshot().phase === DICTATION_PHASES.IDLE;
}

function clearNetworkTranscriptFallback() {
  if (networkTranscriptFallbackTimer) {
    clearTimeout(networkTranscriptFallbackTimer);
    networkTranscriptFallbackTimer = null;
  }

  pendingNetworkTranscript = null;
}

function scheduleNetworkTranscriptFallback(payload) {
  clearNetworkTranscriptFallback();

  pendingNetworkTranscript = {
    requestId: String((payload && payload.requestId) || '').trim(),
    text: String((payload && payload.text) || '').trim()
  };

  logger.info('transcribe.network_fallback_scheduled', {
    delayMs: NETWORK_TRANSCRIPT_FALLBACK_MS,
    requestId: pendingNetworkTranscript.requestId,
    textLength: pendingNetworkTranscript.text.length
  });

  networkTranscriptFallbackTimer = setTimeout(function finalizeNetworkTranscriptFallback() {
    const candidate = pendingNetworkTranscript;
    clearNetworkTranscriptFallback();

    if (!candidate || !candidate.text) {
      return;
    }

    const sessionSnapshot = dictationSession.getSnapshot();

    if (
      !transcriptResultEnabled ||
      sessionSnapshot.phase !== DICTATION_PHASES.WAITING_RESPONSE ||
      candidate.requestId !== sessionSnapshot.observedTranscribeRequestId
    ) {
      logger.debug('transcribe.network_fallback_ignored_inactive', {
        observedRequestId: sessionSnapshot.observedTranscribeRequestId,
        phase: sessionSnapshot.phase,
        requestId: candidate.requestId,
        textLength: candidate.text.length
      });
      return;
    }

    logger.info('transcribe.network_fallback_finalizing', {
      requestId: candidate.requestId,
      textLength: candidate.text.length
    });

    if (transcriptPipeline) {
      transcriptPipeline.finalizeText(candidate.text, {
        force: true
      });
    }
  }, NETWORK_TRANSCRIPT_FALLBACK_MS);
}

function clearChatGptInputBeforeStart(webContents) {
  const clearResult = clearChatGptInput(webContents);

  if (!isPromiseLike(clearResult)) {
    return clearResult;
  }

  // Do not let a stuck renderer-side executeJavaScript block the shortcut
  // forever. If clearing the input takes too long, start dictation anyway and
  // leave an explicit log entry for diagnosis.
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(function onClearInputTimeout() {
      if (settled) {
        return;
      }

      settled = true;
      logger.warn('dictation.start.clear_input_timeout_continue', {
        timeoutMs: START_READY_TIMEOUT_MS
      });
      resolve(false);
    }, START_READY_TIMEOUT_MS);

    clearResult.then((result) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(result);
    }).catch((error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      logger.warn('dictation.start.clear_input_failed_continue', {
        error: getErrorMessage(error)
      });
      resolve(false);
    });
  });
}

function deferStopUntilStartShortcutSent(bindingConfig) {
  stopAfterPendingStart = true;
  logger.info('dictation.stop.deferred_until_start_sent', {
    binding: bindingConfig.binding,
    mode: currentMode,
    session: dictationSession.getSnapshot(),
    targetChord: bindingConfig.targetChord
  });
  return {
    action: bindingConfig.action,
    skipReason: 'start_pending',
    skipSend: true
  };
}

function triggerDeferredStopAfterStart() {
  if (!stopAfterPendingStart) {
    return;
  }

  stopAfterPendingStart = false;

  if (!stopShortcutBridge || !stopShortcutBridge.isRegistered()) {
    logger.warn('dictation.stop.deferred_unavailable', {
      session: dictationSession.getSnapshot()
    });
    return;
  }

  logger.info('dictation.stop.deferred_triggered', {
    session: dictationSession.getSnapshot()
  });
  setTimeout(function triggerDeferredStop() {
    stopShortcutBridge.trigger();
  }, DEFERRED_STOP_AFTER_START_MS);
}

function resetShortcutCoordination() {
  startShortcutPending = false;
  stopAfterPendingStart = false;
}

function getAppIcon() {
  if (!appIcon) {
    appIcon = createAppIcon(nativeImage, appIconPath);
  }

  return appIcon;
}

function setWindowMode(mode) {
  if (!mainWindow) {
    return;
  }

  const previousMode = currentMode;
  currentMode = applyWindowMode(mainWindow, mode, {
    screen: screen
  });
  logger.info('window.mode.changed', {
    mode: currentMode,
    previousMode: previousMode,
    requestedMode: mode
  });
  syncMiniOverlayVisibility();
  updateTrayMenu();
}

function syncMiniOverlayVisibility() {
  if (!miniOverlayWindow) {
    return;
  }

  if (currentMode === WINDOW_MODES.MINI) {
    logger.debug('mini_overlay.visibility.show', {
      state: miniOverlayState
    });
    showMiniOverlayForState(miniOverlayState);
    sendMiniOverlayVisibilityState(true);
    return;
  }

  logger.debug('mini_overlay.visibility.hide', {
    mode: currentMode,
    state: miniOverlayState
  });
  hideMiniOverlayWindow(miniOverlayWindow);
  sendMiniOverlayVisibilityState(false);
}

function getMiniOverlayPlacementPath() {
  return path.join(config.userDataDir, 'mini-overlay-placement.json');
}

function readSavedMiniOverlayPlacement() {
  return readMiniOverlayPlacement(getMiniOverlayPlacementPath());
}

function showMiniOverlayForState(state) {
  return showMiniOverlayWindow(miniOverlayWindow, screen, {
    placement: readSavedMiniOverlayPlacement(),
    size: getMiniOverlaySizeForState(state)
  });
}

function syncCancelShortcutRegistration(state) {
  if (!cancelShortcutBridge) {
    return;
  }

  if (isDictationActiveState(state)) {
    if (!cancelShortcutBridge.isRegistered() && !cancelShortcutBridge.start()) {
      logger.error('shortcut.cancel.register_failed', {
        binding: config.dictationBindings.cancel.binding
      });
    } else if (cancelShortcutBridge.isRegistered()) {
      logger.debug('shortcut.cancel.registered_for_active_dictation', {
        state: state
      });
    }
    return;
  }

  if (cancelShortcutBridge.isRegistered()) {
    cancelShortcutBridge.stop();
    logger.debug('shortcut.cancel.unregistered_for_inactive_dictation', {
      state: state
    });
  }
}

function sendMiniOverlayDictationState(state, payload) {
  const nextState = normalizeMiniOverlayState(state);
  const details = payload || {};
  const previousState = miniOverlayState;

  miniOverlayState = nextState;
  transcriptResultEnabled = isDictationActiveState(nextState);
  logger[nextState === previousState ? 'debug' : 'info']('mini_overlay.state.changed', {
    messageLength: String(details.message || '').length,
    previousState: previousState,
    state: nextState,
    textLength: String(details.text || '').length,
    transcriptResultEnabled: transcriptResultEnabled
  });
  syncCancelShortcutRegistration(nextState);
  if (miniOverlayWindow) {
    setMiniOverlayFocusable(miniOverlayWindow, shouldFocusMiniOverlay(nextState));
    if (currentMode === WINDOW_MODES.MINI) {
      showMiniOverlayForState(nextState);
    }
  }

  if (
    !miniOverlayWindow ||
    !miniOverlayWindow.webContents ||
    miniOverlayWindow.webContents.isDestroyed()
  ) {
    return;
  }

  miniOverlayWindow.webContents.send('general-stt:mini-overlay:dictation-state', {
    message: details.message || '',
    state: nextState,
    text: details.text || '',
    timestamp: Date.now()
  });
}

function sendMiniOverlayVisibilityState(visible) {
  if (
    !miniOverlayWindow ||
    !miniOverlayWindow.webContents ||
    miniOverlayWindow.webContents.isDestroyed()
  ) {
    return;
  }

  miniOverlayWindow.webContents.send('general-stt:mini-overlay:visibility-state', {
    timestamp: Date.now(),
    visible: Boolean(visible)
  });
}

function normalizeDragPoint(payload) {
  const point = payload || {};
  const x = Number(point.screenX);
  const y = Number(point.screenY);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y)
  };
}

function moveMiniOverlayDuringDrag(point) {
  if (!miniOverlayWindow || !miniOverlayDragContext) {
    return null;
  }

  const bounds = calculateMiniOverlayDragBounds(
    miniOverlayDragContext.startBounds,
    miniOverlayDragContext.startPoint,
    point,
    screen
  );

  miniOverlayWindow.setBounds(bounds);
  return bounds;
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      click: function showSmartMode() {
        setWindowMode(WINDOW_MODES.SMART);
      },
      label: '显示登录/授权窗口'
    },
    {
      click: function showCornerMode() {
        setWindowMode(WINDOW_MODES.CORNER);
      },
      label: '跟随角落模式'
    },
    {
      click: function showTinyMode() {
        setWindowMode(WINDOW_MODES.TINY);
      },
      label: '小窗口模式'
    },
    {
      click: function showMiniMode() {
        setWindowMode(WINDOW_MODES.MINI);
      },
      label: '最小化声波模式'
    },
    {
      click: function hideWindow() {
        setWindowMode(WINDOW_MODES.HIDDEN);
      },
      label: '完全隐藏'
    },
    { type: 'separator' },
    {
      enabled: false,
      label: '当前模式: ' + currentMode
    },
    {
      enabled: false,
      label: '开始听写: ' + config.dictationBindings.start.binding
    },
    {
      enabled: false,
      label: '结束听写: ' + config.dictationBindings.stop.binding
    },
    {
      enabled: false,
      label: '取消听写: ' + config.dictationBindings.cancel.binding
    },
    {
      click: function copyLastTranscript() {
        if (transcriptPipeline) {
          transcriptPipeline.copyLastTranscriptToClipboard();
        }
      },
      label: '复制上次听写到剪贴板'
    },
    {
      click: function reloadChatGpt() {
        if (mainWindow) {
          logger.info('chatgpt.reload_requested');
          mainWindow.webContents.reload();
        }
      },
      label: '重新加载 ChatGPT'
    },
    {
      click: function openLogDirectory() {
        const logDir = logger.getLogDir();

        logger.info('logs.open_requested', {
          logDir: logDir
        });
        fs.mkdirSync(logDir, { recursive: true });
        shell.openPath(logDir).then((message) => {
          if (message) {
            logger.warn('logs.open_failed', {
              message: message
            });
          }
        }).catch((error) => {
          logger.error('logs.open_failed', {
            error: error
          });
        });
      },
      label: '打开日志目录'
    },
    { type: 'separator' },
    {
      click: function quitApp() {
        app.quit();
      },
      label: '退出'
    }
  ]));
}

function createTray() {
  try {
    tray = new Tray(getAppIcon());
    tray.setToolTip('Dandelion');
    tray.on('click', function toggleSmartMode() {
      logger.info('tray.click_show_smart_mode');
      setWindowMode(WINDOW_MODES.SMART);
    });
    updateTrayMenu();
    logger.debug('tray.created');
  } catch (error) {
    logger.error('tray.create_failed', {
      error: error
    });
  }
}

function createMiniOverlayWindow() {
  const preloadPath = path.join(__dirname, '..', 'preload', 'miniOverlayPreload.js');
  const overlayHtmlPath = path.join(appRoot, 'src', 'renderer', 'miniOverlay.html');

  miniOverlayWindow = new BrowserWindow(buildMiniOverlayWindowOptions(
    preloadPath,
    appIconPath,
    config.sessionPartition
  ));
  miniOverlayWindow.on('closed', function onMiniOverlayClosed() {
    logger.debug('mini_overlay.closed');
    miniOverlayWindow = null;
  });
  miniOverlayWindow.webContents.on('did-fail-load', function onMiniOverlayFail(_event, errorCode, errorDescription) {
    logger.error('mini_overlay.load_failed', {
      errorCode: errorCode,
      errorDescription: errorDescription
    });
  });
  miniOverlayWindow.webContents.on('did-finish-load', function onMiniOverlayLoaded() {
    logger.debug('mini_overlay.loaded');
    sendMiniOverlayVisibilityState(currentMode === WINDOW_MODES.MINI);
  });
  miniOverlayWindow.loadFile(overlayHtmlPath);
  syncMiniOverlayVisibility();
}

function registerMiniOverlayIpc() {
  ipcMain.on('general-stt:mini-overlay:open-main-window', function openMainWindowFromMiniOverlay() {
    logger.info('mini_overlay.open_main_window_requested');
    setWindowMode(WINDOW_MODES.SMART);
  });
  ipcMain.on('general-stt:mini-overlay:ready', function onMiniOverlayReady() {
    logger.debug('mini_overlay.ready');
    sendMiniOverlayVisibilityState(currentMode === WINDOW_MODES.MINI);
    sendMiniOverlayDictationState(miniOverlayState);
  });
  ipcMain.on('general-stt:mini-overlay:copy-text', function copyMiniOverlayText(_event, payload) {
    const text = String((payload && payload.text) || '').trim();

    if (text) {
      logger.info('mini_overlay.copy_text_requested', {
        textLength: text.length
      });
      clipboard.writeText(text);
    }
  });
  ipcMain.on('general-stt:mini-overlay:drag-start', function startMiniOverlayDrag(_event, payload) {
    const point = normalizeDragPoint(payload);

    if (!miniOverlayWindow || !point || typeof miniOverlayWindow.getBounds !== 'function') {
      return;
    }

    miniOverlayDragContext = {
      startBounds: miniOverlayWindow.getBounds(),
      startPoint: point
    };
    logger.debug('mini_overlay.drag.started', {
      startBounds: miniOverlayDragContext.startBounds,
      startPoint: miniOverlayDragContext.startPoint
    });
  });
  ipcMain.on('general-stt:mini-overlay:drag-move', function moveMiniOverlayDrag(_event, payload) {
    const point = normalizeDragPoint(payload);

    if (!point) {
      return;
    }

    moveMiniOverlayDuringDrag(point);
  });
  ipcMain.on('general-stt:mini-overlay:drag-end', function endMiniOverlayDrag(_event, payload) {
    const point = normalizeDragPoint(payload);

    if (point) {
      moveMiniOverlayDuringDrag(point);
    }

    if (!miniOverlayWindow || !miniOverlayDragContext || typeof miniOverlayWindow.getBounds !== 'function') {
      miniOverlayDragContext = null;
      return;
    }

    const bounds = miniOverlayWindow.getBounds();
    const saved = writeMiniOverlayPlacement(getMiniOverlayPlacementPath(), bounds);

    logger.info('mini_overlay.position.saved', {
      height: bounds.height,
      saved: saved,
      width: bounds.width,
      x: bounds.x,
      y: bounds.y
    });
    miniOverlayDragContext = null;
  });
}

function openExternalNavigation(details) {
  if (isTrustedChatGptOrigin(details.url)) {
    logger.debug('navigation.allowed', {
      url: details.url
    });
    return { action: 'allow' };
  }

  logger.info('navigation.external_opened', {
    url: details.url
  });
  shell.openExternal(details.url);
  return { action: 'deny' };
}

function installPermissionHandler() {
  const chatGptSession = session.fromPartition(config.sessionPartition);
  chatGptSession.setPermissionRequestHandler(createPermissionRequestHandler({
    dialog: dialog,
    logger: logger,
    onTrustedMediaRequest: function onTrustedMediaRequest() {
      dictationSession.markTrustedMediaRequest();
    },
    permissionStore: createPersistentPermissionStore(path.join(config.userDataDir, 'permissions.json')),
    showPermissionWindow: function showPermissionWindow() {
      logger.info('permission.window.show_requested');
      setWindowMode(WINDOW_MODES.SMART);
    },
    trustedFileRoot: appRoot
  }));
}

function createMainWindow() {
  const preloadPath = path.join(__dirname, '..', 'preload', 'chatgptPreload.js');
  const windowOptions = buildMainWindowOptions(preloadPath, appIconPath);

  windowOptions.webPreferences.partition = config.sessionPartition;
  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.webContents.setWindowOpenHandler(openExternalNavigation);
  mainWindow.webContents.on('did-navigate', function onNavigate(_event, url) {
    logger.debug('chatgpt.did_navigate', {
      url: url
    });
    if (shouldShowForLoginUrl(url)) {
      logger.info('chatgpt.login_window_required', {
        url: url
      });
      setWindowMode(WINDOW_MODES.SMART);
    }
  });
  mainWindow.webContents.on('did-redirect-navigation', function onRedirect(_event, url) {
    logger.debug('chatgpt.did_redirect_navigation', {
      url: url
    });
    if (shouldShowForLoginUrl(url)) {
      logger.info('chatgpt.login_window_required', {
        url: url
      });
      setWindowMode(WINDOW_MODES.SMART);
    }
  });
  mainWindow.webContents.on('did-fail-load', function onFailLoad(_event, errorCode, errorDescription) {
    logger.error('chatgpt.load_failed', {
      errorCode: errorCode,
      errorDescription: errorDescription
    });
    setWindowMode(WINDOW_MODES.SMART);
  });
  mainWindow.webContents.on('did-finish-load', function onFinishLoad() {
    logger.debug('chatgpt.page_loaded', {
      url: mainWindow.webContents.getURL()
    });
    if (config.smokeTest) {
      setTimeout(function finishSmokeTest() {
        app.quit();
      }, 250);
    }
  });
  mainWindow.on('close', function onClose(event) {
    if (!app.isQuiting) {
      event.preventDefault();
      logger.info('chatgpt.window_close_to_mini');
      setWindowMode(WINDOW_MODES.MINI);
    }
  });

  logger.debug('chatgpt.load_url_requested', {
    url: config.chatGptUrl
  });
  mainWindow.loadURL(config.chatGptUrl);
  setWindowMode(config.startMode);
}

function createDictationBridge(bindingConfig) {
  let bridge = null;

  try {
    bridge = createChatGptShortcutBridge({
      afterSend: function afterSend(context) {
        if (!context) {
          return;
        }

        logger.debug('dictation.shortcut.after_send', {
          action: context.action,
          clearInputAfterSend: context.clearInputAfterSend,
          overlayStateAfterSend: context.overlayStateAfterSend,
          skipSend: context.skipSend,
          startProcessingAfterSend: context.startProcessingAfterSend
        });

        if (context.skipSend) {
          return;
        }

        if (context.action === 'start') {
          startShortcutPending = false;
          dictationSession.markStartShortcutSent();
        }
        if (context.action === 'stop') {
          dictationSession.markStopShortcutSent();
        }
        if (context.overlayStateAfterSend) {
          sendMiniOverlayDictationState(context.overlayStateAfterSend);
        }
        if (context.clearInputAfterSend) {
          setTimeout(function clearInputAfterCancel() {
            clearChatGptInput(mainWindow.webContents);
          }, 120);
        }
        if (context.playSoundAfterSend) {
          playWindowsSystemSound('asterisk', {
            logger: logger
          });
        }
        if (context.action === 'start') {
          triggerDeferredStopAfterStart();
        }
        setTimeout(function restorePreviousForegroundWindow() {
          restoreForegroundWindow(context.foregroundWindow);

          if (context.windowContext && context.windowContext.hiddenMode) {
            setTimeout(function hideAfterShortcut() {
              restoreWindowAfterShortcut(mainWindow, context.windowContext);
            }, 120);
          }
        }, 120);
      },
      beforeSend: function beforeSend() {
        if (bindingConfig.action === 'start') {
          if (startShortcutPending || !isDictationSessionIdle()) {
            logger.warn('dictation.start.skipped_active_session', {
              binding: bindingConfig.binding,
              mode: currentMode,
              session: dictationSession.getSnapshot(),
              startShortcutPending: startShortcutPending,
              targetChord: bindingConfig.targetChord
            });
            return {
              action: bindingConfig.action,
              skipReason: 'active_session',
              skipSend: true
            };
          }
        }

        if (bindingConfig.action === 'stop' && startShortcutPending) {
          return deferStopUntilStartShortcutSent(bindingConfig);
        }

        if (bindingConfig.action === 'stop' && !dictationSession.canSendStop()) {
          logger.warn('dictation.stop.skipped_not_listening', {
            binding: bindingConfig.binding,
            mode: currentMode,
            session: dictationSession.getSnapshot(),
            targetChord: bindingConfig.targetChord
          });
          return {
            action: bindingConfig.action,
            skipReason: 'not_listening',
            skipSend: true
          };
        }

        const foregroundWindow = captureForegroundWindow();
        const windowContext = prepareWindowForShortcut(mainWindow, currentMode);
        let overlayStateAfterSend = null;
        let playSoundAfterSend = false;
        let readyToSend = null;
        let startProcessingAfterSend = false;

        if (bindingConfig.action === 'start') {
          logger.info('dictation.start.before_send', {
            binding: bindingConfig.binding,
            mode: currentMode,
            targetChord: bindingConfig.targetChord
          });
          startShortcutPending = true;
          playSoundAfterSend = true;
          overlayStateAfterSend = MINI_OVERLAY_STATES.LISTENING;
          readyToSend = clearChatGptInputBeforeStart(mainWindow.webContents);
        } else if (bindingConfig.action === 'stop') {
          logger.info('dictation.stop.before_send', {
            binding: bindingConfig.binding,
            mode: currentMode,
            targetChord: bindingConfig.targetChord
          });
          overlayStateAfterSend = MINI_OVERLAY_STATES.PROCESSING;
          startProcessingAfterSend = true;
        } else if (bindingConfig.action === 'cancel') {
          logger.info('dictation.cancel.before_send', {
            binding: bindingConfig.binding,
            mode: currentMode,
            targetChord: bindingConfig.targetChord
          });
          transcriptResultEnabled = false;
          resetShortcutCoordination();
          clearNetworkTranscriptFallback();
          dictationSession.cancel();
          if (transcriptPipeline) {
            transcriptPipeline.discardPendingTranscript();
          }
          overlayStateAfterSend = MINI_OVERLAY_STATES.IDLE;
        }

        return {
          action: bindingConfig.action,
          clearInputAfterSend: bindingConfig.action === 'cancel',
          dispatchDelayMs: windowContext.dispatchDelayMs,
          foregroundWindow: foregroundWindow,
          overlayStateAfterSend: overlayStateAfterSend,
          playSoundAfterSend: playSoundAfterSend,
          readyToSend: readyToSend,
          startProcessingAfterSend: startProcessingAfterSend,
          windowContext: windowContext
        };
      },
      customBinding: bindingConfig.binding,
      focusBeforeSend: true,
      globalShortcut: globalShortcut,
      logger: logger,
      targetChord: bindingConfig.targetChord,
      webContents: mainWindow.webContents
    });
  } catch (error) {
    logger.error('dictation.binding.invalid', {
      binding: bindingConfig.binding,
      error: error,
      label: bindingConfig.label
    });
    setWindowMode(WINDOW_MODES.SMART);
    return null;
  }

  return bridge;
}

function registerDictationBridge(bindingConfig) {
  const bridge = createDictationBridge(bindingConfig);

  if (!bridge) {
    return null;
  }

  if (!bridge.start()) {
    logger.error('dictation.binding.register_failed', {
      binding: bindingConfig.binding,
      label: bindingConfig.label
    });
    setWindowMode(WINDOW_MODES.SMART);
    return null;
  }

  logger.info('dictation.binding.registered', {
    action: bindingConfig.action,
    binding: bindingConfig.binding,
    label: bindingConfig.label,
    targetChord: bindingConfig.targetChord
  });

  return bridge;
}

function registerShortcutBridges() {
  if (!config.shortcutsEnabled) {
    logger.info('shortcuts.disabled');
    return;
  }

  const bindings = [
    config.dictationBindings.start,
    config.dictationBindings.stop
  ];
  const registeredAccelerators = {};

  shortcutBridges = bindings.reduce((bridges, bindingConfig) => {
    if (registeredAccelerators[bindingConfig.binding]) {
      logger.warn('dictation.binding.duplicate_skipped', {
        binding: bindingConfig.binding,
        label: bindingConfig.label
      });
      return bridges;
    }

    const bridge = registerDictationBridge(bindingConfig);

    if (bridge) {
      registeredAccelerators[bindingConfig.binding] = true;
      if (bindingConfig.action === 'start') {
        startShortcutBridge = bridge;
      } else if (bindingConfig.action === 'stop') {
        stopShortcutBridge = bridge;
      }
      bridges.push(bridge);
    }

    return bridges;
  }, []);

  if (shortcutBridges.length === 0) {
    logger.error('dictation.binding.none_registered');
    setWindowMode(WINDOW_MODES.SMART);
  }

  cancelShortcutBridge = createDictationBridge(config.dictationBindings.cancel);
  logger.debug('dictation.cancel_bridge.created', {
    binding: config.dictationBindings.cancel.binding,
    targetChord: config.dictationBindings.cancel.targetChord
  });
  syncCancelShortcutRegistration(miniOverlayState);
}

function registerTranscriptPipeline() {
  transcriptPipeline = createTranscriptPipeline({
    autoPaste: config.autoPasteTranscript,
    clipboard: clipboard,
    logger: logger,
    onError: function onTranscriptError(payload) {
      clearNetworkTranscriptFallback();
      logger.error('transcript.pipeline.error', {
        message: payload.message,
        textLength: String(payload.text || '').length
      });
      dictationSession.reset();
      sendMiniOverlayDictationState(MINI_OVERLAY_STATES.ERROR, {
        message: payload.message || '听写文本处理失败。'
      });
    },
    onFinalized: function onTranscriptFinalized(payload) {
      clearNetworkTranscriptFallback();
      logger.info('transcript.finalized', {
        autoPaste: payload.autoPaste,
        pasted: payload.pasted,
        textLength: String(payload.text || '').length
      });
      dictationSession.reset();
      sendMiniOverlayDictationState(MINI_OVERLAY_STATES.SUCCESS, {
        text: payload.text
      });
    },
    pasteText: pasteTextIntoForeground,
    stableMs: config.transcriptStableMs,
    storagePath: path.join(config.userDataDir, 'last-transcript.json')
  });

  ipcMain.on('general-stt:transcript', function onTranscript(_event, payload) {
    if (!transcriptResultEnabled) {
      logger.debug('transcript.dom.ignored_inactive', {
        source: payload && payload.source,
        textLength: String((payload && payload.text) || '').length
      });
      return;
    }

    const sessionSnapshot = dictationSession.getSnapshot();

    if (
      sessionSnapshot.phase !== DICTATION_PHASES.PROCESSING &&
      sessionSnapshot.phase !== DICTATION_PHASES.WAITING_RESPONSE
    ) {
      logger.debug('transcript.dom.ignored_unexpected_phase', {
        phase: sessionSnapshot.phase,
        source: payload && payload.source,
        textLength: String((payload && payload.text) || '').length
      });
      return;
    }

    const domText = String((payload && payload.text) || '').trim();

    logger.debug('transcript.dom.received', {
      source: payload && payload.source,
      textLength: domText.length
    });
    if (
      pendingNetworkTranscript &&
      transcriptPipeline &&
      domText !== transcriptPipeline.getLastText()
    ) {
      logger.debug('transcribe.network_fallback_replaced_by_dom', {
        requestId: pendingNetworkTranscript.requestId,
        textLength: pendingNetworkTranscript.text.length
      });
      clearNetworkTranscriptFallback();
    }
    transcriptPipeline.handleTranscript(payload);
  });
}

function installTranscribeMonitor() {
  transcribeMonitor = createChatGptTranscribeMonitor({
    logger: logger,
    onFailed: function onTranscribeFailed(payload) {
      if (!transcriptResultEnabled) {
        logger.debug('transcribe.failed_ignored_inactive', {
          statusCode: payload && payload.statusCode,
          statusText: payload && payload.statusText,
          url: payload && payload.url
        });
        return;
      }

      const sessionSnapshot = dictationSession.getSnapshot();
      const requestId = String((payload && payload.requestId) || '').trim();

      if (
        miniOverlayState !== MINI_OVERLAY_STATES.PROCESSING ||
        sessionSnapshot.phase !== DICTATION_PHASES.WAITING_RESPONSE ||
        !requestId ||
        requestId !== sessionSnapshot.observedTranscribeRequestId
      ) {
        logger.debug('transcribe.failed_ignored_unmatched_session', {
          observedRequestId: sessionSnapshot.observedTranscribeRequestId,
          phase: sessionSnapshot.phase,
          requestId: requestId,
          statusCode: payload && payload.statusCode,
          statusText: payload && payload.statusText,
          url: payload && payload.url
        });
        return;
      }

      logger.error('transcribe.failed', {
        errorText: payload.errorText,
        remoteDebugDir: payload.remoteDebugDir,
        requestId: requestId,
        statusCode: payload.statusCode,
        statusText: payload.statusText,
        url: payload.url
      });
      dictationSession.reset();
      clearNetworkTranscriptFallback();
      sendMiniOverlayDictationState(MINI_OVERLAY_STATES.ERROR, {
        message: 'ChatGPT 转写请求失败：' +
          (payload.errorText || payload.statusText || payload.statusCode || 'unknown')
      });
    },
    onStarted: function onTranscribeStarted(payload) {
      logger.info('transcribe.started', {
        method: payload && payload.method,
        remoteDebugDir: payload && payload.remoteDebugDir,
        requestId: payload && payload.requestId,
        url: payload && payload.url
      });
      if (miniOverlayState === MINI_OVERLAY_STATES.PROCESSING && transcriptResultEnabled) {
        dictationSession.markTranscribeRequestStarted(payload);
      }
    },
    onSucceeded: function onTranscribeSucceeded(payload) {
      if (!transcriptResultEnabled) {
        logger.debug('transcribe.succeeded_ignored_inactive', {
          requestId: payload && payload.requestId,
          statusCode: payload && payload.statusCode,
          textLength: String((payload && payload.text) || '').length,
          url: payload && payload.url
        });
        return;
      }

      const sessionSnapshot = dictationSession.getSnapshot();
      const requestId = String((payload && payload.requestId) || '').trim();

      if (
        sessionSnapshot.phase !== DICTATION_PHASES.WAITING_RESPONSE ||
        !requestId ||
        requestId !== sessionSnapshot.observedTranscribeRequestId
      ) {
        logger.debug('transcribe.succeeded_ignored_unmatched_session', {
          observedRequestId: sessionSnapshot.observedTranscribeRequestId,
          phase: sessionSnapshot.phase,
          requestId: requestId,
          statusCode: payload && payload.statusCode,
          textLength: String((payload && payload.text) || '').length,
          url: payload && payload.url
        });
        return;
      }

      if (!payload || !payload.text) {
        logger.warn('transcribe.succeeded_without_text', {
          requestId: requestId,
          statusCode: payload && payload.statusCode,
          url: payload && payload.url
        });
        return;
      }

      logger.info('transcribe.succeeded', {
        remoteDebugDir: payload.remoteDebugDir,
        requestId: requestId,
        statusCode: payload.statusCode,
        textLength: String(payload.text || '').length,
        url: payload.url
      });
      scheduleNetworkTranscriptFallback(payload);
    },
    remoteDebugLogDir: path.join(config.userDataDir, 'remote-debug', 'transcribe'),
    webContents: mainWindow.webContents
  });

  if (!transcribeMonitor.start()) {
    logger.warn('transcribe.monitor.disabled');
  } else {
    logger.debug('transcribe.monitor.started');
  }
}

function boot() {
  fs.mkdirSync(config.userDataDir, { recursive: true });
  app.setPath('userData', config.userDataDir);
  logger.info('app.boot', {
    autoPasteTranscript: config.autoPasteTranscript,
    chatGptUrl: config.chatGptUrl,
    configFilePath: config.configFilePath,
    logDir: logger.getLogDir(),
    logging: config.logging,
    sessionPartition: config.sessionPartition,
    shortcutsEnabled: config.shortcutsEnabled,
    startMode: config.startMode,
    transcriptStableMs: config.transcriptStableMs,
    userDataDir: config.userDataDir
  });
  if (typeof app.setAppUserModelId === 'function') {
    app.setAppUserModelId('dandelion');
  }

  app.whenReady().then(function onReady() {
    logger.info('app.ready');
    registerMiniOverlayIpc();
    installPermissionHandler();
    createMainWindow();
    registerTranscriptPipeline();
    installTranscribeMonitor();
    createMiniOverlayWindow();
    createTray();
    registerShortcutBridges();
  });

  app.on('before-quit', function beforeQuit() {
    logger.info('app.before_quit');
    app.isQuiting = true;
    resetShortcutCoordination();
    clearNetworkTranscriptFallback();
    dictationSession.reset();
    if (transcribeMonitor) {
      transcribeMonitor.stop();
    }
    if (transcriptPipeline) {
      transcriptPipeline.flushPendingTranscript();
    }
    shortcutBridges.forEach((bridge) => bridge.stop());
    if (cancelShortcutBridge) {
      cancelShortcutBridge.stop();
    }
  });

  app.on('window-all-closed', function keepTrayAppAlive() {});

  app.on('will-quit', function willQuit() {
    logger.info('app.will_quit');
    globalShortcut.unregisterAll();
  });

  process.on('uncaughtException', function onUncaughtException(error) {
    logger.error('process.uncaught_exception', {
      error: error
    });
  });

  process.on('unhandledRejection', function onUnhandledRejection(reason) {
    logger.error('process.unhandled_rejection', {
      reason: reason
    });
  });
}

boot();
