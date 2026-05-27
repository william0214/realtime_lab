# 方案 A：混合 ASR 架構（gpt-realtime-whisper + gpt-4o-transcribe）

> 版本：v1.0 | 日期：2026-05-27 | 狀態：已實作

---

## 設計動機

根據 benchmark 測試（`docs/latency-comparison-realtime-vs-batch.md`）的結論：

| 指標 | gpt-realtime-whisper | gpt-4o-transcribe Batch |
|---|---|---|
| **首字延遲** | **638ms** ✅ | N/A（無串流） |
| **Final 延遲** | 1,684ms | **1,099ms** ✅ |
| **CER（繁中）** | 9.1%（OpenCC 後） | **0.0%** ✅ |

兩者各有優勢，因此採用**混合策略**：

- **Partial 字幕**：`gpt-realtime-whisper` → 低延遲即時字幕（首字 638ms）
- **Final 轉錄**：`gpt-4o-transcribe` → 高精度最終結果（CER 0.0%）

---

## 架構圖

```
使用者說話
    │
    ├─→ [AudioWorklet 24kHz PCM16]
    │       │
    │       ├─→ Socket.IO /rtw 'rtw:audio'
    │       │       │
    │       │       └─→ 後端 RealtimeWhisperProxy
    │       │               │
    │       │               └─→ OpenAI gpt-realtime-whisper (WS)
    │       │                       │
    │       │                       ├─→ transcript.delta
    │       │                       │       └─→ 'rtw:delta' → 前端即時字幕
    │       │                       │
    │       │                       └─→ speech_stopped
    │       │                               └─→ 'rtw:speech_stopped' → commitAudio()
    │       │
    │       └─→ useContinuousRecorder (WebM/Blob)
    │               │
    │               └─→ Socket.IO / 'audio:chunk'
    │                       │
    │                       └─→ 後端 audio:commit
    │                               │
    │                               └─→ gpt-4o-transcribe (REST)
    │                                       │
    │                                       └─→ Final 轉錄 → 翻譯 → TTS
    │
    └─→ UI 顯示
            ├─→ RTW Partial（紫色邊框，即時更新）
            └─→ Final 翻譯泡泡（完成後顯示）
```

---

## 新增檔案

### 後端

| 檔案 | 說明 |
|---|---|
| `server/src/services/realtimeWhisperProxy.ts` | RTW WebSocket 代理服務，管理每個 Socket.IO 連線的 gpt-realtime-whisper Session |
| `server/src/index.ts`（修改） | 新增 `POST /api/rtw/ephemeral-token` 端點和 `/rtw` Socket.IO 命名空間 |

### 前端

| 檔案 | 說明 |
|---|---|
| `client/src/hooks/useRealtimeWhisper.ts` | RTW Hook，管理 Socket.IO 連線、AudioWorklet 音訊串流、partial transcript 狀態 |
| `client/src/App.tsx`（修改） | 整合 `useRealtimeWhisper`，顯示 RTW 即時字幕，同步 VAD speech_stopped |

---

## Socket.IO 事件協議（`/rtw` 命名空間）

### 前端 → 後端

| 事件 | Payload | 說明 |
|---|---|---|
| `rtw:init` | `{ language: string }` | 初始化 RTW Session |
| `rtw:audio` | `ArrayBuffer` (PCM16) | 傳送音訊資料 |
| `rtw:update_lang` | `{ language: string }` | 更新辨識語言 |
| `rtw:commit` | — | 手動 commit（關閉 Server VAD 時） |

### 後端 → 前端

| 事件 | Payload | 說明 |
|---|---|---|
| `rtw:ready` | — | Session 已就緒 |
| `rtw:delta` | `{ delta: string, accumulated: string }` | 即時轉錄 delta |
| `rtw:final` | `{ transcript: string }` | RTW 完整轉錄（備用） |
| `rtw:speech_started` | — | 偵測到語音開始 |
| `rtw:speech_stopped` | `{ accumulated: string }` | 偵測到語音停止 → 觸發 Final ASR |
| `rtw:error` | `{ message: string }` | 錯誤通知 |
| `rtw:disconnected` | — | Session 斷線 |
| `rtw:lang_updated` | `{ language: string }` | 語言更新確認 |

---

## VAD 同步機制

```
gpt-realtime-whisper Server VAD
    └─→ speech_stopped
            └─→ 後端 rtwNs: socket.emit('rtw:speech_stopped', { accumulated })
                    └─→ 前端 handleRtwSpeechStopped()
                            └─→ commitAudio()
                                    └─→ Socket.IO / 'audio:commit'
                                            └─→ 後端 audio:commit handler
                                                    └─→ gpt-4o-transcribe Final ASR
```

**設計原則**：RTW 的 Server VAD 作為主要的語音邊界偵測器，觸發 Final ASR 流程，避免雙重 VAD 衝突。

---

## OpenCC 簡繁轉換

`gpt-realtime-whisper` 輸出簡體中文時，後端 `RealtimeWhisperSession` 使用 `opencc-js` 進行後處理轉換。

效能影響：+72ms（可忽略，相比 1,684ms 的 ASR 延遲）

---

## 已知限制

1. **雙重麥克風串流**：`useContinuousRecorder`（WebM）和 `useRealtimeWhisper`（PCM16 AudioWorklet）同時擷取麥克風，會消耗兩倍的麥克風資源。未來可考慮共用音訊來源。

2. **連線池未實作**：每次頁面載入才建立 RTW WebSocket 連線（~711ms TLS 握手）。預建連線池可將首字延遲降至 ~638ms。

3. **Gladia / Gemini Live 尚未整合**：本次改造僅整合 gpt-realtime-whisper，其他 provider 仍使用原有的 Partial ASR 路徑。

---

## 效能預期

| 場景 | 延遲 |
|---|---|
| 使用者開口 → 首字字幕 | **~638ms** |
| 使用者停頓 → Final 翻譯完成 | **~2,100ms**（1,099ms ASR + ~1,000ms 翻譯） |
| 連線建立（頁面載入） | **~711ms**（一次性） |
