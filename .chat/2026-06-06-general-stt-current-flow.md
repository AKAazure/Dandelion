# General STT 当前整体流程

这份图按当前代码画，重点覆盖最近改过的 start pending / deferred stop，以及 transcribe request 到 transcript finalized 的路径。

主要代码入口：

- [`../src/main/main.js`](../src/main/main.js)
- [`../src/main/dictationSession.js`](../src/main/dictationSession.js)
- [`../src/main/chatgptTranscribeMonitor.js`](../src/main/chatgptTranscribeMonitor.js)
- [`../src/main/transcriptPipeline.js`](../src/main/transcriptPipeline.js)

## 1. 总览

```mermaid
flowchart TD
  A[app boot] --> B[load config and logger]
  B --> C[create ChatGPT BrowserWindow]
  C --> D[register transcript pipeline]
  D --> E[install transcribe network monitor]
  E --> F[create mini overlay and tray]
  F --> G[register start and stop global shortcuts]
  G --> H[wait for user shortcut]

  H --> I{shortcut action}
  I -->|start| J[start coordination]
  I -->|stop| K[stop coordination]
  I -->|cancel| L[cancel session and clear pending]

  J --> M{session idle and no start pending?}
  M -->|no| N[skip duplicate start]
  M -->|yes| O[prepare window and clear ChatGPT input]
  O --> P[send ChatGPT target chord]
  P --> Q[session: listening]
  Q --> R[wait for trusted media request]

  K --> S{start pending?}
  S -->|yes| T[defer stop until start is sent]
  S -->|no| U{session can stop?}
  U -->|no| V[skip stop]
  U -->|yes| W[send ChatGPT target chord]
  W --> X[session: processing]
  X --> Y[wait for transcribe request]

  T --> P
  Y --> Z{request observed before timeout?}
  Z -->|no| AA[overlay error and reset session]
  Z -->|yes| AB[session: waiting_response]
  AB --> AC[write remote debug artifacts]
  AC --> AD{network response}
  AD -->|success with matching requestId and text| AE[schedule network fallback]
  AD -->|failed with matching requestId| AF[overlay error and reset session]
  AD -->|no text or monitor unavailable| AG[DOM transcript may finalize]
  AE -->|DOM arrives first| AG
  AE -->|no DOM within 5000ms| AH[finalize network fallback]
  AG --> AH
  AH --> AI[clipboard, last-transcript.json, optional paste]
  AI --> AJ[overlay success and reset session]
```

## 2. 当前状态分层

这里有两层状态，不要混在一起看：

```mermaid
flowchart LR
  subgraph Main coordination
    A[startShortcutPending]
    B[stopAfterPendingStart]
  end

  subgraph Dictation session
    C[idle]
    D[listening]
    E[processing]
    F[waiting_response]
  end

  A -. guards .-> C
  B -. replays stop after start .-> D
  C -->|markStartShortcutSent| D
  D -->|markStopShortcutSent| E
  E -->|markTranscribeRequestStarted| F
  F -->|finalized, failed, cancel| C
```

`startShortcutPending` 不是 `dictationSession` 的 phase。它只表示 main process 已经进入 start `beforeSend`，但 ChatGPT shortcut 还没真正发出去。

`stopAfterPendingStart` 也不是 session phase。它表示 stop 在 start pending 期间到达，当前不会丢掉，会等 start `afterSend` 后自动触发一次 stop。

## 3. Start / Stop 时序

```mermaid
sequenceDiagram
  participant User
  participant Bridge as Shortcut Bridge
  participant Main
  participant Window as BrowserWindow
  participant Page as ChatGPT Page
  participant Session as Dictation Session
  participant Overlay

  User->>Bridge: press start binding
  Bridge->>Main: beforeSend(start)

  alt start pending or session not idle
    Main-->>Bridge: skip duplicate start
  else can start
    Main->>Main: startShortcutPending = true
    Main->>Window: prepare hidden or visible window
    Main->>Page: clear input
    opt clear input does not finish in 1000ms
      Main->>Main: log dictation.start.clear_input_timeout_continue
    end
    Bridge->>Page: send target chord
    Bridge->>Main: afterSend(start)
    Main->>Main: startShortcutPending = false
    Main->>Session: markStartShortcutSent()
    Main->>Overlay: listening
    Main->>Main: play sound
    Page->>Main: trusted media request
    Main->>Session: markTrustedMediaRequest()
  end

  User->>Bridge: press stop binding
  Bridge->>Main: beforeSend(stop)

  alt startShortcutPending is true
    Main->>Main: stopAfterPendingStart = true
    Main-->>Bridge: skip this physical stop event
    Main->>Bridge: trigger stop after start afterSend
  else session is not listening
    Main-->>Bridge: skip stop, log not_listening
  else session is listening
    Main->>Window: prepare hidden or visible window
    Bridge->>Page: send target chord
    Bridge->>Main: afterSend(stop)
    Main->>Session: markStopShortcutSent()
    Main->>Overlay: processing
  end
```

关键点：

- duplicate start 会跳过，避免重复发送 `Ctrl+Shift+D` 把 ChatGPT 的听写开关翻乱。
- start pending 时的 stop 不再丢弃，而是 deferred stop。
- stop 只有在 session 已经是 `listening` 时才会真正发给 ChatGPT。

## 4. Stop 后到结果完成

```mermaid
sequenceDiagram
  participant Page as ChatGPT Page
  participant Monitor as Transcribe Monitor
  participant Main
  participant Session as Dictation Session
  participant Pipeline as Transcript Pipeline
  participant Clipboard
  participant Disk as last-transcript.json
  participant Target as Foreground App
  participant Overlay

  Main->>Session: markStopShortcutSent()
  Session->>Session: listeningDurationMs = now - start time
  Session->>Session: timeoutMs = baseTimeout + listeningDurationMs
  Page->>Monitor: POST /backend-api/transcribe
  Monitor->>Main: onStarted(requestId)
  Monitor->>Monitor: write request-will-be-sent and request-post-data artifacts
  Main->>Session: markTranscribeRequestStarted(requestId)
  Session->>Session: phase = waiting_response

  alt network succeeds and requestId matches
    Monitor->>Monitor: write response-received/loading-finished/response-body artifacts
    Monitor->>Main: onSucceeded(text, requestId)
    Main->>Main: schedule network fallback for 5000ms
    alt DOM transcript arrives first
      Main->>Main: clear network fallback
      Main->>Pipeline: handleTranscript(payload)
      Pipeline->>Pipeline: wait stableMs
      Pipeline->>Clipboard: write transcript
      Pipeline->>Disk: save last transcript
      Pipeline->>Target: paste if autoPaste enabled
      Pipeline->>Main: onFinalized()
      Main->>Session: reset()
      Main->>Overlay: success with text
    else DOM transcript does not arrive
      Main->>Pipeline: finalizeText(networkText, force=true)
      Pipeline->>Clipboard: write transcript
      Pipeline->>Disk: save last transcript
      Pipeline->>Target: paste if autoPaste enabled
      Pipeline->>Main: onFinalized()
      Main->>Session: reset()
      Main->>Overlay: success with text
    end
  else network fails and requestId matches
    Monitor->>Main: onFailed(error, requestId)
    Main->>Session: reset()
    Main->>Overlay: error
  else requestId does not match current session
    Main->>Main: ignore old or unrelated result
  else network monitor has no text
    Main->>Main: keep waiting for DOM fallback or user action
  end
```

这里的 `transcribe.succeeded` 和 `transcript.finalized` 不是同一个阶段：

- `transcribe.succeeded`：network monitor 已经拿到并解析 ChatGPT transcribe response；它现在只会 schedule 一个 network fallback，不会马上落盘。
- `transcript.finalized`：本地 pipeline 已经写 clipboard、保存 `last-transcript.json`，并按配置粘贴到前台 app。

每条 remote request 的完整 CDP artifact 会写到 `remote-debug/transcribe/<timestamp>/<requestId>/`。普通日志里的 `remoteDebugDir` 指向这个目录。

## 5. Cancel 分支

```mermaid
sequenceDiagram
  participant User
  participant Bridge as Shortcut Bridge
  participant Main
  participant Page as ChatGPT Page
  participant Session
  participant Pipeline
  participant Overlay

  User->>Bridge: press cancel binding
  Bridge->>Main: beforeSend(cancel)
  Main->>Main: transcriptResultEnabled = false
  Main->>Main: resetShortcutCoordination()
  Main->>Session: cancel()
  Main->>Pipeline: discardPendingTranscript()
  Bridge->>Page: send Escape
  Bridge->>Main: afterSend(cancel)
  Main->>Page: clear input after short delay
  Main->>Overlay: idle
```

cancel 会清理 main coordination 状态，因此 pending start 或 deferred stop 都不会继续执行。

## 6. 读日志时按这个顺序看

正常一轮：

```text
dictation.start.before_send
dictation.start.sent_waiting_for_media_request
dictation.start.confirmed
dictation.stop.before_send
dictation.stop.sent_waiting_for_transcribe_request
transcribe.started
dictation.transcribe_request.observed
transcribe.succeeded
transcribe.network_fallback_scheduled
transcript.pipeline.finalized
transcript.finalized
mini_overlay.state.changed success
```

start pending 时 stop 早到：

```text
dictation.start.before_send
dictation.stop.deferred_until_start_sent
dictation.start.sent_waiting_for_media_request
dictation.stop.deferred_triggered
dictation.stop.before_send
dictation.stop.sent_waiting_for_transcribe_request
```

重复 start：

```text
dictation.start.skipped_active_session
```

清空输入栏卡住但继续开始：

```text
dictation.start.before_send
dictation.start.clear_input_timeout_continue
dictation.start.sent_waiting_for_media_request
```

stop 后没有看到 request：

```text
dictation.stop.sent_waiting_for_transcribe_request
dictation.transcribe_request.timeout
mini_overlay.state.changed error
```

## 7. 对应代码位置

- main coordination 状态：[`../src/main/main.js`](../src/main/main.js) 的 `startShortcutPending`、`stopAfterPendingStart`。
- start 清空输入兜底：[`../src/main/main.js`](../src/main/main.js) 的 `clearChatGptInputBeforeStart()`。
- deferred stop：[`../src/main/main.js`](../src/main/main.js) 的 `deferStopUntilStartShortcutSent()` 和 `triggerDeferredStopAfterStart()`。
- start / stop beforeSend 和 afterSend：[`../src/main/main.js`](../src/main/main.js) 的 `createDictationBridge()`。
- session phase 转换：[`../src/main/dictationSession.js`](../src/main/dictationSession.js) 的 `markStartShortcutSent()`、`markStopShortcutSent()`、`markTranscribeRequestStarted()`。
- network request 和 requestId matching：[`../src/main/main.js`](../src/main/main.js) 的 `installTranscribeMonitor()`。
- remote raw artifact：[`../src/main/chatgptTranscribeMonitor.js`](../src/main/chatgptTranscribeMonitor.js) 写入 `remote-debug/transcribe`。
- clipboard、保存和粘贴：[`../src/main/transcriptPipeline.js`](../src/main/transcriptPipeline.js)。
