'use strict';

const APP_RECORDER_START_SCRIPT = [
  '(function startGeneralSttAppRecorder() {',
  '  const key = "__GENERAL_STT_APP_RECORDER__";',
  '  function safeString(value) {',
  '    if (value === null || value === undefined) { return ""; }',
  '    try { return String(value); } catch (error) { return "[unstringifiable]"; }',
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
  '      active: Boolean(stream.active),',
  '      id: safeString(stream.id),',
  '      tracks: stream.getTracks().map(summarizeTrack)',
  '    };',
  '  }',
  '  function createState() {',
  '    return {',
  '      id: "app-recording-" + Date.now(),',
  '      startedAt: new Date().toISOString(),',
  '      startedAtMs: Date.now(),',
  '      status: "starting",',
  '      chunks: [],',
  '      chunkCount: 0,',
  '      totalBytes: 0,',
  '      events: [],',
  '      error: ""',
  '    };',
  '  }',
  '  function addEvent(state, type, details) {',
  '    state.events.push({',
  '      type: type,',
  '      recordedAt: new Date().toISOString(),',
  '      timeSinceStartMs: Date.now() - state.startedAtMs,',
  '      details: details || {}',
  '    });',
  '    if (state.events.length > 500) { state.events.shift(); }',
  '  }',
  '  function chooseMimeType() {',
  '    const candidates = ["audio/webm;codecs=opus", "audio/webm"];',
  '    if (typeof MediaRecorder === "undefined") { return ""; }',
  '    for (let index = 0; index < candidates.length; index += 1) {',
  '      if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(candidates[index])) {',
  '        return candidates[index];',
  '      }',
  '    }',
  '    return "";',
  '  }',
  '  function summarizeState(state) {',
  '    return {',
  '      ok: state.status === "recording",',
  '      id: state.id,',
  '      mimeType: state.mimeType || "",',
  '      status: state.status,',
  '      chunkCount: state.chunkCount,',
  '      totalBytes: state.totalBytes,',
  '      startedAt: state.startedAt,',
  '      stream: state.streamSummary || null,',
  '      events: state.events.slice(),',
  '      error: state.error || ""',
  '    };',
  '  }',
  '  const existing = window[key];',
  '  if (existing && existing.status === "recording") {',
  '    addEvent(existing, "start.reused_existing", {});',
  '    return Promise.resolve(Object.assign(summarizeState(existing), { alreadyRecording: true }));',
  '  }',
  '  const state = createState();',
  '  window[key] = state;',
  '  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {',
  '    state.status = "failed";',
  '    state.error = "getUserMedia unavailable";',
  '    addEvent(state, "start.failed", { error: state.error });',
  '    return Promise.resolve(summarizeState(state));',
  '  }',
  '  if (typeof MediaRecorder === "undefined") {',
  '    state.status = "failed";',
  '    state.error = "MediaRecorder unavailable";',
  '    addEvent(state, "start.failed", { error: state.error });',
  '    return Promise.resolve(summarizeState(state));',
  '  }',
  '  addEvent(state, "get_user_media.called", { constraints: { audio: true } });',
  '  return navigator.mediaDevices.getUserMedia({ audio: true }).then(function onStream(stream) {',
  '    state.stream = stream;',
  '    state.streamSummary = summarizeStream(stream);',
  '    state.mimeType = chooseMimeType();',
  '    const options = state.mimeType ? { mimeType: state.mimeType } : undefined;',
  '    const recorder = new MediaRecorder(stream, options);',
  '    state.recorder = recorder;',
  '    state.mimeType = recorder.mimeType || state.mimeType || "audio/webm";',
  '    recorder.addEventListener("dataavailable", function onDataAvailable(event) {',
  '      if (!event || !event.data || event.data.size <= 0) {',
  '        addEvent(state, "dataavailable.empty", {});',
  '        return;',
  '      }',
  '      state.chunks.push(event.data);',
  '      state.chunkCount += 1;',
  '      state.totalBytes += event.data.size;',
  '      addEvent(state, "dataavailable", { size: event.data.size, type: event.data.type || "" });',
  '    });',
  '    recorder.addEventListener("stop", function onStop() {',
  '      state.status = "stopped";',
  '      state.stoppedAt = new Date().toISOString();',
  '      state.stoppedAtMs = Date.now();',
  '      state.blob = new Blob(state.chunks, { type: state.mimeType });',
  '      addEvent(state, "stop.event", { chunkCount: state.chunkCount, totalBytes: state.totalBytes, blobSize: state.blob.size });',
  '      if (state.stream && typeof state.stream.getTracks === "function") {',
  '        state.stream.getTracks().forEach(function stopTrack(track) { try { track.stop(); } catch (error) {} });',
  '      }',
  '    });',
  '    recorder.addEventListener("error", function onError(event) {',
  '      state.error = safeString(event && event.error && event.error.message);',
  '      addEvent(state, "error", { error: state.error });',
  '    });',
  '    recorder.start(1000);',
  '    state.status = "recording";',
  '    addEvent(state, "start.ok", { mimeType: state.mimeType });',
  '    return summarizeState(state);',
  '  }).catch(function onError(error) {',
  '    state.status = "failed";',
  '    state.error = safeString(error && error.message);',
  '    addEvent(state, "start.failed", { error: state.error });',
  '    return summarizeState(state);',
  '  });',
  '}())'
].join('\n');

const APP_RECORDER_STOP_SCRIPT = [
  '(function stopGeneralSttAppRecorder() {',
  '  const key = "__GENERAL_STT_APP_RECORDER__";',
  '  function safeString(value) {',
  '    if (value === null || value === undefined) { return ""; }',
  '    try { return String(value); } catch (error) { return "[unstringifiable]"; }',
  '  }',
  '  function addEvent(state, type, details) {',
  '    if (!state.events) { state.events = []; }',
  '    state.events.push({',
  '      type: type,',
  '      recordedAt: new Date().toISOString(),',
  '      timeSinceStartMs: state.startedAtMs ? Date.now() - state.startedAtMs : 0,',
  '      details: details || {}',
  '    });',
  '    if (state.events.length > 500) { state.events.shift(); }',
  '  }',
  '  function blobToBase64(blob) {',
  '    return new Promise(function readBlob(resolve, reject) {',
  '      const reader = new FileReader();',
  '      reader.onload = function onLoad() {',
  '        const text = safeString(reader.result);',
  '        const commaIndex = text.indexOf(",");',
  '        resolve(commaIndex === -1 ? text : text.slice(commaIndex + 1));',
  '      };',
  '      reader.onerror = function onError() { reject(reader.error || new Error("FileReader failed")); };',
  '      reader.readAsDataURL(blob);',
  '    });',
  '  }',
  '  function buildBlob(state) {',
  '    if (state.blob) { return state.blob; }',
  '    state.blob = new Blob(state.chunks || [], { type: state.mimeType || "audio/webm" });',
  '    return state.blob;',
  '  }',
  '  function finish(state) {',
  '    const blob = buildBlob(state);',
  '    return blobToBase64(blob).then(function onBase64(base64) {',
  '      const durationMs = state.stoppedAtMs && state.startedAtMs ? state.stoppedAtMs - state.startedAtMs : 0;',
  '      return {',
  '        ok: Boolean(base64 && blob.size > 0),',
  '        id: state.id || "",',
  '        base64: base64,',
  '        byteLength: blob.size,',
  '        chunkCount: state.chunkCount || 0,',
  '        durationMs: durationMs,',
  '        events: (state.events || []).slice(),',
  '        filename: "whisper.webm",',
  '        mimeType: blob.type || state.mimeType || "audio/webm",',
  '        startedAt: state.startedAt || "",',
  '        status: state.status || "",',
  '        stoppedAt: state.stoppedAt || "",',
  '        totalBytes: state.totalBytes || 0',
  '      };',
  '    });',
  '  }',
  '  const state = window[key];',
  '  if (!state) {',
  '    return Promise.resolve({ ok: false, error: "app recorder was not started" });',
  '  }',
  '  if (state.status === "recording" && state.recorder && state.recorder.state !== "inactive") {',
  '    addEvent(state, "stop.called", { recorderState: state.recorder.state });',
  '    return new Promise(function waitForStop(resolve) {',
  '      let settled = false;',
  '      function done() {',
  '        if (settled) { return; }',
  '        settled = true;',
  '        resolve(finish(state));',
  '      }',
  '      state.recorder.addEventListener("stop", done, { once: true });',
  '      setTimeout(function onStopTimeout() {',
  '        if (settled) { return; }',
  '        addEvent(state, "stop.timeout_finish_from_chunks", {});',
  '        state.status = "stopped";',
  '        state.stoppedAt = new Date().toISOString();',
  '        state.stoppedAtMs = Date.now();',
  '        if (state.stream && typeof state.stream.getTracks === "function") {',
  '          state.stream.getTracks().forEach(function stopTrack(track) { try { track.stop(); } catch (error) {} });',
  '        }',
  '        done();',
  '      }, 3000);',
  '      try {',
  '        if (typeof state.recorder.requestData === "function") { state.recorder.requestData(); }',
  '        state.recorder.stop();',
  '      } catch (error) {',
  '        addEvent(state, "stop.error", { error: safeString(error && error.message) });',
  '        state.status = "stopped";',
  '        state.stoppedAt = new Date().toISOString();',
  '        state.stoppedAtMs = Date.now();',
  '        done();',
  '      }',
  '    }).then(function unwrap(value) { return value; });',
  '  }',
  '  return finish(state);',
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

function normalizeRecordingResult(result) {
  const recording = result || {};
  const base64 = String(recording.base64 || '').trim();
  const byteLength = Number(recording.byteLength) || 0;

  return {
    ok: recording.ok === true && Boolean(base64) && byteLength > 0,
    base64: base64,
    byteLength: byteLength,
    chunkCount: Number(recording.chunkCount) || 0,
    durationMs: Number(recording.durationMs) || 0,
    error: String(recording.error || ''),
    events: Array.isArray(recording.events) ? recording.events : [],
    filename: String(recording.filename || 'whisper.webm'),
    id: String(recording.id || ''),
    mimeType: String(recording.mimeType || 'audio/webm'),
    startedAt: String(recording.startedAt || ''),
    status: String(recording.status || ''),
    stoppedAt: String(recording.stoppedAt || ''),
    totalBytes: Number(recording.totalBytes) || 0
  };
}

/**
 * 在 ChatGPT 页面里启动 app 侧 MediaRecorder。
 *
 * 这条 recorder 由 app 注入脚本创建，独立于 ChatGPT 页面自己的 recorder。
 *
 * @param {object} options 启动设置。
 * @param {object} options.webContents Electron `WebContents`。
 * @param {object} [options.logger] app logger。
 * @returns {Promise<object>} recorder start summary。
 */
function startChatGptAppRecorder(options) {
  const recorderOptions = options || {};
  const logger = recorderOptions.logger || defaultLogger();
  const webContents = recorderOptions.webContents;

  if (!webContents || typeof webContents.executeJavaScript !== 'function') {
    return Promise.resolve({
      ok: false,
      error: 'webContents.executeJavaScript is unavailable'
    });
  }

  if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
    return Promise.resolve({
      ok: false,
      error: 'webContents is destroyed'
    });
  }

  return Promise.resolve(webContents.executeJavaScript(APP_RECORDER_START_SCRIPT, true))
    .then((result) => {
      if (logger && typeof logger.info === 'function') {
        logger.info('app_recorder.started', {
          alreadyRecording: Boolean(result && result.alreadyRecording),
          chunkCount: Number(result && result.chunkCount) || 0,
          id: result && result.id,
          mimeType: result && result.mimeType,
          ok: Boolean(result && result.ok),
          status: result && result.status,
          totalBytes: Number(result && result.totalBytes) || 0
        });
      }
      return result || {};
    })
    .catch((error) => {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('app_recorder.start_failed', {
          error: error && error.message ? error.message : String(error)
        });
      }
      return {
        ok: false,
        error: error && error.message ? error.message : String(error)
      };
    });
}

/**
 * 停止 app 侧 recorder，并把录音 webm 以 base64 形式返回给 main process。
 *
 * @param {object} options 停止设置。
 * @param {object} options.webContents Electron `WebContents`。
 * @param {object} [options.logger] app logger。
 * @returns {Promise<object>} 标准化后的 recording result。
 */
function stopChatGptAppRecorder(options) {
  const recorderOptions = options || {};
  const logger = recorderOptions.logger || defaultLogger();
  const webContents = recorderOptions.webContents;

  if (!webContents || typeof webContents.executeJavaScript !== 'function') {
    return Promise.resolve(normalizeRecordingResult({
      ok: false,
      error: 'webContents.executeJavaScript is unavailable'
    }));
  }

  if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
    return Promise.resolve(normalizeRecordingResult({
      ok: false,
      error: 'webContents is destroyed'
    }));
  }

  return Promise.resolve(webContents.executeJavaScript(APP_RECORDER_STOP_SCRIPT, true))
    .then((result) => {
      const normalized = normalizeRecordingResult(result);

      if (logger && typeof logger.info === 'function') {
        logger.info('app_recorder.stopped', {
          byteLength: normalized.byteLength,
          chunkCount: normalized.chunkCount,
          durationMs: normalized.durationMs,
          id: normalized.id,
          mimeType: normalized.mimeType,
          ok: normalized.ok,
          status: normalized.status
        });
      }

      return normalized;
    })
    .catch((error) => {
      const normalized = normalizeRecordingResult({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });

      if (logger && typeof logger.warn === 'function') {
        logger.warn('app_recorder.stop_failed', {
          error: normalized.error
        });
      }

      return normalized;
    });
}

module.exports = {
  APP_RECORDER_START_SCRIPT: APP_RECORDER_START_SCRIPT,
  APP_RECORDER_STOP_SCRIPT: APP_RECORDER_STOP_SCRIPT,
  normalizeRecordingResult: normalizeRecordingResult,
  startChatGptAppRecorder: startChatGptAppRecorder,
  stopChatGptAppRecorder: stopChatGptAppRecorder
};
