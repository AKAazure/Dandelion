# Dandelion App 完成审计

## 目标

用户目标：实现完整功能，整个 app 可运行，让用户可以登录账号并测试。

## Prompt-to-artifact checklist

| 需求 | 证据 | 验证状态 |
|------|------|----------|
| Electron app 可启动 | [`../package.json`](../package.json) 提供 `start`、`start:login`、`smoke` scripts，入口是 [`../src/main/main.js`](../src/main/main.js) | `npm run smoke` 通过 |
| 用户可以登录 ChatGPT | `start:login` 使用 `electron . --start-mode=smart`，窗口会显示 [`https://chatgpt.com`](https://chatgpt.com) | `npx electron . --start-mode=smart --smoke-test --chatgpt-url=https://chatgpt.com` 成功加载到 `https://chatgpt.com/auth/login` |
| 登录态持久化 | [`../src/main/appConfig.js`](../src/main/appConfig.js) 默认 `sessionPartition=persist:chatgpt`，`userDataDir=.runtime/dandelion-electron` | smoke run 已创建 `.runtime/dandelion-electron`，该目录由 [`.gitignore`](../.gitignore) 忽略 |
| 自定义 binding 映射到 ChatGPT `Ctrl+Shift+D` | [`../src/shortcut/chatgptShortcutBridge.js`](../src/shortcut/chatgptShortcutBridge.js) 使用 Electron `globalShortcut` 和 `webContents.sendInputEvent` 发送 `Ctrl+Shift+D` | `npm test` 覆盖 keyDown/keyUp、注册、注销、失败路径 |
| 默认不抢走当前前台应用焦点 | shortcut bridge 默认 `focusBeforeSend=false` | `npm test` 覆盖默认不 focus 和按需 focus |
| 登录/授权时显示窗口 | [`../src/main/main.js`](../src/main/main.js) 对登录 URL、redirect 和 media permission request 切换 `smart` 模式 | `npm test` 覆盖 URL 判断和 permission handler |
| 麦克风权限由用户确认 | [`../src/main/permissions.js`](../src/main/permissions.js) 对可信 ChatGPT origin 的 `media` 请求弹出原生确认框，用户允许后才 `callback(true)` | `npm test` 覆盖允许和拒绝路径 |
| 窗口模式 | [`../src/main/windowModes.js`](../src/main/windowModes.js) 支持 `hidden`、`tiny`、`smart`、`corner` | `npm test` 覆盖 hidden/smart/tiny bounds |
| transcript 提取和粘贴 | [`../src/preload/chatgptPreload.js`](../src/preload/chatgptPreload.js) 观察 ChatGPT DOM；[`../src/main/transcriptPipeline.js`](../src/main/transcriptPipeline.js) 写剪贴板并调用 [`../src/main/windowsPaste.js`](../src/main/windowsPaste.js) | `npm test` 覆盖去重、clipboard write、paste 调用和 PowerShell 命令 |
| 文档 | [`../README.md`](../README.md)、[`../.doc/modules/electron-app-runtime.md`](../.doc/modules/electron-app-runtime.md)、[`../.doc/modules/chatgpt-shortcut-bridge.md`](../.doc/modules/chatgpt-shortcut-bridge.md)、[`../.doc/modules/transcript-pipeline.md`](../.doc/modules/transcript-pipeline.md) | 已包含运行命令、flowchart、time sequence 和模块说明 |
| 依赖安全状态 | `package-lock.json` 固定 Electron 依赖 | `npm audit --omit=optional` 返回 `found 0 vulnerabilities` |

## 已运行验证

```bash
npm install
npm test
npm audit --omit=optional
npm run smoke
npx electron . --start-mode=smart --smoke-test --chatgpt-url=https://chatgpt.com
```

关键输出：

- `npm test`：所有模块测试通过。
- `npm audit --omit=optional`：`found 0 vulnerabilities`。
- `npm run smoke`：`ChatGPT page loaded: about:blank`。
- ChatGPT 短启动验证：`ChatGPT page loaded: https://chatgpt.com/auth/login`。

## 未由我实际验证的部分

我不能使用用户的 ChatGPT 账号登录，也不能替用户完成麦克风授权。因此真实账号登录、真实语音听写和目标应用粘贴需要用户在 Windows 图形环境中运行下面命令验证：

```bash
npm run start:login
```

登录并授权麦克风后，再运行：

```bash
npm start
```

默认快捷键是 `Alt+Shift+R`，它会向内嵌 ChatGPT 页面发送 `Ctrl+Shift+D`。
