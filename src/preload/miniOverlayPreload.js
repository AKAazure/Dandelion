'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 给 mini overlay 暴露受限 IPC。
 *
 * overlay 是本地 UI，只暴露打开主窗口、复制结果文本、接收状态这几个受限
 * 能力。不要把完整 ipcRenderer 暴露给页面。
 */
contextBridge.exposeInMainWorld('generalSttMiniOverlay', {
  copyText: function copyText(text) {
    ipcRenderer.send('general-stt:mini-overlay:copy-text', {
      text: String(text || '')
    });
  },
  dragEnd: function dragEnd(point) {
    ipcRenderer.send('general-stt:mini-overlay:drag-end', {
      screenX: Number(point && point.screenX),
      screenY: Number(point && point.screenY)
    });
  },
  dragMove: function dragMove(point) {
    ipcRenderer.send('general-stt:mini-overlay:drag-move', {
      screenX: Number(point && point.screenX),
      screenY: Number(point && point.screenY)
    });
  },
  dragStart: function dragStart(point) {
    ipcRenderer.send('general-stt:mini-overlay:drag-start', {
      screenX: Number(point && point.screenX),
      screenY: Number(point && point.screenY)
    });
  },
  onDictationState: function onDictationState(callback) {
    if (typeof callback !== 'function') {
      return function noop() {};
    }

    const handler = function handleDictationState(_event, payload) {
      callback(payload || {});
    };

    ipcRenderer.on('general-stt:mini-overlay:dictation-state', handler);

    return function unsubscribe() {
      ipcRenderer.removeListener('general-stt:mini-overlay:dictation-state', handler);
    };
  },
  onVisibilityState: function onVisibilityState(callback) {
    if (typeof callback !== 'function') {
      return function noop() {};
    }

    const handler = function handleVisibilityState(_event, payload) {
      callback(payload || {});
    };

    ipcRenderer.on('general-stt:mini-overlay:visibility-state', handler);

    return function unsubscribe() {
      ipcRenderer.removeListener('general-stt:mini-overlay:visibility-state', handler);
    };
  },
  openMainWindow: function openMainWindow() {
    ipcRenderer.send('general-stt:mini-overlay:open-main-window');
  },
  ready: function ready() {
    ipcRenderer.send('general-stt:mini-overlay:ready');
  }
});
