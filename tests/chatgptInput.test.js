'use strict';

const assert = require('assert');

const {
  buildClearChatGptInputScript,
  clearChatGptInput
} = require('../src/main/chatgptInput');

async function run() {
  const script = buildClearChatGptInputScript();

  assert.ok(script.indexOf('#prompt-textarea') !== -1);
  assert.ok(script.indexOf('textarea') !== -1);
  assert.ok(script.indexOf('contenteditable') !== -1);
  assert.ok(script.indexOf('InputEvent') !== -1);

  const calls = [];
  const result = await clearChatGptInput({
    executeJavaScript: function executeJavaScript(scriptText, userGesture) {
      calls.push([scriptText, userGesture]);
      return Promise.resolve(true);
    }
  });

  assert.strictEqual(result, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][1], true);
  assert.strictEqual(await clearChatGptInput(null), false);
}

module.exports = {
  run: run
};
