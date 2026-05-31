'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const packageConfig = require('../package.json');

function readPngSize(filePath) {
  const buffer = fs.readFileSync(filePath);

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function run() {
  assert.strictEqual(packageConfig.main, 'src/main/main.js');
  assert.strictEqual(packageConfig.scripts['build:icons'], 'node scripts/buildWindowsIcon.js');
  assert.strictEqual(packageConfig.scripts['prepack:win'], 'npm run build:icons');
  assert.strictEqual(packageConfig.scripts['pack:win'], 'node node_modules/electron-builder/cli.js --win dir --x64');
  assert.strictEqual(packageConfig.scripts['dist:win'], 'node node_modules/electron-builder/cli.js --win portable --x64');
  assert.strictEqual(packageConfig.name, 'dandelion');
  assert.strictEqual(packageConfig.build.appId, 'com.akazure.dandelion');
  assert.strictEqual(packageConfig.build.productName, 'Dandelion');
  assert.strictEqual(packageConfig.build.asar, true);
  assert.strictEqual(packageConfig.build.directories.output, 'dist');
  assert.strictEqual(packageConfig.build.win.icon, 'assets/logo.ico');
  assert.deepStrictEqual(readPngSize(path.join(__dirname, '..', 'assets', 'logo-256.png')), {
    width: 256,
    height: 256
  });
  assert.strictEqual(fs.readFileSync(path.join(__dirname, '..', 'assets', 'logo.ico')).readUInt16LE(2), 1);
  assert.deepStrictEqual(packageConfig.build.win.target, [
    {
      target: 'dir',
      arch: ['x64']
    }
  ]);
  assert.strictEqual(packageConfig.build.extraResources[0].from, 'config');
  assert.strictEqual(packageConfig.build.extraResources[0].to, 'config');
}

module.exports = {
  run: run
};
