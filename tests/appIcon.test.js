'use strict';

const assert = require('assert');
const path = require('path');

const {
  createAppIcon,
  resolveAppIconPath
} = require('../src/main/appIcon');

function run() {
  assert.strictEqual(
    resolveAppIconPath('/tmp/general-stt'),
    path.join('/tmp/general-stt', 'assets', 'logo.png')
  );

  const calls = [];
  const icon = createAppIcon({
    createFromPath: function createFromPath(iconPath) {
      calls.push(iconPath);
      return { iconPath: iconPath };
    }
  }, '/tmp/general-stt/assets/logo.png');

  assert.deepStrictEqual(calls, ['/tmp/general-stt/assets/logo.png']);
  assert.deepStrictEqual(icon, {
    iconPath: '/tmp/general-stt/assets/logo.png'
  });
}

module.exports = {
  run: run
};
