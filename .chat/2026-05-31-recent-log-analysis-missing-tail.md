# 近期运行日志分析：为什么会感觉“最终结果少了后面一段”

## 结论

- 现有日志看不出本地 finalize / paste 阶段把已经拿到的 transcript 再裁掉。所有正常完成样本里，`transcribe.succeeded.textLength` 和 `transcript.finalized.textLength` 完全一致，间隔只有 `14ms` 到 `25ms`。
- 但 `2026-05-31` 出现了两次更关键的问题：长录音时，`transcribe request` 实际发出时间晚于当前 `request-start timeout`。其中一次还引发了明显的 session 串线：上一轮超时后的迟到 response，在你重新开始下一轮之后，被当成“当前结果” finalize 了。
- 所以“少了后面一段”的更可能来源不是“本地 finalize 把尾巴切掉”，而是：
  1. 长录音时 timeout 过早。
  2. timeout 之后你又开始了下一轮，导致上一轮迟到结果串进下一轮。
  3. 由于日志默认不记 transcript 原文，我不能证明 ChatGPT 返回的文本本身有没有上游截断；但我可以确认 session 归属已经乱了。

## 样本范围

- 仓库内旧 runtime：
  - [`../.runtime/general-stt-electron/logs/app-2026-05-16.log`](../.runtime/general-stt-electron/logs/app-2026-05-16.log)
  - [`../.runtime/general-stt-electron/logs/app-2026-05-17.log`](../.runtime/general-stt-electron/logs/app-2026-05-17.log)
- packaged app 最新 runtime：
  - [`app-2026-05-24.log`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/logs/app-2026-05-24.log)
  - [`app-2026-05-25.log`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/logs/app-2026-05-25.log)
  - [`app-2026-05-26.log`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/logs/app-2026-05-26.log)
  - [`app-2026-05-27.log`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/logs/app-2026-05-27.log)
  - [`app-2026-05-28.log`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/logs/app-2026-05-28.log)
  - [`app-2026-05-29.log`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/logs/app-2026-05-29.log)
  - [`app-2026-05-30.log`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/logs/app-2026-05-30.log)
  - [`app-2026-05-31.log`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/logs/app-2026-05-31.log)
  - [`last-transcript.json`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/last-transcript.json)

说明：

- 日志文件名按本地日期滚动，但 `ts` 字段是 UTC，所以 `app-2026-05-30.log` 里出现 `2026-05-31T05:...Z` 是正常的。

## 正常完成样本的共同特征

`2026-05-24` 到 `2026-05-30` 的大部分 session 都是这条链：

`dictation.stop.before_send -> transcribe.started -> transcribe.succeeded -> transcript.finalized`

而且正常样本里有两个稳定特征：

1. `transcribe.succeeded.textLength == transcript.finalized.textLength`
2. `transcribe.succeeded` 到 `transcript.finalized` 的间隔非常小，只有 `14ms` 到 `25ms`

代表性样本：

- `app-2026-05-24.log`
  - listening `85.7s`
  - `stop -> request` `1.165s`
  - `request -> success` `38.031s`
  - `success -> finalized` `19ms`
  - `textLength=282`
- `app-2026-05-30.log`
  - listening `97.6s`
  - `stop -> request` `19.147s`
  - `request -> success` `4.072s`
  - `success -> finalized` `14ms`
  - `textLength=314`

这说明一件事：只要 request 已经被观察到，本地 pipeline 并没有表现出“把成功结果再裁半截”的模式。

## 异常 1：`2026-05-31T05:01Z` 这一轮发生了 timeout 后串线

关键证据在 [`app-2026-05-30.log`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/logs/app-2026-05-30.log:32) 到 [`app-2026-05-30.log`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/logs/app-2026-05-30.log:52)：

1. `05:01:29.438Z` 开始听写，见第 `32` 行。
2. `05:04:10.210Z` 结束听写，见第 `37` 行。
3. `05:04:10.457Z` app 计算本轮 `listeningDurationMs=160766`，对应 `timeoutMs=43717`，见第 `38` 行。
4. `05:04:54.177Z` timeout 触发，overlay 进入 error，见第 `40` 到 `41` 行。
5. 但 `05:05:03.975Z` 才真正看到 `transcribe.started`，见第 `44` 行。
   - 也就是 request 比 timeout 晚了大约 `9.8s`。
6. `05:05:10.202Z` 你又开始了新一轮听写，见第 `45` 行。
7. `05:05:10.299Z` 收到 `transcribe.succeeded(textLength=258)`，接着 `05:05:10.313Z` finalize，见第 `49` 到 `51` 行。

这里最关键的一点是：

- `05:05:10.299Z` 这条 success **不可能属于** `05:05:10.202Z` 刚开始的新 session。
- 因为新 session 还没有 `stop`，更不可能已经发出 transcribe request。
- 所以这条 `258` 字结果，只能属于上一轮 `05:01:29Z -> 05:04:10Z` 的那次长录音。

也就是说，上一轮虽然已经 timeout 并报错，但迟到 response 仍然在下一轮刚开始时被接收、finalize、并贴到当前上下文里了。

这就是非常明确的 session 串线。

## 异常 2：`2026-05-31T08:41Z` 又复现了“request 晚于 timeout”

关键证据在 [`app-2026-05-31.log`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/logs/app-2026-05-31.log:5) 到 [`app-2026-05-31.log`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/logs/app-2026-05-31.log:17)：

1. `08:41:48.015Z` 开始听写，见第 `5` 行。
2. `08:43:41.161Z` 结束听写，见第 `10` 行。
3. `08:43:41.401Z` 本轮 `listeningDurationMs=113122`，对应 `timeoutMs=29218`，见第 `11` 行。
4. `08:44:10.624Z` timeout 触发，见第 `13` 行。
5. 但 `08:44:19.767Z` 才真正看到 `transcribe.started`，见第 `17` 行。
   - 也就是 request 比 timeout 晚了大约 `9.1s`。

这次日志在 `transcribe.started` 后就结束了，所以我不能确认它最后有没有成功，也不能确认是否又串到了下一轮。但“request 到得比 timeout 晚”这个模式已经复现了第二次。

## 为什么我判断不是 finalize 阶段把文本砍掉

代码路径很直接：

- network response body 由 [`../src/main/chatgptTranscribeMonitor.js`](../src/main/chatgptTranscribeMonitor.js) 读取，`requestId` 和 `text` 都会带到 `onSucceeded`，见 `232-241` 行。
- [`../src/main/main.js`](../src/main/main.js) 的 `onSucceeded` 里，拿到 `payload.text` 后直接调用 `transcriptPipeline.finalizeText(payload.text, { force: true })`，见 `881-907` 行。
- [`../src/main/transcriptPipeline.js`](../src/main/transcriptPipeline.js) 的 `finalizeText()` 只做了 `trim()`、写剪贴板、写 `last-transcript.json`、执行 paste，没有任何 slice / chunk / truncate 逻辑，见 `127-152` 行。

所以：

- 如果最终结果少字，现有证据不支持“finalize 阶段二次裁切”这个方向。
- 更可疑的是“ChatGPT response 来得太晚 + 本地把迟到结果错归到新 session”。

## 更具体的代码风险点

当前实现里，`onSucceeded` 只检查 `transcriptResultEnabled`，并没有核对这条 success 属于哪个 session / 哪个 request：

- [`../src/main/main.js`](../src/main/main.js) `881-907` 行

而 `requestId` 明明在 monitor 层是有的：

- [`../src/main/chatgptTranscribeMonitor.js`](../src/main/chatgptTranscribeMonitor.js) `232-241` 行

同时，stop 后的 timeout 是按听写时长算出来的 request-start timeout：

- [`../src/main/dictationSession.js`](../src/main/dictationSession.js) `47-75` 行
- [`../src/main/dictationSession.js`](../src/main/dictationSession.js) `312-365` 行
- [`../README.md`](../README.md) `65` 行

也就是说，当前代码组合出来的风险是：

1. 长录音超时过早。
2. 旧 session timeout 后，迟到 request 仍可能回来。
3. 只要此时新 session 已经把 `transcriptResultEnabled` 重新拉成 `true`，旧 response 就可能被当成新 session 的结果 finalize。

## `last-transcript.json` 说明了什么

[`last-transcript.json`](/mnt/c/Users/BUTLER36HUS/AppData/Roaming/Dandelion/last-transcript.json) 当前内容见第 `2-3` 行：

- `timestamp = 1780203910300`
- 对应 UTC 时间 `2026-05-31T05:05:10.300Z`
- `length = 258`

这正好和上面那条迟到 success 的时间完全对上。

而且文本确实停在：

`...在check history里头,`

肉眼上像半句没说完。

但这里我只能下到这一步：

- 我可以确认这 `258` 字结果是 timeout 之后迟到回来的那条。
- 我不能仅凭当前日志确认 ChatGPT 返回给 app 的 `258` 字文本本身是不是已经被上游截断。

## 我的判断

如果只回答“是不是本地结果阶段把后面一段切掉了”，结论是：

- **没有直接证据支持这个说法。**

如果回答“最近为什么会感觉结果有时不完整”，我认为更像是：

- **长录音时 request-start timeout 偏短，导致本地过早进入 error。**
- **timeout 后若马上开始新一轮，上一轮迟到 response 会串进新一轮。**
- **这会让你主观上感觉‘这次结果不对 / 少了后面一段 / 对不上刚才说的内容’。**

## 建议的下一步

如果下一步要修，我建议按模块拆开，一次只做一个：

1. 先修 session 归属问题。
   - 给每轮 dictation 分配 session token。
   - `transcribe.started` / `transcribe.succeeded` 必须和当前 session token 或已观察到的 `requestId` 对上，迟到旧 response 直接丢弃。
2. 再调长录音 timeout。
   - 当前公式对 `113s` 和 `161s` 这两轮都短了大约 `9s` 到 `10s`。
   - 可以先把 heuristic 放宽，或给 timeout 后的 late request 一个 grace window。
3. 最后补诊断面。
   - debug 模式下额外记录 `sessionId`、`requestId`、`late_response_after_timeout=true/false`。
   - 是否记录原文要谨慎，默认日志现在是刻意不落 transcript 原文的。

如果你要我继续，我建议先做第 `1` 个模块：修“旧 response 串进新 session”。
