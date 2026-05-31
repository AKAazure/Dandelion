'use strict';

(function startMiniOverlay() {
  const shell = document.getElementById('shell');
  const bars = Array.prototype.slice.call(document.querySelectorAll('.bar'));
  const resultText = document.getElementById('resultText');
  const copyButton = document.getElementById('copyButton');
  const openButton = document.getElementById('openButton');
  const bridge = window.generalSttMiniOverlay || {};
  let audioContext = null;
  let analyser = null;
  let samples = null;
  let mediaStream = null;
  let animationToken = 0;
  let smoothedLevel = 0;
  let fallbackAnimation = false;
  let micStarted = false;
  let overlayVisible = false;
  let currentState = 'idle';
  let currentResultText = '';
  let dragStartPoint = null;
  let dragMoved = false;
  let suppressNextClick = false;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isResultState(state) {
    return state === 'success' || state === 'error';
  }

  function getClosestTarget(event) {
    if (!event || !event.target) {
      return null;
    }

    return typeof event.target.closest === 'function'
      ? event.target
      : event.target.parentElement;
  }

  function isInteractiveTarget(event) {
    const target = getClosestTarget(event);

    return Boolean(target && (
      target.closest('button') ||
      target.closest('.result-text')
    ));
  }

  function readScreenPoint(event) {
    return {
      screenX: Number(event.screenX),
      screenY: Number(event.screenY)
    };
  }

  function setBarLevels(level, offsets) {
    shell.style.setProperty('--level', String(clamp(level, 0, 1)));

    bars.forEach(function setBarLevel(bar, index) {
      const offset = offsets ? offsets[index] : 1;
      const scale = clamp(0.12 + (level * offset), 0.12, 1);
      bar.style.transform = 'scaleY(' + scale.toFixed(3) + ')';
    });
  }

  function setResultText(text) {
    currentResultText = String(text || '').trim();
    resultText.textContent = currentResultText;
  }

  function runFallbackAnimation(timestamp) {
    if (!fallbackAnimation) {
      return;
    }

    const offsets = bars.map(function buildOffset(_bar, index) {
      return 0.42 + Math.abs(Math.sin((timestamp / 190) + index * 0.7)) * 0.58;
    });

    setBarLevels(0.36, offsets);
    animationToken = window.requestAnimationFrame(runFallbackAnimation);
  }

  function renderAudioFrame() {
    if (!micStarted || !analyser || !samples) {
      return;
    }

    analyser.getFloatTimeDomainData(samples);

    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) {
      sum += samples[index] * samples[index];
    }

    const rms = Math.sqrt(sum / samples.length);
    const rawLevel = clamp(rms * 8.5, 0, 1);
    smoothedLevel = (smoothedLevel * 0.82) + (rawLevel * 0.18);

    const offsets = bars.map(function buildOffset(_bar, index) {
      const centerBias = 1 - Math.abs(index - ((bars.length - 1) / 2)) / bars.length;
      return 0.54 + centerBias * 0.62;
    });

    setBarLevels(smoothedLevel, offsets);
    animationToken = window.requestAnimationFrame(renderAudioFrame);
  }

  async function startMicMeter() {
    if (micStarted) {
      return;
    }

    micStarted = true;

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      shell.dataset.mic = 'unavailable';
      fallbackAnimation = true;
      animationToken = window.requestAnimationFrame(runFallbackAnimation);
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false
        },
        video: false
      });

      if (!micStarted) {
        mediaStream.getTracks().forEach(function stopLateTrack(track) {
          track.stop();
        });
        mediaStream = null;
        return;
      }

      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      samples = new Float32Array(analyser.fftSize);
      audioContext.createMediaStreamSource(mediaStream).connect(analyser);

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      shell.dataset.mic = 'available';
      renderAudioFrame();
    } catch (error) {
      if (!micStarted) {
        return;
      }

      shell.dataset.mic = 'unavailable';
      fallbackAnimation = true;
      animationToken = window.requestAnimationFrame(runFallbackAnimation);
    }
  }

  function stopMicMeter() {
    micStarted = false;
    fallbackAnimation = false;

    if (animationToken) {
      window.cancelAnimationFrame(animationToken);
      animationToken = 0;
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(function stopTrack(track) {
        track.stop();
      });
      mediaStream = null;
    }

    if (audioContext) {
      audioContext.close().catch(function ignoreCloseError() {});
      audioContext = null;
    }

    analyser = null;
    samples = null;
    smoothedLevel = 0;
    shell.dataset.mic = 'paused';
    setBarLevels(0);
  }

  function syncMicWithState() {
    if (overlayVisible && currentState === 'listening') {
      startMicMeter();
      return;
    }

    stopMicMeter();
  }

  function applyDictationState(payload) {
    const nextState = String((payload && payload.state) || 'idle').trim().toLowerCase();
    currentState = ['idle', 'listening', 'processing', 'success', 'error'].indexOf(nextState) === -1
      ? 'idle'
      : nextState;
    shell.dataset.state = currentState;

    if (currentState === 'success') {
      setResultText(payload.text || '');
    } else if (currentState === 'error') {
      setResultText(payload.message || '听写失败。');
    } else if (!isResultState(currentState)) {
      setResultText('');
    }

    syncMicWithState();
  }

  function openMainWindow() {
    if (typeof bridge.openMainWindow === 'function') {
      bridge.openMainWindow();
    }
  }

  shell.addEventListener('pointerdown', function startOverlayDrag(event) {
    if (event.button !== 0 || isInteractiveTarget(event)) {
      return;
    }

    dragStartPoint = readScreenPoint(event);
    dragMoved = false;

    if (typeof bridge.dragStart === 'function') {
      bridge.dragStart(dragStartPoint);
    }

    if (typeof shell.setPointerCapture === 'function') {
      shell.setPointerCapture(event.pointerId);
    }

    shell.dataset.dragging = 'true';
    event.preventDefault();
  });

  shell.addEventListener('pointermove', function moveOverlayDrag(event) {
    if (!dragStartPoint) {
      return;
    }

    const point = readScreenPoint(event);
    const deltaX = point.screenX - dragStartPoint.screenX;
    const deltaY = point.screenY - dragStartPoint.screenY;

    if (!dragMoved && Math.sqrt((deltaX * deltaX) + (deltaY * deltaY)) < 4) {
      return;
    }

    dragMoved = true;

    if (typeof bridge.dragMove === 'function') {
      bridge.dragMove(point);
    }
  });

  function finishOverlayDrag(event) {
    if (!dragStartPoint) {
      return;
    }

    const point = readScreenPoint(event);

    if (typeof bridge.dragEnd === 'function') {
      bridge.dragEnd(point);
    }

    suppressNextClick = dragMoved;
    dragStartPoint = null;
    dragMoved = false;
    delete shell.dataset.dragging;

    if (typeof shell.releasePointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        shell.releasePointerCapture(event.pointerId);
      } catch (error) {}
    }
  }

  shell.addEventListener('pointerup', finishOverlayDrag);
  shell.addEventListener('pointercancel', finishOverlayDrag);

  shell.addEventListener('click', function handleShellClick(event) {
    if (suppressNextClick) {
      suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (isInteractiveTarget(event)) {
      return;
    }

    if (!isResultState(currentState)) {
      openMainWindow();
    }
  });

  copyButton.addEventListener('click', function copyResult(event) {
    event.stopPropagation();
    if (currentResultText && typeof bridge.copyText === 'function') {
      bridge.copyText(currentResultText);
    }
  });

  openButton.addEventListener('click', function openFromResult(event) {
    event.stopPropagation();
    openMainWindow();
  });

  if (typeof bridge.onDictationState === 'function') {
    bridge.onDictationState(applyDictationState);
  }

  if (typeof bridge.onVisibilityState === 'function') {
    bridge.onVisibilityState(function handleVisibilityState(payload) {
      overlayVisible = Boolean(payload.visible);
      syncMicWithState();
    });
  }

  applyDictationState({
    state: 'idle'
  });

  if (typeof bridge.ready === 'function') {
    bridge.ready();
  }
}());
