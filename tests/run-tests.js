'use strict';

const testModules = [
  './appConfig.test',
  './appIcon.test',
  './appLogger.test',
  './appPackaging.test',
  './chatgptAppRecorder.test',
  './chatgptInput.test',
  './chatgptDomSnapshot.test',
  './chatgptShortcutBridgeDelay.test',
  './chatgptRecorderProbe.test',
  './chatgptTranscribeMonitor.test',
  './chatgptUploadReplacement.test',
  './dictationSession.test',
  './foregroundWindow.test',
  './miniOverlayWindow.test',
  './miniOverlayState.test',
  './permissions.test',
  './shortcutWindowActivation.test',
  './systemSound.test',
  './windowModes.test',
  './transcriptPipeline.test',
  './windowsPaste.test'
];

async function main() {
  for (let index = 0; index < testModules.length; index += 1) {
    const modulePath = testModules[index];
    await require(modulePath).run();
    console.log('ok - ' + modulePath);
  }

  require('./chatgptShortcutBridge.test');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
