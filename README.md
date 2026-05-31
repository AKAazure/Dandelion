# Dandelion

Windows STT helper prototype。

## 运行

安装依赖：

```bash
npm install
```

验证 Electron 主入口能启动：

```bash
npm run smoke
```

第一次登录 ChatGPT 或授权麦克风：

```bash
npm run start:login
```

麦克风权限弹窗会提供：

- `始终允许`：保存到 `.runtime/dandelion-electron/permissions.json`，后续不再重复弹窗。
- `仅本次允许`：本次放行，下次 ChatGPT 再请求时仍会询问。
- `拒绝`：本次拒绝。

如果要重置麦克风授权，关闭 app 后删除 `.runtime/dandelion-electron/permissions.json`。

后续默认最小化声波模式启动：

```bash
npm start
```

当前 [`config/dandelion.json`](config/dandelion.json) 里的全局快捷键：

- 开始听写：`Alt+,`
- 结束听写：`Alt+.`
- 取消听写：`Escape`，只在听写中或处理中临时生效

开始和结束 binding 默认都会在内嵌 ChatGPT 页面里触发 `Ctrl+Shift+D`。ChatGPT 当前网页听写行为更接近 toggle；如果以后确认网页有单独停止或发送快捷键，可以只改停止目标 chord。登录态保存在 `.runtime/dandelion-electron`。

快捷键由 Electron `globalShortcut` 注册，可以在其他窗口 focus 时触发。默认 `mini` 模式下，屏幕右下角会显示一个 always-on-top、不可 focus 的声波 overlay；这个 overlay 可以拖动到任意屏幕，位置会保存到本地。内嵌 ChatGPT 主窗口保持隐藏。触发快捷键时，app 会把 ChatGPT 主窗口临时移到屏幕外并设成透明，等窗口激活和输入框清空完成后再发送网页快捷键，发送完成后恢复隐藏；正常听写不会把 ChatGPT 窗口闪到屏幕上。

点击右下角声波 overlay，或通过 tray 选择“显示登录/授权窗口”，会最大化到正常 ChatGPT 窗口。关闭 ChatGPT 窗口会回到 `mini` 模式。

声波 overlay 只有在 `mini` 模式可见且状态为 `listening` 时才读取本地麦克风电平；待机、处理中、成功、失败状态都不会读取本地 mic，也不会显示声波。ChatGPT 自己的录音仍然由网页控制。

开始听写时 app 会先清空当前 ChatGPT 输入栏，然后触发网页端听写快捷键；提示音和 overlay 的 listening 状态会在快捷键实际发送后触发。之后 app 会等待 ChatGPT 页面发起 `media` 权限请求，把它作为“网页端确实尝试开始听写”的确认信号。如果短时间内没有看到这个信号，会自动重试一次开始快捷键，并写入 `dictation.start.unconfirmed_retry` 日志。

听写中或处理中按 `Escape` 会取消本轮听写：app 会把 `Escape` 发送给 ChatGPT 页面，清空当前输入栏，丢弃本轮候选文本和后续返回的 transcribe response，不复制、不粘贴、不保存。`Escape` 平时不会作为全局快捷键注册，避免影响游戏或其他应用。

听写完成确认优先监听 ChatGPT 页面实际发出的 transcribe request。app 会通过 Electron CDP Network 读取 response body，解析到最终文本后立即复制、保存和粘贴；如果 network monitor 不可用，仍会 fallback 到 DOM 观察器。DOM 路径不会在页面一变化就复制，而是默认等待文本稳定 `2500ms` 后才当成完成结果处理。日志里 `transcribe.succeeded` 表示 network monitor 已经拿到 ChatGPT 的 transcribe response 并解析出文本；`transcript.finalized` 表示这段文本已经经过本地 pipeline，写入剪贴板、保存到 `last-transcript.json`，并在开启自动粘贴时发出粘贴。完成后 app 会：

- 自动复制到剪贴板。
- 保存到 `.runtime/dandelion-electron/last-transcript.json`。
- 右下角 overlay 显示 `√` 和最终文本，文本可选择，也可以点“复制”。
- 启动时把上次完成结果恢复到剪贴板。
- 托盘菜单支持“复制上次听写到剪贴板”。

结束听写只会在 app 已经处于 `listening` session 时发送；如果当前不是 listening，stop 会被跳过，避免同一个 `Ctrl+Shift+D` toggle 反向启动网页听写。结束听写后 overlay 会进入“处理中”。app 会按本轮听写时长线性等待 ChatGPT 发出 transcribe request：默认 `15s + listeningDuration`。所以 `30s` 听写会等待 `45s`，`61s` 听写会等待约 `76.0s`，`86s` 听写会等待约 `100.6s`，`113s` 听写会等待约 `128.1s`。一旦已经看到 request，app 不再用固定时间限制 response，而是继续等待 network response、DOM fallback、用户取消或明确失败。

另外，network `transcribe.succeeded` 现在只有在“当前 session 已经 stop，且这条 response 的 `requestId` 和本轮观察到的 transcribe request 一致”时才会 finalize；DOM fallback 也只会在 stop 之后的 `processing / waiting_response` 阶段生效，避免 timeout 后的迟到旧结果串进新一轮听写。

app 会默认写本地日志到 `.runtime/dandelion-electron/logs/app-YYYY-MM-DD.log`。日志用于排查快捷键、窗口、权限、transcribe request、overlay、提示音和 pipeline 状态；默认级别是 `info`，不会记录常规 permission 细节。需要深挖时可以把 `logging.level` 改成 `debug`。日志默认不记录 transcript 原文，只记录文本长度，默认保留 7 天，托盘菜单里可以直接打开日志目录。

## 配置

默认配置文件是 [`config/dandelion.json`](config/dandelion.json)。通常直接改这个文件即可：

```json
{
  "bindings": {
    "start": "F1",
    "stop": "F2",
    "cancel": "Escape"
  },
  "targetChords": {
    "start": "Ctrl+Shift+D",
    "stop": "Ctrl+Shift+D",
    "cancel": "Escape"
  },
  "logging": {
    "enabled": true,
    "level": "info",
    "retentionDays": 7
  },
  "autoPasteTranscript": true,
  "transcriptStableMs": 2500,
  "startMode": "mini"
}
```

也可以启动时指定另一个配置文件：

```powershell
npm start -- --config=F:\Project\general-stt\config\my-config.json
```

binding 支持 `F1`、`F2`、`Ctrl+F1`、`Alt+Shift+R` 这类 Electron accelerator。`Fn` 一般不能配置，因为它通常由键盘固件处理，不会作为普通按键事件到达 Windows；如果你的键盘需要按 `Fn+F1` 才发送 `F1`，配置里写 `F1`。

逗号和句号键建议这样写：

```json
{
  "bindings": {
    "start": "Alt+,",
    "stop": "Alt+.",
    "cancel": "Escape"
  }
}
```

也可以写成 `Alt+Comma` / `Alt+Period`，app 会自动转成 `Alt+,` / `Alt+.`。

环境变量仍然可用，并且优先级高于配置文件：

- `DANDELION_START_BINDING`：开始听写 binding。
- `DANDELION_STOP_BINDING`：结束听写 binding。
- `DANDELION_CANCEL_BINDING`：取消听写 binding，默认 `Escape`，只在听写活跃时注册。
- `DANDELION_START_TARGET_CHORD`：开始听写时发送到网页的 chord。
- `DANDELION_STOP_TARGET_CHORD`：结束听写时发送到网页的 chord。
- `DANDELION_CANCEL_TARGET_CHORD`：取消听写时发送到网页的 chord，默认 `Escape`。
- `DANDELION_LOG_ENABLED`：是否写本地日志，默认 `true`。
- `DANDELION_LOG_LEVEL`：日志级别，默认 `info`；支持 `debug`、`info`、`warn`、`error`。
- `DANDELION_LOG_RETENTION_DAYS`：日志保留天数，默认 `7`。
- `DANDELION_TRANSCRIPT_STABLE_MS`：文本稳定多久后视为听写完成，默认 `2500`。
- `DANDELION_AUTO_PASTE`：完成后是否自动粘贴，默认 `true`；设为 `false` 时只复制到剪贴板。

兼容说明：旧的 `GENERAL_STT_*` 环境变量仍可作为 fallback；新配置建议使用 `DANDELION_*`。`DANDELION_CUSTOM_BINDING` / `GENERAL_STT_CUSTOM_BINDING` 仍会作为开始听写 binding 的 fallback。

Windows PowerShell 临时配置示例：

```powershell
$env:DANDELION_START_BINDING="Ctrl+Alt+R"
$env:DANDELION_STOP_BINDING="Ctrl+Alt+S"
npm start
```

永久写入当前 Windows 用户环境变量：

```powershell
setx DANDELION_START_BINDING "Ctrl+Alt+R"
setx DANDELION_STOP_BINDING "Ctrl+Alt+S"
```

`setx` 之后需要重新打开 PowerShell 才会生效。

app icon 使用 [`assets/logo.png`](assets/logo.png)，包括窗口图标和 Windows 右下角 tray 图标。

## 快捷键桥接

当前快捷键模块用于把用户自定义的宿主 binding 映射成 ChatGPT 网页里的听写快捷键：

- 开始宿主 binding：当前配置 `Alt+,`
- 结束宿主 binding：当前配置 `Alt+.`
- 取消宿主 binding：当前配置 `Escape`，只在听写活跃时临时注册
- 网页目标组合键：开始/结束默认 `Ctrl+Shift+D`，取消默认 `Escape`
- 实现：[`src/shortcut/chatgptShortcutBridge.js`](src/shortcut/chatgptShortcutBridge.js)
- 设计说明：[`.doc/modules/chatgpt-shortcut-bridge.md`](.doc/modules/chatgpt-shortcut-bridge.md)
- app runtime 说明：[`.doc/modules/electron-app-runtime.md`](.doc/modules/electron-app-runtime.md)
- app logging 说明：[`.doc/modules/app-logging.md`](.doc/modules/app-logging.md)
- dictation session 说明：[`.doc/modules/dictation-session.md`](.doc/modules/dictation-session.md)
- mini overlay 说明：[`.doc/modules/mini-overlay.md`](.doc/modules/mini-overlay.md)
- ChatGPT transcribe monitor 说明：[`.doc/modules/chatgpt-transcribe-monitor.md`](.doc/modules/chatgpt-transcribe-monitor.md)
- transcript pipeline 说明：[`.doc/modules/transcript-pipeline.md`](.doc/modules/transcript-pipeline.md)

运行模块测试：

```bash
npm test
```

## Windows 打包

生成可直接运行的 Windows x64 目录：

```bash
npm run pack:win
```

产物路径：

```text
dist/win-unpacked/Dandelion.exe
```

打包后的默认配置文件会放在：

```text
dist/win-unpacked/resources/config/dandelion.json
```

打包后的登录态、权限、日志和最后一次 transcript 默认写入：

```text
%APPDATA%\Dandelion
```

如果需要单文件 portable exe，可以在 Windows 环境里运行：

```bash
npm run dist:win
```

打包说明：[`.doc/modules/windows-packaging.md`](.doc/modules/windows-packaging.md)
