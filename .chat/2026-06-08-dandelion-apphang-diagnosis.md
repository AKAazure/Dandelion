# Dandelion AppHang Diagnosis

用户反馈“崩溃了”后，本次检查从 packaged app 的实际 runtime artifact 开始。

## 结论

这次不是普通 JavaScript exception，也不是 transcribe request 失败。Windows 记录的是：

```text
EventType=AppHangB1
FriendlyEventName=Stopped responding and was closed
Application=Dandelion.exe
ReportIdentifier=a199eed1-40a8-4794-958c-fe144c0d741d
```

也就是说，进程进入了无响应状态，然后被 Windows 关闭。

## 关键证据

app log：

```text
C:\Users\BUTLER36HUS\AppData\Roaming\Dandelion\logs\app-2026-06-08.log
```

最后一次听写流程是成功的：

- `dictation.start.before_send`
- `dictation.start.confirmed`
- `dictation.stop.before_send`
- `transcribe.started`
- `transcribe.succeeded`，HTTP 200，`textLength=328`
- `transcript.pipeline.finalized`
- `transcript.finalized`，`pasted=true`
- `mini_overlay.state.changed` 到 `success`

最后一条 app log 是：

```json
{"ts":"2026-06-09T06:03:15.488Z","level":"info","event":"mini_overlay.position.saved","details":{"height":180,"saved":true,"width":340,"x":1576,"y":-468}}
```

对应本地时间是 `2026-06-08 23:03:15 -0700`。

WER report：

```text
C:\ProgramData\Microsoft\Windows\WER\ReportArchive\AppHang_Dandelion.exe_a07c9f71c23e5339f899653b189622cca8ebff_45624ea6_a199eed1-40a8-4794-958c-fe144c0d741d\Report.wer
```

文件修改时间是 `2026-06-08 23:06:47 -0700`，比最后一条 app log 晚约 3 分 32 秒。

## 当前判断

这次 hang 发生在一次成功听写之后。transcribe / pipeline / paste 已经完成，所以根因不在 ChatGPT transcribe request 失败。

用户补充：当时是长语音转录成功后，过了一会准备重新说，按 `Alt+,` 后卡死。结合日志里没有第二次 `dictation.start.before_send`，更合理的判断是：hotkey 触发后卡在现有 start 日志之前，而不是卡在上一次 `mini_overlay.position.saved` 本身。

当前代码里，`dictation.start.before_send` 写日志之前会先做两件同步动作：

1. `captureForegroundWindow()`：用 PowerShell 同步读取当前前台 HWND。
2. `prepareWindowForShortcut()`：把 ChatGPT 窗口移到屏幕外、透明激活。

因此最可疑的是 `captureForegroundWindow()` 的同步 PowerShell 调用被系统层卡住，导致 Electron globalShortcut callback 没能继续跑，也没机会写 `dictation.start.before_send`。

## 已做修复

新增 runtime 诊断日志模块：

- [`../src/main/runtimeDiagnostics.js`](../src/main/runtimeDiagnostics.js)
- [`../tests/runtimeDiagnostics.test.js`](../tests/runtimeDiagnostics.test.js)
- [`../.doc/modules/runtime-diagnostics.md`](../.doc/modules/runtime-diagnostics.md)

main runtime 现在会记录：

- `runtime.window.unresponsive`
- `runtime.window.responsive`
- `runtime.renderer.gone`
- `runtime.web_contents.unresponsive`
- `runtime.web_contents.responsive`
- `runtime.child_process.gone`

下次如果再出现 Windows `AppHangB1`，app log 里应该能看出是 ChatGPT window、mini overlay、renderer process、GPU/utility child process，还是 Windows native 层直接 hang。

另外给 `captureForegroundWindow()` 加了默认 `750ms` 硬 timeout。即使 PowerShell 读取前台窗口卡住，本轮 start hotkey 也会继续发送；代价只是这一轮可能拿不到原前台 HWND，发送完快捷键后无法恢复焦点。

## 验证

使用 nvm 的 Node 跑完整测试：

```text
source ~/.nvm/nvm.sh && npm test
```

所有测试通过。

另外尝试过 Electron smoke：

```text
source ~/.nvm/nvm.sh && npm run smoke
```

这个命令在当前 WSL shell 里没有跑起来，原因是 `node_modules/electron/dist` 当前是 Windows `electron.exe`，`require('electron')` 在这里解析成 package 字符串而不是 Electron main process built-in，所以 `app.setPath()` 处拿到的 `app` 是 `undefined`。这属于本地 smoke 运行环境问题，不是本次 runtime diagnostics 改动引入的逻辑失败。

随后改用 Windows 侧 npm 重新跑：

```text
cd /d F:\Project\general-stt && npm run pack:win
```

这次 `pack:win` 成功，`dist\win-unpacked\Dandelion.exe` 和 `dist\win-unpacked\resources\app.asar` 都已更新。尝试从当前 WSL shell 启动 GUI 版 exe 时，Windows 返回“拒绝访问”，没有产生新 app log；因此这次只确认到 Windows pack 成功，未能在该 shell 里完成 packaged GUI smoke。
