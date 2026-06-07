# General STT Project Onboarding

这份文档给第一次接手这个 repo 的人用。目标不是列完所有函数，而是让你知道：

- 这个 app 解决什么问题。
- 代码从哪里启动。
- start / stop / cancel / transcribe 的流程怎么走。
- 各模块之间怎么配合。
- 出问题时先看哪些日志和 artifact。

## 1. 这个项目是什么

Dandelion 是一个 Windows Electron STT helper。它内嵌 `https://chatgpt.com`，用自定义全局快捷键控制 ChatGPT 网页听写，然后把转写结果复制到剪贴板并可选粘贴到当前前台 app。

当前默认交互：

- start：`Alt+,`
- stop：`Alt+.`
- cancel：`Escape`，只在听写活跃时注册
- 发给 ChatGPT 网页的目标快捷键：`Ctrl+Shift+D`

主要入口：

- app main process：[`../src/main/main.js`](../src/main/main.js)
- config：[`../src/main/appConfig.js`](../src/main/appConfig.js)、[`../config/dandelion.json`](../config/dandelion.json)
- ChatGPT shortcut bridge：[`../src/shortcut/chatgptShortcutBridge.js`](../src/shortcut/chatgptShortcutBridge.js)
- session state：[`../src/main/dictationSession.js`](../src/main/dictationSession.js)
- transcribe monitor：[`../src/main/chatgptTranscribeMonitor.js`](../src/main/chatgptTranscribeMonitor.js)
- transcript pipeline：[`../src/main/transcriptPipeline.js`](../src/main/transcriptPipeline.js)

## 2. 仓库地图

```text
assets/                 app icon source and generated ico/png
config/                 default runtime config
src/main/               Electron main process modules
src/preload/            preload scripts for ChatGPT page and mini overlay
src/renderer/           mini overlay UI
src/shortcut/           global shortcut -> ChatGPT web shortcut bridge
tests/                  module tests, run through tests/run-tests.js
.doc/modules/           module-level technical docs
.chat/                  investigation notes and long-form explanations
dist/win-unpacked/      packaged Windows dir output
```

Detailed module docs live under [`../.doc/modules/`](../.doc/modules/). Use this onboarding doc first, then jump into module docs when you need exact API behavior.

## 3. High-Level Architecture

```mermaid
flowchart LR
  User[User hotkey] --> Shortcut[Electron globalShortcut]
  Shortcut --> Bridge[chatgptShortcutBridge]
  Bridge --> Main[main.js coordination]

  Main --> Window[ChatGPT BrowserWindow]
  Window --> Page[chatgpt.com page]
  Page --> ChatGPTRecorder[ChatGPT web recorder]
  Page --> Remote[ChatGPT /backend-api/transcribe]

  Main --> Session[dictationSession]
  Main --> Overlay[mini overlay]
  Main --> AppRecorder[app recorder in ChatGPT page]
  Main --> Probe[recorder probe]

  Remote --> Monitor[CDP Network monitor]
  Monitor --> Main
  Page --> Preload[chatgptPreload DOM observer]
  Preload --> Main

  Main --> Pipeline[transcriptPipeline]
  Pipeline --> Clipboard[Clipboard]
  Pipeline --> Paste[Windows Ctrl+V]
  Pipeline --> Storage[last-transcript.json]

  Monitor --> Debug[remote-debug artifacts]
  Probe --> Debug
  AppRecorder --> Debug
```

Key idea: `main.js` is the orchestrator. Most other files are small modules that each own one boundary: config, shortcuts, window visibility, session state, remote request monitoring, DOM extraction, logging, paste, and packaging.

## 4. Runtime Boot Flow

```mermaid
sequenceDiagram
  participant App as Electron app
  participant Config
  participant Main
  participant Window as ChatGPT BrowserWindow
  participant Monitor as Transcribe Monitor
  participant Overlay as Mini Overlay
  participant Shortcut as globalShortcut

  App->>Config: loadAppConfig()
  Config-->>Main: normalized config
  Main->>Main: create logger and permission handler
  Main->>Window: create BrowserWindow
  Window->>Window: load https://chatgpt.com
  Main->>Monitor: create and start CDP monitor
  Main->>Overlay: create mini overlay window
  Main->>Shortcut: register start and stop bindings
  Main->>Shortcut: create inactive cancel binding
```

Important boot details:

- Dev mode uses `.runtime/dandelion-electron` as userData.
- Packaged mode uses `%APPDATA%\Dandelion`.
- Packaged config is `dist/win-unpacked/resources/config/dandelion.json`.
- ChatGPT login/session is stored in Electron persistent partition `persist:chatgpt`.
- The ChatGPT `BrowserWindow` uses `backgroundThrottling: false` so hidden/mini mode should not throttle `MediaRecorder`.

## 5. Window Model

There are two visible surfaces:

- Main ChatGPT window: the real browser that loads `chatgpt.com`.
- Mini overlay: local `file://` UI that shows idle/listening/processing/success/error.

In `mini` mode, the ChatGPT window is normally hidden. When a shortcut fires, the app temporarily moves the ChatGPT window offscreen, sets it transparent, focuses its `WebContents`, sends the web shortcut, then restores the previous foreground app.

Relevant files:

- [`../src/main/windowModes.js`](../src/main/windowModes.js)
- [`../src/main/shortcutWindowActivation.js`](../src/main/shortcutWindowActivation.js)
- [`../src/main/miniOverlayWindow.js`](../src/main/miniOverlayWindow.js)
- [`../src/main/miniOverlayState.js`](../src/main/miniOverlayState.js)

## 6. State Model

There are two separate state layers. Keep them separate when debugging.

```mermaid
flowchart LR
  subgraph MainCoordination[main.js coordination]
    A[startShortcutPending]
    B[stopAfterPendingStart]
  end

  subgraph DictationSession[dictationSession phases]
    C[idle]
    D[listening]
    E[processing]
    F[waiting_response]
  end

  C -->|markStartShortcutSent| D
  D -->|markStopShortcutSent| E
  E -->|markTranscribeRequestStarted| F
  F -->|finalized / failed / cancel| C

  A -. prevents duplicate start .-> C
  B -. replays stop after start is sent .-> D
```

`startShortcutPending` is not a dictation phase. It only means `beforeSend(start)` has started, but the actual web shortcut has not been sent yet.

`stopAfterPendingStart` means the user pressed stop while start was still preparing. The app stores that stop and triggers it after start `afterSend`.

## 7. Start Flow

```mermaid
sequenceDiagram
  participant User
  participant Bridge as Shortcut Bridge
  participant Main
  participant Page as ChatGPT Page
  participant Session
  participant Overlay

  User->>Bridge: press start binding
  Bridge->>Main: beforeSend(start)
  Main->>Main: reject if active session or startShortcutPending
  Main->>Page: install recorder probe
  Main->>Page: start app recorder if replacement enabled
  Main->>Page: clear ChatGPT input
  Bridge->>Page: send rawKeyDown Ctrl+Shift+D
  Bridge->>Main: afterSend(start)
  Main->>Session: markStartShortcutSent()
  Main->>Overlay: listening
  Main->>Main: play system sound
  Page->>Main: media permission request
  Main->>Session: markTrustedMediaRequest()
```

Start is confirmed by a trusted `media` permission request from ChatGPT. If that signal does not arrive within the confirmation window, the app retries start once.

## 8. Stop Flow

```mermaid
sequenceDiagram
  participant User
  participant Bridge as Shortcut Bridge
  participant Main
  participant Page as ChatGPT Page
  participant Session
  participant Recorder as App Recorder
  participant Overlay

  User->>Bridge: press stop binding
  Bridge->>Main: beforeSend(stop)
  alt start still pending
    Main->>Main: set stopAfterPendingStart
    Main-->>Bridge: skip physical stop event
  else session is not listening
    Main-->>Bridge: skip stop
  else session is listening
    Bridge->>Page: send rawKeyDown Ctrl+Shift+D
    Bridge->>Main: afterSend(stop)
    Main->>Session: markStopShortcutSent()
    Main->>Recorder: stop app recorder if enabled
    Main->>Overlay: processing
  end
```

After stop, the app waits for ChatGPT to send a transcribe request. The timeout is:

```text
transcribeRequestTimeoutMs = 15000 + listeningDurationMs
```

This timeout only checks whether a request appears. Once the request appears, the app waits for response / DOM / cancel / failure rather than using a fixed response timeout.

## 9. Transcribe Request And Result Flow

```mermaid
sequenceDiagram
  participant Page as ChatGPT Page
  participant Fetch as CDP Fetch
  participant Monitor as CDP Network Monitor
  participant Main
  participant Session
  participant Preload as DOM Preload
  participant Pipeline
  participant Clipboard
  participant Overlay

  opt upload replacement enabled
    Page->>Fetch: POST /backend-api/transcribe paused
    Fetch->>Monitor: Fetch.requestPaused
    Monitor->>Main: get app recording
    alt app recording usable
      Monitor->>Fetch: continueRequest with replaced multipart postData
    else unavailable
      Monitor->>Fetch: continueRequest original request
    end
  end

  Page->>Monitor: Network.requestWillBeSent
  Monitor->>Main: onStarted(requestId)
  Main->>Session: markTranscribeRequestStarted(requestId)
  Page->>Monitor: Network.responseReceived / loadingFinished
  Monitor->>Monitor: Network.getResponseBody
  Monitor->>Main: onSucceeded(text)
  Main->>Main: write DOM and recorder probe snapshots
  Main->>Main: schedule 5000ms network fallback

  alt DOM transcript arrives first
    Preload->>Main: general-stt:transcript
    Main->>Pipeline: handleTranscript(payload)
  else no DOM result
    Main->>Pipeline: finalizeText(networkText, force=true)
  end

  Pipeline->>Clipboard: writeText
  Pipeline->>Pipeline: save last-transcript.json
  Pipeline->>Overlay: success
```

Important distinction:

- `transcribe.succeeded`: Network monitor fetched and parsed ChatGPT transcribe response.
- `transcript.finalized`: local pipeline wrote clipboard/storage and optionally pasted into the previous foreground app.

These are not the same stage.

## 10. Upload Replacement

Current config enables:

```json
{
  "transcribe": {
    "replaceUploadWithAppRecording": true,
    "uploadReplacementWaitMs": 5000
  }
}
```

The intended replacement chain is:

```mermaid
flowchart TD
  A[start beforeSend] --> B[start app MediaRecorder]
  B --> C[collect local webm chunks]
  D[stop afterSend] --> E[stop app MediaRecorder]
  E --> F[base64 app recording]
  G[Fetch.requestPaused] --> H[get app recording]
  H --> I{recording available?}
  I -- no --> J[continue original request]
  I -- yes --> K[parse multipart request]
  K --> L{file part found?}
  L -- no --> J
  L -- yes --> M[replace only name=file bytes]
  M --> N[continueRequest with new postData]
```

Relevant files:

- [`../src/main/chatgptAppRecorder.js`](../src/main/chatgptAppRecorder.js)
- [`../src/main/chatgptUploadReplacement.js`](../src/main/chatgptUploadReplacement.js)
- [`../src/main/chatgptTranscribeMonitor.js`](../src/main/chatgptTranscribeMonitor.js)

Important caveat from the current investigation: `app-recording.webm` is a local artifact, but it is not a native OS recording. It is still produced by Chromium `MediaRecorder` inside the ChatGPT `WebContents`. If that WebContents is hidden, throttled, or otherwise not receiving continuous audio frames, the local app recording can also be short.

## 11. Logging And Artifacts

Normal app log:

```text
Dev:       .runtime/dandelion-electron/logs/app-YYYY-MM-DD.log
Packaged:  %APPDATA%\Dandelion\logs\app-YYYY-MM-DD.log
```

Remote debug artifact:

```text
Dev:       .runtime/dandelion-electron/remote-debug/transcribe/<timestamp>/<requestId>/
Packaged:  %APPDATA%\Dandelion\remote-debug\transcribe\<timestamp>\<requestId>\
```

Key remote files:

- `request-replacement-paused.json`: Fetch pause event.
- `request-replacement-decision.json`: whether replacement happened and why.
- `request-replacement-new-summary.json`: replacement bytes summary.
- `app-recording.webm`: app recorder output.
- `app-recording-summary.json`: app recorder bytes / duration / chunk count.
- `request-will-be-sent.json`: Network request metadata.
- `request-post-data.json`: Network post body as Chromium exposes it.
- `response-body.json`: remote transcript response body and parsed transcript text.
- `dom-snapshot-*.json`: DOM state after response or before fallback.
- `recorder-probe-*.json`: page-side recorder / FormData / fetch / XHR events.

## 12. How To Debug Missing Tail

When the final transcript is missing the second half, do not start from the final text. Start from the artifacts.

Recommended order:

1. Find latest `transcribe.started` in app log.
2. Open its `remoteDebugDir`.
3. Read `response-body.json`: did remote return full text?
4. Read `request-post-data.json`: how large was the uploaded `file` part?
5. Read `request-replacement-decision.json`: did replacement claim success?
6. Compare uploaded file bytes with `app-recording.webm`.
7. Use `ffprobe` / `ffmpeg` to check decodable duration.

Why `ffmpeg` can output a shorter local recording:

- The app recorder summary `durationMs` is wall-clock time from JS start to JS stop.
- The actual audio is the encoded packets inside `app-recording.webm`.
- `ffmpeg` does not invent missing audio. It decodes whatever packets exist in the WebM.
- If Chromium `MediaRecorder` was throttled, suspended, or did not receive continuous audio frames, the Blob can represent less audio than the wall-clock duration.
- In that case `ffmpeg` output being short is evidence that the local recording artifact itself is short or has gaps; it is not evidence that `ffmpeg` cut off valid audio.

Useful commands:

```bash
ffprobe -v error -show_entries format=duration,size,bit_rate \
  -of json /path/to/app-recording.webm
```

```bash
ffmpeg -hide_banner -nostdin -i /path/to/app-recording.webm \
  -f null - 2>&1 | tail -n 30
```

If `app_recorder.stopped.durationMs` is much larger than `ffmpeg` decoded time, the problem is at recording/capture level, before transcribe response parsing.

## 13. Common Tasks And Files

| Task | Start here |
| --- | --- |
| Change global hotkeys | [`../config/dandelion.json`](../config/dandelion.json), [`../src/main/appConfig.js`](../src/main/appConfig.js) |
| Change web shortcut simulation | [`../src/shortcut/chatgptShortcutBridge.js`](../src/shortcut/chatgptShortcutBridge.js) |
| Change start / stop session rules | [`../src/main/dictationSession.js`](../src/main/dictationSession.js), [`../src/main/main.js`](../src/main/main.js) |
| Change ChatGPT window behavior | [`../src/main/windowModes.js`](../src/main/windowModes.js), [`../src/main/shortcutWindowActivation.js`](../src/main/shortcutWindowActivation.js) |
| Change overlay UI | [`../src/renderer/miniOverlay.html`](../src/renderer/miniOverlay.html), [`../src/renderer/miniOverlay.css`](../src/renderer/miniOverlay.css), [`../src/renderer/miniOverlay.js`](../src/renderer/miniOverlay.js) |
| Change remote request monitoring | [`../src/main/chatgptTranscribeMonitor.js`](../src/main/chatgptTranscribeMonitor.js) |
| Change upload replacement | [`../src/main/chatgptUploadReplacement.js`](../src/main/chatgptUploadReplacement.js) |
| Change app recorder | [`../src/main/chatgptAppRecorder.js`](../src/main/chatgptAppRecorder.js) |
| Change transcript copy/paste | [`../src/main/transcriptPipeline.js`](../src/main/transcriptPipeline.js), [`../src/main/windowsPaste.js`](../src/main/windowsPaste.js) |
| Change logs | [`../src/main/appLogger.js`](../src/main/appLogger.js) |
| Change packaged output | [`../package.json`](../package.json), [`../.doc/modules/windows-packaging.md`](../.doc/modules/windows-packaging.md) |

## 14. Test And Packaging Commands

Use Node directly when `npm` is not available in the current shell:

```bash
node tests/run-tests.js
```

If the shell has nvm but did not load it:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
npm test
```

Pack Windows dir:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
npm run pack:win
```

Packaged executable:

```text
dist/win-unpacked/Dandelion.exe
```

## 15. First-Day Checklist

1. Read [`../README.md`](../README.md).
2. Run `node tests/run-tests.js`.
3. Open [`../src/main/main.js`](../src/main/main.js) and identify the boot, bridge, pipeline, and monitor registration sections.
4. Read [`../.doc/modules/electron-app-runtime.md`](../.doc/modules/electron-app-runtime.md).
5. Read [`./2026-06-06-general-stt-current-flow.md`](./2026-06-06-general-stt-current-flow.md).
6. For missing-tail issues, read [`./2026-06-06-latest-log-missing-tail-analysis.md`](./2026-06-06-latest-log-missing-tail-analysis.md).
