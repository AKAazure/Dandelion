'use strict';

const fs = require('fs');
const path = require('path');

const RECORDER_PROBE_EVENT_LIMIT = 1000;
const RECORDER_PROBE_INSTALL_SCRIPT = [
  '(function installGeneralSttRecorderProbe() {',
  '  const key = "__GENERAL_STT_RECORDER_PROBE__";',
  '  if (window[key] && window[key].installed) {',
  '    return { installed: true, alreadyInstalled: true, eventCount: window[key].events.length };',
  '  }',
  '  const state = {',
  '    installed: true,',
  '    installedAt: new Date().toISOString(),',
  '    installedAtMs: Date.now(),',
  '    href: window.location.href,',
  '    events: [],',
  '    counters: { eventsDropped: 0, recorderCount: 0 },',
  '    patches: {},',
  '    recorders: {}',
  '  };',
  '  window[key] = state;',
  '  function nowEvent(type, details) {',
  '    const event = {',
  '      type: type,',
  '      recordedAt: new Date().toISOString(),',
  '      timeSinceInstallMs: Date.now() - state.installedAtMs,',
  '      performanceNow: typeof performance !== "undefined" && performance.now ? performance.now() : null,',
  '      details: details || {}',
  '    };',
  '    state.events.push(event);',
  '    if (state.events.length > ' + RECORDER_PROBE_EVENT_LIMIT + ') {',
  '      state.events.shift();',
  '      state.counters.eventsDropped += 1;',
  '    }',
  '    return event;',
  '  }',
  '  function safeString(value) {',
  '    if (value === null || value === undefined) { return ""; }',
  '    try { return String(value); } catch (error) { return "[unstringifiable]"; }',
  '  }',
  '  function summarizeBlob(value) {',
  '    if (!value || typeof Blob === "undefined" || !(value instanceof Blob)) { return null; }',
  '    return {',
  '      kind: value instanceof File ? "file" : "blob",',
  '      name: value instanceof File ? value.name : "",',
  '      size: value.size,',
  '      type: value.type || "",',
  '      lastModified: value instanceof File ? value.lastModified : 0',
  '    };',
  '  }',
  '  function summarizeTrack(track) {',
  '    if (!track) { return null; }',
  '    let settings = {};',
  '    try { settings = typeof track.getSettings === "function" ? track.getSettings() : {}; } catch (error) { settings = { error: safeString(error && error.message) }; }',
  '    return {',
  '      enabled: Boolean(track.enabled),',
  '      id: safeString(track.id),',
  '      kind: safeString(track.kind),',
  '      label: safeString(track.label),',
  '      muted: Boolean(track.muted),',
  '      readyState: safeString(track.readyState),',
  '      settings: settings',
  '    };',
  '  }',
  '  function summarizeStream(stream) {',
  '    if (!stream || typeof stream.getTracks !== "function") { return null; }',
  '    return {',
  '      id: safeString(stream.id),',
  '      active: Boolean(stream.active),',
  '      tracks: stream.getTracks().map(summarizeTrack)',
  '    };',
  '  }',
  '  function summarizeFormData(formData) {',
  '    const entries = [];',
  '    if (!formData || typeof formData.forEach !== "function") { return { kind: "formData", entries: entries }; }',
  '    try {',
  '      formData.forEach(function summarizeFormValue(value, name) {',
  '        const blob = summarizeBlob(value);',
  '        if (blob) {',
  '          entries.push({ name: safeString(name), value: blob });',
  '          return;',
  '        }',
  '        const text = safeString(value);',
  '        entries.push({ name: safeString(name), value: { kind: "string", length: text.length } });',
  '      });',
  '    } catch (error) {',
  '      entries.push({ name: "__error__", value: { kind: "error", message: safeString(error && error.message) } });',
  '    }',
  '    return { kind: "formData", entries: entries };',
  '  }',
  '  function summarizeBody(body) {',
  '    const blob = summarizeBlob(body);',
  '    if (blob) { return blob; }',
  '    if (typeof FormData !== "undefined" && body instanceof FormData) { return summarizeFormData(body); }',
  '    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) { return { kind: "urlSearchParams" }; }',
  '    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) { return { kind: "arrayBuffer", byteLength: body.byteLength }; }',
  '    if (ArrayBuffer && ArrayBuffer.isView && ArrayBuffer.isView(body)) { return { kind: "typedArray", byteLength: body.byteLength || 0 }; }',
  '    if (typeof body === "string") { return { kind: "string", length: body.length }; }',
  '    if (!body) { return { kind: "empty" }; }',
  '    return { kind: Object.prototype.toString.call(body) };',
  '  }',
  '  function isTranscribeUrl(url) {',
  '    return safeString(url).toLowerCase().indexOf("/backend-api/transcribe") !== -1 ||',
  '      safeString(url).toLowerCase().indexOf("/transcribe") !== -1;',
  '  }',
  '  function attachRecorder(recorder, stream, options) {',
  '    if (!recorder || recorder.__generalSttProbeId) { return recorder && recorder.__generalSttProbeId; }',
  '    const id = "recorder-" + (++state.counters.recorderCount);',
  '    try { Object.defineProperty(recorder, "__generalSttProbeId", { value: id }); } catch (error) { recorder.__generalSttProbeId = id; }',
  '    state.recorders[id] = {',
  '      createdAt: new Date().toISOString(),',
  '      mimeType: safeString(recorder.mimeType),',
  '      state: safeString(recorder.state),',
  '      stream: summarizeStream(stream || recorder.stream),',
  '      options: options || {},',
  '      dataAvailableCount: 0,',
  '      totalDataAvailableBytes: 0',
  '    };',
  '    nowEvent("media_recorder.constructed", { id: id, recorder: state.recorders[id] });',
  '    recorder.addEventListener("start", function onStart() {',
  '      state.recorders[id].state = safeString(recorder.state);',
  '      nowEvent("media_recorder.start_event", { id: id, state: safeString(recorder.state) });',
  '    });',
  '    recorder.addEventListener("dataavailable", function onDataAvailable(event) {',
  '      const blob = summarizeBlob(event && event.data);',
  '      state.recorders[id].dataAvailableCount += 1;',
  '      state.recorders[id].totalDataAvailableBytes += blob ? blob.size : 0;',
  '      state.recorders[id].state = safeString(recorder.state);',
  '      nowEvent("media_recorder.dataavailable", {',
  '        id: id,',
  '        data: blob,',
  '        timecode: event && typeof event.timecode === "number" ? event.timecode : null,',
  '        totalBytes: state.recorders[id].totalDataAvailableBytes',
  '      });',
  '    });',
  '    recorder.addEventListener("stop", function onStop() {',
  '      state.recorders[id].state = safeString(recorder.state);',
  '      nowEvent("media_recorder.stop_event", { id: id, state: safeString(recorder.state), totals: state.recorders[id] });',
  '    });',
  '    recorder.addEventListener("pause", function onPause() {',
  '      state.recorders[id].state = safeString(recorder.state);',
  '      nowEvent("media_recorder.pause_event", { id: id, state: safeString(recorder.state) });',
  '    });',
  '    recorder.addEventListener("resume", function onResume() {',
  '      state.recorders[id].state = safeString(recorder.state);',
  '      nowEvent("media_recorder.resume_event", { id: id, state: safeString(recorder.state) });',
  '    });',
  '    recorder.addEventListener("error", function onError(event) {',
  '      nowEvent("media_recorder.error_event", { id: id, error: safeString(event && event.error && event.error.message) });',
  '    });',
  '    ["start", "stop", "pause", "resume", "requestData"].forEach(function wrapMethod(methodName) {',
  '      if (typeof recorder[methodName] !== "function") { return; }',
  '      const originalMethod = recorder[methodName];',
  '      try {',
  '        recorder[methodName] = function probedRecorderMethod() {',
  '          nowEvent("media_recorder." + methodName + "_called", { id: id, args: Array.prototype.slice.call(arguments).map(safeString), state: safeString(recorder.state) });',
  '          return originalMethod.apply(this, arguments);',
  '        };',
  '      } catch (error) {',
  '        nowEvent("media_recorder.method_wrap_failed", { id: id, methodName: methodName, error: safeString(error && error.message) });',
  '      }',
  '    });',
  '    return id;',
  '  }',
  '  try {',
  '    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function") {',
  '      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);',
  '      navigator.mediaDevices.getUserMedia = function probedGetUserMedia(constraints) {',
  '        nowEvent("media_devices.get_user_media_called", { constraints: constraints || {} });',
  '        return originalGetUserMedia(constraints).then(function onStream(stream) {',
  '          nowEvent("media_devices.get_user_media_resolved", { stream: summarizeStream(stream) });',
  '          return stream;',
  '        }, function onError(error) {',
  '          nowEvent("media_devices.get_user_media_rejected", { error: safeString(error && error.message) });',
  '          throw error;',
  '        });',
  '      };',
  '      state.patches.getUserMedia = true;',
  '    }',
  '  } catch (error) { state.patches.getUserMedia = safeString(error && error.message); }',
  '  try {',
  '    if (typeof MediaRecorder === "function") {',
  '      const OriginalMediaRecorder = MediaRecorder;',
  '      function ProbedMediaRecorder(stream, options) {',
  '        const recorder = new OriginalMediaRecorder(stream, options);',
  '        attachRecorder(recorder, stream, options);',
  '        return recorder;',
  '      }',
  '      Object.setPrototypeOf(ProbedMediaRecorder, OriginalMediaRecorder);',
  '      ProbedMediaRecorder.prototype = OriginalMediaRecorder.prototype;',
  '      ProbedMediaRecorder.isTypeSupported = function probedIsTypeSupported(type) { return OriginalMediaRecorder.isTypeSupported(type); };',
  '      window.MediaRecorder = ProbedMediaRecorder;',
  '      state.patches.MediaRecorder = true;',
  '    }',
  '  } catch (error) { state.patches.MediaRecorder = safeString(error && error.message); }',
  '  try {',
  '    if (typeof FormData === "function") {',
  '      const originalAppend = FormData.prototype.append;',
  '      const originalSet = FormData.prototype.set;',
  '      FormData.prototype.append = function probedAppend(name, value, filename) {',
  '        const result = originalAppend.apply(this, arguments);',
  '        nowEvent("form_data.append", { name: safeString(name), filename: safeString(filename), value: summarizeBody(value) });',
  '        return result;',
  '      };',
  '      if (typeof originalSet === "function") {',
  '        FormData.prototype.set = function probedSet(name, value, filename) {',
  '          const result = originalSet.apply(this, arguments);',
  '          nowEvent("form_data.set", { name: safeString(name), filename: safeString(filename), value: summarizeBody(value) });',
  '          return result;',
  '        };',
  '      }',
  '      state.patches.FormData = true;',
  '    }',
  '  } catch (error) { state.patches.FormData = safeString(error && error.message); }',
  '  try {',
  '    if (typeof fetch === "function") {',
  '      const originalFetch = fetch;',
  '      window.fetch = function probedFetch(input, init) {',
  '        const url = typeof input === "string" ? input : safeString(input && input.url);',
  '        if (isTranscribeUrl(url)) {',
  '          nowEvent("fetch.transcribe_called", { url: url, method: safeString((init && init.method) || (input && input.method) || "GET"), body: summarizeBody(init && init.body) });',
  '        }',
  '        return originalFetch.apply(this, arguments).then(function onResponse(response) {',
  '          if (isTranscribeUrl(url)) { nowEvent("fetch.transcribe_resolved", { url: url, status: response.status, ok: response.ok }); }',
  '          return response;',
  '        }, function onError(error) {',
  '          if (isTranscribeUrl(url)) { nowEvent("fetch.transcribe_rejected", { url: url, error: safeString(error && error.message) }); }',
  '          throw error;',
  '        });',
  '      };',
  '      state.patches.fetch = true;',
  '    }',
  '  } catch (error) { state.patches.fetch = safeString(error && error.message); }',
  '  try {',
  '    if (typeof XMLHttpRequest === "function") {',
  '      const originalOpen = XMLHttpRequest.prototype.open;',
  '      const originalSend = XMLHttpRequest.prototype.send;',
  '      XMLHttpRequest.prototype.open = function probedOpen(method, url) {',
  '        this.__generalSttProbe = { method: safeString(method), url: safeString(url) };',
  '        return originalOpen.apply(this, arguments);',
  '      };',
  '      XMLHttpRequest.prototype.send = function probedSend(body) {',
  '        const meta = this.__generalSttProbe || {};',
  '        if (isTranscribeUrl(meta.url)) { nowEvent("xhr.transcribe_send", { url: meta.url, method: meta.method, body: summarizeBody(body) }); }',
  '        return originalSend.apply(this, arguments);',
  '      };',
  '      state.patches.XMLHttpRequest = true;',
  '    }',
  '  } catch (error) { state.patches.XMLHttpRequest = safeString(error && error.message); }',
  '  try {',
  '    if (navigator && typeof navigator.sendBeacon === "function") {',
  '      const originalSendBeacon = navigator.sendBeacon.bind(navigator);',
  '      navigator.sendBeacon = function probedSendBeacon(url, data) {',
  '        if (isTranscribeUrl(url)) { nowEvent("send_beacon.transcribe_called", { url: safeString(url), body: summarizeBody(data) }); }',
  '        return originalSendBeacon(url, data);',
  '      };',
  '      state.patches.sendBeacon = true;',
  '    }',
  '  } catch (error) { state.patches.sendBeacon = safeString(error && error.message); }',
  '  nowEvent("probe.installed", { patches: state.patches });',
  '  return { installed: true, alreadyInstalled: false, patches: state.patches };',
  '}())'
].join('\n');

const RECORDER_PROBE_SNAPSHOT_SCRIPT = [
  '(function snapshotGeneralSttRecorderProbe() {',
  '  const state = window.__GENERAL_STT_RECORDER_PROBE__ || null;',
  '  if (!state) {',
  '    return { installed: false, href: window.location.href, recordedAt: new Date().toISOString() };',
  '  }',
  '  return {',
  '    installed: true,',
  '    href: window.location.href,',
  '    recordedAt: new Date().toISOString(),',
  '    installedAt: state.installedAt,',
  '    installedAtMs: state.installedAtMs,',
  '    patches: state.patches || {},',
  '    counters: state.counters || {},',
  '    recorders: state.recorders || {},',
  '    events: (state.events || []).slice()',
  '  };',
  '}())'
].join('\n');

function noop() {}

function defaultLogger() {
  return {
    debug: noop,
    error: noop,
    info: noop,
    warn: noop
  };
}

function sanitizePathSegment(value) {
  const text = String(value || '').trim();
  const sanitized = text
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');
  return sanitized || 'snapshot';
}

function safeJsonWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function summarizeRecorderProbeSnapshot(snapshot) {
  const events = Array.isArray(snapshot && snapshot.events) ? snapshot.events : [];
  const recorders = snapshot && snapshot.recorders && typeof snapshot.recorders === 'object' ?
    Object.keys(snapshot.recorders) :
    [];

  return {
    eventCount: events.length,
    eventsDropped: Number(snapshot && snapshot.counters && snapshot.counters.eventsDropped) || 0,
    installed: Boolean(snapshot && snapshot.installed),
    recorderCount: recorders.length
  };
}

/**
 * 在 ChatGPT 页面主 world 安装 recorder probe。
 *
 * probe 会 patch 页面自己的 MediaRecorder/FormData/fetch/XHR 等对象，因此必须
 * 在开始听写快捷键发送前执行。
 *
 * @param {object} options 安装设置。
 * @param {object} options.webContents Electron `WebContents`。
 * @param {object} [options.logger] app logger。
 * @returns {Promise<boolean>} 安装成功或已经安装时返回 `true`。
 */
function installChatGptRecorderProbe(options) {
  const probeOptions = options || {};
  const logger = probeOptions.logger || defaultLogger();
  const webContents = probeOptions.webContents;

  if (!webContents || typeof webContents.executeJavaScript !== 'function') {
    if (logger && typeof logger.debug === 'function') {
      logger.debug('recorder_probe.install_skipped_unavailable');
    }
    return Promise.resolve(false);
  }

  if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
    if (logger && typeof logger.debug === 'function') {
      logger.debug('recorder_probe.install_skipped_destroyed');
    }
    return Promise.resolve(false);
  }

  return Promise.resolve(webContents.executeJavaScript(RECORDER_PROBE_INSTALL_SCRIPT, true))
    .then((result) => {
      if (logger && typeof logger.info === 'function') {
        logger.info('recorder_probe.installed', {
          alreadyInstalled: Boolean(result && result.alreadyInstalled),
          installed: Boolean(result && result.installed),
          patches: result && result.patches
        });
      }
      return Boolean(result && result.installed);
    })
    .catch((error) => {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('recorder_probe.install_failed', {
          error: error && error.message ? error.message : String(error)
        });
      }
      return false;
    });
}

/**
 * 抓取 recorder probe 当前状态，并写入 request debug 目录。
 *
 * artifact 会保留页面 recorder lifecycle、FormData file size 和 transcribe fetch/XHR
 * body 摘要。它不保存音频字节，音频字节仍由 Network postData artifact 保存。
 *
 * @param {object} options 抓取设置。
 * @param {object} options.webContents Electron `WebContents`。
 * @param {string} options.outputDir artifact 输出目录。
 * @param {string} options.label 文件名 label。
 * @param {string} [options.requestId] transcribe request id。
 * @param {object} [options.logger] app logger。
 * @param {Function} [options.nowFn] 当前时间函数，主要用于测试。
 * @returns {Promise<string|null>} 成功写入时返回 artifact 路径。
 */
function captureChatGptRecorderProbeSnapshot(options) {
  const probeOptions = options || {};
  const logger = probeOptions.logger || defaultLogger();
  const outputDir = String(probeOptions.outputDir || '').trim();
  const label = sanitizePathSegment(probeOptions.label);
  const nowFn = typeof probeOptions.nowFn === 'function' ? probeOptions.nowFn : () => new Date();
  const webContents = probeOptions.webContents;

  if (!outputDir || !webContents || typeof webContents.executeJavaScript !== 'function') {
    if (logger && typeof logger.debug === 'function') {
      logger.debug('recorder_probe.snapshot_skipped_unavailable', {
        label: label,
        requestId: probeOptions.requestId || ''
      });
    }
    return Promise.resolve(null);
  }

  if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
    if (logger && typeof logger.debug === 'function') {
      logger.debug('recorder_probe.snapshot_skipped_destroyed', {
        label: label,
        requestId: probeOptions.requestId || ''
      });
    }
    return Promise.resolve(null);
  }

  const artifactPath = path.join(outputDir, 'recorder-probe-' + label + '.json');

  return Promise.resolve(webContents.executeJavaScript(RECORDER_PROBE_SNAPSHOT_SCRIPT, true))
    .then((snapshot) => {
      safeJsonWrite(artifactPath, {
        label: label,
        recordedAt: nowFn().toISOString(),
        requestId: String(probeOptions.requestId || ''),
        snapshot: snapshot
      });

      if (logger && typeof logger.info === 'function') {
        logger.info('recorder_probe.snapshot_written', Object.assign({
          artifactPath: artifactPath,
          label: label,
          requestId: probeOptions.requestId || ''
        }, summarizeRecorderProbeSnapshot(snapshot)));
      }

      return artifactPath;
    })
    .catch((error) => {
      const failedPath = path.join(outputDir, 'recorder-probe-' + label + '-failed.json');

      try {
        safeJsonWrite(failedPath, {
          error: error && error.message ? error.message : String(error),
          label: label,
          recordedAt: nowFn().toISOString(),
          requestId: String(probeOptions.requestId || '')
        });
      } catch (writeError) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn('recorder_probe.snapshot_write_failed', {
            error: writeError.message,
            label: label,
            requestId: probeOptions.requestId || ''
          });
        }
      }

      if (logger && typeof logger.warn === 'function') {
        logger.warn('recorder_probe.snapshot_failed', {
          error: error && error.message ? error.message : String(error),
          label: label,
          requestId: probeOptions.requestId || ''
        });
      }

      return null;
    });
}

module.exports = {
  RECORDER_PROBE_INSTALL_SCRIPT: RECORDER_PROBE_INSTALL_SCRIPT,
  RECORDER_PROBE_SNAPSHOT_SCRIPT: RECORDER_PROBE_SNAPSHOT_SCRIPT,
  captureChatGptRecorderProbeSnapshot: captureChatGptRecorderProbeSnapshot,
  installChatGptRecorderProbe: installChatGptRecorderProbe,
  sanitizePathSegment: sanitizePathSegment,
  summarizeRecorderProbeSnapshot: summarizeRecorderProbeSnapshot
};
