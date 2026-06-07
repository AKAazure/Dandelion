# 最新日志丢尾分析

## 对应日志

最新有效 session：

- app log：`C:\Users\BUTLER36HUS\AppData\Roaming\Dandelion\logs\app-2026-06-06.log`
- request id：`89004.647`
- remote debug dir：`C:\Users\BUTLER36HUS\AppData\Roaming\Dandelion\remote-debug\transcribe\2026-06-06T19-16-19-928Z\89004.647`

## 时间线

| 时间 UTC | 事件 | 关键字段 |
| --- | --- | --- |
| `19:15:27.863` | `dictation.start.before_send` | start |
| `19:15:28.311` | `app_recorder.started` | `audio/webm;codecs=opus` |
| `19:16:09.213` | `dictation.stop.sent_waiting_for_transcribe_request` | `listeningDurationMs=40648` |
| `19:16:19.939` | `transcribe.started` | request `89004.647` |
| `19:16:19.944` | `app_recorder.stopped` | `byteLength=454613`, `durationMs=42317` |
| `19:16:21.798` | `transcribe.succeeded` | `textLength=87` |
| `19:16:26.822` | `transcript.finalized` | `textLength=87` |

## 关键 artifact 结果

### Replacement decision

`request-replacement-decision.json` 显示 replacement 逻辑走到了成功分支：

```json
{
  "enabled": true,
  "reason": "app_recording_available",
  "replaced": true,
  "summary": {
    "originalFileBytes": 176283,
    "replacementFileBytes": 454613,
    "replacementDeltaBytes": 278330
  }
}
```

### Network postData

但把 `request-post-data.json` 里的 multipart `name="file"` 解析出来后，Network 层看到的 file 是：

```json
{
  "parsedFileBytes": 442724,
  "appRecordingBytes": 454613,
  "sameAsApp": false
}
```

这个 `442724` bytes 和 recorder probe 里的 ChatGPT 页面 recorder-2 完全一致：

```json
{
  "recorder-2": {
    "dataAvailableCount": 1,
    "totalDataAvailableBytes": 442724
  }
}
```

所以目前不能证明 remote 实际收到了 app recording。Network artifact 看到的仍是 ChatGPT 页面自己的 upload file。

### 可解码音频长度

用 `ffprobe` / `ffmpeg` 检查：

| 文件 | bytes | 可解码时长 |
| --- | ---: | ---: |
| Network multipart file | `442724` | `27.42s` |
| `app-recording.webm` | `454613` | `28.2s` |

虽然 app recorder summary 里的 wall-clock `durationMs=42317`，但实际可解码音频只有约 `28.2s`。这说明丢尾发生在录音文件层面，不是 response 解析、DOM fallback 或本地 finalize 裁掉了后半段。

## 结论

这次缺失不是 finalize 截断，也不是 response 解析截断。

更具体地说：

1. app 本轮听写时长约 `40.6s`。
2. ChatGPT remote 返回只有 `87` 字符，response body 本身就是这段短文本。
3. Network 上传 file 可解码时长只有 `27.42s`。
4. app recorder 也只可解码约 `28.2s`，说明当前 app recorder 放在 ChatGPT 隐藏 WebContents 里仍然会一起受影响。

最可能原因是 ChatGPT 主窗口在 `mini` / hidden 模式下被隐藏，Chromium 对后台 WebContents 进行了 throttling，导致 `MediaRecorder` 长录音实际缺音频。

## 已做修复

在 [`../src/main/windowModes.js`](../src/main/windowModes.js) 的 ChatGPT 主窗口 `webPreferences` 里加入：

```js
backgroundThrottling: false
```

对应测试已加到 [`../tests/windowModes.test.js`](../tests/windowModes.test.js)。

下一次验证重点看：

- `app_recorder.stopped.durationMs`
- `ffmpeg` 可解码时长是否接近 listening duration
- `request-post-data.json` 解析出的 multipart file 可解码时长是否接近 listening duration
- `response-body.json` 的 transcript 是否仍只有前半段
