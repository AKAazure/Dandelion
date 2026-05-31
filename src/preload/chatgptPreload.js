'use strict';

const { ipcRenderer } = require('electron');

const INPUT_SELECTORS = [
  '#prompt-textarea',
  'textarea',
  '[contenteditable="true"]'
];

const USER_MESSAGE_SELECTORS = [
  '[data-message-author-role="user"]',
  '[data-testid*="conversation-turn"] [data-message-author-role="user"]'
];

let lastText = '';
let debounceTimer = null;

function textFromElement(element) {
  if (!element) {
    return '';
  }

  if (typeof element.value === 'string') {
    return element.value.trim();
  }

  return (element.innerText || element.textContent || '').trim();
}

function findLatestText(selectors) {
  for (let index = 0; index < selectors.length; index += 1) {
    const elements = Array.prototype.slice.call(document.querySelectorAll(selectors[index]));

    for (let elementIndex = elements.length - 1; elementIndex >= 0; elementIndex -= 1) {
      const text = textFromElement(elements[elementIndex]);

      if (text) {
        return text;
      }
    }
  }

  return '';
}

function collectTranscriptText() {
  return findLatestText(INPUT_SELECTORS) || findLatestText(USER_MESSAGE_SELECTORS);
}

function notifyTranscriptIfChanged() {
  const text = collectTranscriptText();

  if (!text || text === lastText) {
    return;
  }

  lastText = text;
  ipcRenderer.send('general-stt:transcript', {
    source: 'chatgpt-dom',
    text: text,
    timestamp: Date.now()
  });
}

function scheduleTranscriptCheck() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(notifyTranscriptIfChanged, 800);
}

function attachDomObserver() {
  const observer = new MutationObserver(scheduleTranscriptCheck);
  observer.observe(document.documentElement, {
    characterData: true,
    childList: true,
    subtree: true
  });

  document.addEventListener('input', scheduleTranscriptCheck, true);
  document.addEventListener('keyup', scheduleTranscriptCheck, true);
  scheduleTranscriptCheck();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachDomObserver, { once: true });
} else {
  attachDomObserver();
}
