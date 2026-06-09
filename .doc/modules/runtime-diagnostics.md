# Runtime Diagnostics

`runtimeDiagnostics` 给 Electron runtime 补充 hang / renderer gone / child process gone 日志。它不改变窗口生命周期，也不自动重启进程；它只把 Electron 自己能看到的异常边界写入现有 JSONL app log。

相关文件：

- [`../../src/main/runtimeDiagnostics.js`](../../src/main/runtimeDiagnostics.js)
- [`../../src/main/main.js`](../../src/main/main.js)
- [`../../tests/runtimeDiagnostics.test.js`](../../tests/runtimeDiagnostics.test.js)

## Public API

### `installAppRuntimeDiagnostics(options)`

给 Electron `app` 注册 `child-process-gone` listener。GPU、utility、renderer 等 native child process 异常退出时，写入：

```text
runtime.child_process.gone
```

Flowchart:

```mermaid
flowchart TD
  A[installAppRuntimeDiagnostics] --> B{app.on exists?}
  B -- no --> C[return false]
  B -- yes --> D[register child-process-gone]
  D --> E[return true]
  F[child-process-gone] --> G[normalize details]
  G --> H[logger.error runtime.child_process.gone]
```

Time sequence:

```mermaid
sequenceDiagram
  participant Main as main.js
  participant Diagnostics as runtimeDiagnostics
  participant App as Electron app
  participant Logger

  Main->>Diagnostics: installAppRuntimeDiagnostics({ app, logger })
  Diagnostics->>App: on(child-process-gone)
  App-->>Diagnostics: child-process-gone(details)
  Diagnostics->>Logger: error(runtime.child_process.gone, details)
```

### `installWindowRuntimeDiagnostics(options)`

给一个 `BrowserWindow` 和它的 `webContents` 注册窗口/renderer 诊断 listener。主 ChatGPT window 使用 label `chatgpt`，mini overlay 使用 label `mini-overlay`。

当前事件：

- `runtime.window.unresponsive`
- `runtime.window.responsive`
- `runtime.renderer.gone`
- `runtime.web_contents.unresponsive`
- `runtime.web_contents.responsive`

Flowchart:

```mermaid
flowchart TD
  A[installWindowRuntimeDiagnostics] --> B{browserWindow.on exists?}
  B -- no --> C[return false]
  B -- yes --> D[register window unresponsive/responsive]
  D --> E{webContents.on exists?}
  E -- no --> F[return true]
  E -- yes --> G[register renderer gone and webContents responsiveness]
  G --> F
```

Time sequence:

```mermaid
sequenceDiagram
  participant Main as main.js
  participant Diagnostics as runtimeDiagnostics
  participant Window as BrowserWindow
  participant Web as WebContents
  participant Logger

  Main->>Diagnostics: installWindowRuntimeDiagnostics({ browserWindow, label, logger })
  Diagnostics->>Window: on(unresponsive/responsive)
  Diagnostics->>Web: on(render-process-gone)
  Window-->>Diagnostics: unresponsive
  Diagnostics->>Logger: error(runtime.window.unresponsive, { label })
  Web-->>Diagnostics: render-process-gone(details)
  Diagnostics->>Logger: error(runtime.renderer.gone, { label, url, details })
```

## Debugging Use

当 Windows WER 只记录 `AppHangB1` 时，先对照 app log 最后一条业务事件，然后看 hang 前是否有这些 runtime events：

```text
%APPDATA%\Dandelion\logs\app-YYYY-MM-DD.log
C:\ProgramData\Microsoft\Windows\WER\ReportArchive\AppHang_Dandelion...\Report.wer
```

如果 app log 有 `runtime.window.unresponsive`，优先看对应 `label` 的窗口。若只有 WER report，没有 runtime event，问题可能发生在 native message loop、系统层等待、或 Windows 直接关闭进程之前 logger 没来得及 flush。
