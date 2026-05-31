'use strict';

function buildClearChatGptInputScript() {
  return [
    '(() => {',
    '  const selectors = ["#prompt-textarea", "textarea", "[contenteditable=\\"true\\"]"];',
    '  const dispatchInput = (element) => {',
    '    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));',
    '    element.dispatchEvent(new Event("change", { bubbles: true }));',
    '  };',
    '  for (const selector of selectors) {',
    '    const element = document.querySelector(selector);',
    '    if (!element) continue;',
    '    if (typeof element.value === "string") {',
    '      element.focus();',
    '      element.value = "";',
    '      dispatchInput(element);',
    '      return true;',
    '    }',
    '    if (element.isContentEditable) {',
    '      element.focus();',
    '      element.textContent = "";',
    '      dispatchInput(element);',
    '      return true;',
    '    }',
    '  }',
    '  return false;',
    '})()'
  ].join('\n');
}

/**
 * 清空 ChatGPT 当前输入栏。
 *
 * 这里通过 Electron `webContents.executeJavaScript` 在页面上下文中清空输入
 * 元素，并派发 input/change 事件，让 React 状态有机会同步更新。
 *
 * @param {object} webContents Electron WebContents 兼容对象。
 * @returns {Promise<boolean>} 找到并清空输入栏时 resolve `true`。
 */
function clearChatGptInput(webContents) {
  if (!webContents || typeof webContents.executeJavaScript !== 'function') {
    return Promise.resolve(false);
  }

  return webContents.executeJavaScript(buildClearChatGptInputScript(), true)
    .then((result) => result === true)
    .catch(() => false);
}

module.exports = {
  buildClearChatGptInputScript: buildClearChatGptInputScript,
  clearChatGptInput: clearChatGptInput
};
