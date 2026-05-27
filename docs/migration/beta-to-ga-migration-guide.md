# gpt-4o-realtime-preview → GA API 遷移指南

**文件版本**：2026-05-27  
**目標模型**：`gpt-realtime-2`（GA）  
**來源模型**：`gpt-4o-realtime-preview-2024-12-17`（Beta，已停用）  
**影響檔案**：`server/src/realtime/openaiRealtimeClient.ts`（724 行）

---

## 一、Beta vs GA API 差異對照表

透過實測（2026-05-27）確認的完整差異：

| 項目 | Beta API（舊） | GA API（新） | 備註 |
|---|---|---|---|
| **WebSocket URL** | `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17` | `wss://api.openai.com/v1/realtime?model=gpt-realtime-2` | URL 參數格式相同 |
| **OpenAI-Beta header** | `'OpenAI-Beta': 'realtime=v1'` **必須** | **不需要，加上反而被拒絕** | 移除此 header |
| **session.type** | 不需要 | **必須**：`'realtime'` 或 `'transcription'` | 新增必填欄位 |
| **session.modalities** | `['text', 'audio']` | **不支援**（Unknown parameter） | 移除此欄位 |
| **session.input_audio_format** | `'pcm16'` | **不支援**（Unknown parameter） | 改用 `audio.input.format` |
| **session.output_audio_format** | `'pcm16'` | **不支援**（Unknown parameter） | 改用 `audio.output.format` |
| **session.input_audio_transcription** | `{ model, language }` | **不支援**（Unknown parameter） | 改用 `audio.input.transcription` |
| **session.turn_detection** | `{ type, threshold, ... }` | **不支援**（Unknown parameter） | 改用 `audio.input.turn_detection` |
| **session.instructions** | 頂層欄位 | 頂層欄位（相同） | 無需修改 |
| **音訊格式** | PCM16 | `audio/pcm`（rate: 24000） | 格式相同，名稱不同 |
| **VAD 預設靜音** | 600ms | 500ms | 需調整 |
| **output_modalities** | `modalities` 頂層 | `output_modalities` 頂層 | 欄位名稱改變 |

### GA API session.update 正確格式（實測確認）

```json
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "instructions": "You are a real-time translator...",
    "audio": {
      "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "transcription": {
          "model": "gpt-4o-mini-transcribe",
          "language": "zh"
        },
        "turn_detection": {
          "type": "server_vad",
          "threshold": 0.3,
          "silence_duration_ms": 300,
          "create_response": true,
          "interrupt_response": true
        }
      },
      "output": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "voice": "marin"
      }
    }
  }
}
```

---

## 二、事件名稱差異

| 事件 | Beta API | GA API | 狀態 |
|---|---|---|---|
| 轉錄 delta | `conversation.item.input_audio_transcription.delta` | 待確認（可能相同） | 需測試 |
| 轉錄完成 | `conversation.item.input_audio_transcription.completed` | 待確認 | 需測試 |
| 語音開始 | `input_audio_buffer.speech_started` | 待確認 | 需測試 |
| 語音結束 | `input_audio_buffer.speech_stopped` | 待確認 | 需測試 |
| 音訊 committed | `input_audio_buffer.committed` | 待確認 | 需測試 |
| 回應文字 delta | `response.text.delta` | 待確認 | 需測試 |
| 回應完成 | `response.done` | 待確認 | 需測試 |

---

## 三、具體遷移步驟

### Step 1：修改 WebSocket 連線（預計 30 分鐘）

**檔案**：`server/src/realtime/openaiRealtimeClient.ts`，第 302–318 行

```typescript
// ❌ 舊（Beta）
const url = `${REALTIME_API_URL}?model=${this.model}`;
this.ws = new WebSocket(url, {
    headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',   // ← 移除
    },
});

// ✅ 新（GA）
const url = `${REALTIME_API_URL}?model=${this.model}`;
this.ws = new WebSocket(url, {
    headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        // 不需要 OpenAI-Beta header
    },
});
```

同時修改預設 model：
```typescript
// ❌ 舊
const DEFAULT_MODEL = 'gpt-4o-realtime-preview-2024-12-17';

// ✅ 新
const DEFAULT_MODEL = 'gpt-realtime-2';
```

---

### Step 2：重構 session.update（預計 60 分鐘）

**檔案**：`server/src/realtime/openaiRealtimeClient.ts`，第 322–350 行

```typescript
// ❌ 舊（Beta）
this.sendEvent({
    type: 'session.update',
    session: {
        modalities: ['text', 'audio'],
        instructions: this.buildInstructions(),
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
            model: 'gpt-4o-mini-transcribe',
            language: this.getWhisperLanguageCode(this.sourceLang),
        },
        turn_detection: {
            type: 'server_vad',
            threshold: this.vadThreshold,
            silence_duration_ms: this.vadSilenceDurationMs,
            create_response: true,
            interrupt_response: true,
        },
    },
});

// ✅ 新（GA）
this.sendEvent({
    type: 'session.update',
    session: {
        type: 'realtime',
        instructions: this.buildInstructions(),
        audio: {
            input: {
                format: { type: 'audio/pcm', rate: 24000 },
                transcription: {
                    model: 'gpt-4o-mini-transcribe',
                    language: this.getWhisperLanguageCode(this.sourceLang),
                },
                turn_detection: {
                    type: 'server_vad',
                    threshold: this.vadThreshold,
                    silence_duration_ms: this.vadSilenceDurationMs,
                    create_response: true,
                    interrupt_response: true,
                },
            },
            output: {
                format: { type: 'audio/pcm', rate: 24000 },
            },
        },
    },
});
```

---

### Step 3：驗證事件名稱（預計 60 分鐘）

建立測試腳本，傳送真實音訊，記錄 GA API 回傳的所有事件名稱，與現有 `handleEvent()` 的 switch-case 對照。

重點確認：
- `conversation.item.input_audio_transcription.delta` 是否仍然存在
- `response.text.delta` 是否仍然存在
- `input_audio_buffer.speech_started/stopped` 是否仍然存在

---

### Step 4：修正 handleEvent（預計 30–90 分鐘）

依 Step 3 的測試結果，修正 `handleEvent()` 中的 switch-case 事件名稱。

---

### Step 5：更新 CONFIG 和 .env（預計 15 分鐘）

```typescript
// server/src/index.ts
model: process.env.OPENAI_MODEL || 'gpt-realtime-2',  // ← 更新預設值
```

---

### Step 6：端對端測試（預計 60 分鐘）

使用現有的 `test-warmpool-e2e.ts` 腳本驗證完整翻譯流程：
1. 說話 → 轉錄 delta 出現
2. 停頓 → 翻譯結果出現
3. 雙向翻譯（zh→en, en→zh）均正常

---

## 四、預計時程

| 步驟 | 工作內容 | 預計時間 | 風險 |
|---|---|---|---|
| Step 1 | 移除 Beta header + 更新 model | 30 分鐘 | 低 |
| Step 2 | 重構 session.update 格式 | 60 分鐘 | 低（格式已確認） |
| Step 3 | 驗證 GA API 事件名稱 | 60 分鐘 | 中（事件名稱未確認） |
| Step 4 | 修正 handleEvent | 30–90 分鐘 | 中（取決於事件差異數量） |
| Step 5 | 更新 CONFIG | 15 分鐘 | 低 |
| Step 6 | 端對端測試 + 修正 | 60 分鐘 | 中 |
| **總計** | | **4.5–6 小時** | |

> 主要不確定因素：Step 3 的事件名稱驗證。若 GA API 的事件名稱與 Beta 完全相同（可能性高），Step 4 可縮短至 15 分鐘，總時程降至 **3–4 小時**。

---

## 五、風險評估

### 高風險項目
- **`response.create` 格式**：GA API 的 `response.create` 是否仍支援 `modalities: ['text']`，需要測試確認。若不支援，翻譯輸出管道需要重新設計。

### 中風險項目
- **事件名稱變更**：若 GA API 改變了 `conversation.item.input_audio_transcription.*` 的事件名稱，需要更新所有 event handler。

### 低風險項目
- **音訊格式**：PCM16 24kHz 格式相同，只是 JSON 欄位路徑不同，前端音訊管道無需修改。
- **翻譯邏輯**：`buildInstructions()` 的翻譯 prompt 無需修改。

---

## 六、回滾計畫

若遷移後出現問題：
1. 將 `DEFAULT_MODEL` 改回 `gpt-4o-realtime-preview-2024-12-17`（但此模型已停用，無法真正回滾）
2. 實際回滾方案：切換至**方案 A 混合架構**（gpt-realtime-whisper ASR + gpt-4.1-mini 翻譯），此方案已完整實作且測試通過

---

## 七、相關檔案清單

| 檔案 | 修改範圍 | 優先級 |
|---|---|---|
| `server/src/realtime/openaiRealtimeClient.ts` | Step 1–4 全部 | P0 |
| `server/src/index.ts` | Step 5 CONFIG 更新 | P1 |
| `server/.env` / `server/.env.example` | OPENAI_MODEL 預設值 | P2 |
| `tools/test-ga-realtime2.ts` | Step 3 事件驗證腳本 | P0（測試用） |
