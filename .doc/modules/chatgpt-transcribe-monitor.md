# ChatGPT Transcribe Monitor

## 目标

ChatGPT transcribe monitor 用 Electron `webContents.debugger` 接入 Chrome DevTools Protocol Network domain，监听 ChatGPT 页面实际发出的 transcribe request。它的职责是：

- 发现 `/backend-api/transcribe` 或 `/transcribe` 这类非 GET request。
- 在 2xx response 完成后读取 response body。
- 从 body 中提取 `text`、`transcript` 或 `transcription` 字段。
- 把 request/response 的 raw CDP 细节写入 remote debug artifact。
- 把 network transcript 交给 main process 作为延迟兜底候选。

这样 stop 后的 “处理中” 状态不只依赖 DOM 观察器。DOM selector 漏掉更新、文本已经提前进入输入框、或页面重载后仍然可以用 network response 兜底完成本轮听写。main process 会先给 DOM 稳定窗口机会，避免 network response 先返回截断文本时过早保存。

相关文件：

- [`../../src/main/chatgptTranscribeMonitor.js`](../../src/main/chatgptTranscribeMonitor.js)
- [`../../src/main/main.js`](../../src/main/main.js)
- [`../../src/main/transcriptPipeline.js`](../../src/main/transcriptPipeline.js)

## Public API

### `createChatGptTranscribeMonitor(options)`

创建 monitor controller。

参数：

- `webContents`：ChatGPT `BrowserWindow.webContents`。
- `onStarted(payload)`：发现 transcribe request 时触发。
- `onSucceeded(payload)`：2xx response 完成并读取 body 后触发，`payload.text` 是解析出的 transcript。
- `onFailed(payload)`：request 失败或返回非 2xx 时触发。
- `logger`：可选 logger。
- `remoteDebugLogDir`：可选 raw remote artifact 根目录；启用后不做 redaction。

返回：

- `start()`：attach CDP debugger，启用 Network domain，并开始监听。
- `stop()`：移除监听器并清空 pending request。
- `isStarted()`：返回当前监听状态。

### `isLikelyTranscribeRequest(url, method)`

判断 request 是否是非 GET 的 ChatGPT transcribe request。

### `extractTranscriptTextFromResponseBody(body, base64Encoded)`

处理 CDP 返回的 response body，支持 base64 解码和 JSON 解析。

### `recursiveFindTranscriptText(value)`

从未知 JSON 结构中递归查找 `text`、`transcript`、`transcription` 字段。

## Flowchart

```mermaid
flowchart TD
  A[start monitor] --> B[attach webContents.debugger]
  B --> C[Network.enable]
  C --> D[Network.requestWillBeSent]
  D --> E{non GET transcribe URL?}
  E -- no --> D
  E -- yes --> F[store pending request and call onStarted]
  F --> F2[write request-will-be-sent and request-post-data artifacts]
  F --> G[Network.responseReceived]
  G --> H[record status code and write response-received artifact]
  H --> I[Network.loadingFinished or loadingFailed]
  I --> J{failed or non 2xx?}
  J -- yes --> K[write failure artifact and call onFailed]
  J -- no --> L[Network.getResponseBody]
  L --> M[write response-body artifact and extract transcript text]
  M --> N[call onSucceeded]
```

## Remote Debug Artifacts

Packaged app 默认把 raw remote 细节写到：

```text
%APPDATA%\Dandelion\remote-debug\transcribe\<timestamp>\<requestId>\
```

开发模式对应：

```text
.runtime/dandelion-electron/remote-debug/transcribe/<timestamp>/<requestId>/
```

每条 transcribe request 会尽量保存这些文件：

- `request-will-be-sent.json`：完整 `Network.requestWillBeSent` params，包括 CDP 暴露的 request headers、URL、method、postData 等。
- `request-post-data.json`：`Network.getRequestPostData` 返回值；如果 CDP 拿不到，会写 `request-post-data-unavailable.json`。
- `response-received.json`：完整 `Network.responseReceived` params，包括 response headers、status、mimeType 等。
- `loading-finished.json` / `loading-failed.json`：加载完成或失败事件。
- `response-body.json`：`Network.getResponseBody` 原始返回值，包括 `body`、`base64Encoded`，以及 monitor 解析出的 `transcript.text` 和 `textLength`。
- `response-body-read-failed.json`：读取 response body 失败时的错误对象。

这些 artifact 是为了排查 remote 行为，默认保留原始 header、body、postData 和 transcript 文本，不走 `appLogger` 的敏感字段 redaction。普通 app JSONL 只记录 `remoteDebugDir`、`textLength`、status 等摘要，方便跳到对应目录。

## Time Sequence

```mermaid
sequenceDiagram
  participant Page as ChatGPT Page
  participant CDP as CDP Network
  participant Monitor
  participant Main
  participant Pipeline
  participant Overlay

  Page->>CDP: POST /backend-api/transcribe
  CDP->>Monitor: requestWillBeSent
  Monitor->>Monitor: write request-will-be-sent.json
  Monitor->>CDP: Network.getRequestPostData
  CDP-->>Monitor: request post data or error
  Monitor->>Monitor: write request-post-data artifact
  Monitor->>Main: onStarted()
  Main->>Session: clear request timeout and wait for response
  CDP->>Monitor: responseReceived 200
  Monitor->>Monitor: write response-received.json
  CDP->>Monitor: loadingFinished
  Monitor->>Monitor: write loading-finished.json
  Monitor->>CDP: Network.getResponseBody
  CDP-->>Monitor: response body
  Monitor->>Monitor: write response-body.json
  Monitor->>Monitor: extract transcript text
  Monitor->>Main: onSucceeded({ text })
  Main->>Main: schedule network fallback
  alt DOM transcript arrives
    Main->>Pipeline: handleTranscript(payload)
  else DOM does not arrive
    Main->>Pipeline: finalizeText(text, { force: true })
  end
  Pipeline->>Overlay: success
```

## 边界

- `webContents.debugger` 同一时间可能被 DevTools 或其他 debugger 占用；attach 失败时 app 会记录 warning，并退回 DOM transcript pipeline。
- `session.webRequest` 只能稳定拿到请求和 status，不能直接读取 response body，所以这里使用 CDP Network。
- response body shape 属于 ChatGPT 网页内部实现，仍可能变化；monitor 已使用宽松字段递归，但无法保证永久兼容。
- 取消听写后 main process 会关闭本轮 transcript 接收；即使 transcribe response 后续返回，也不会复制、粘贴或保存。

## 测试覆盖

测试文件：

- [`../../tests/chatgptTranscribeMonitor.test.js`](../../tests/chatgptTranscribeMonitor.test.js)

覆盖内容：

- transcribe request 匹配。
- JSON 和 base64 response body 文本提取。
- 避免把 `status` 这类普通字符串字段误识别为 transcript。
- CDP request/response/loadingFinished 成功路径。
- 非 2xx response 的失败路径。
