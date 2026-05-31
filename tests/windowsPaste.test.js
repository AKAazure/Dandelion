'use strict';

const assert = require('assert');

const { buildPowerShellPasteCommand } = require('../src/main/windowsPaste');

function run() {
  assert.strictEqual(
    buildPowerShellPasteCommand(),
    'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")'
  );
}

module.exports = {
  run: run
};
