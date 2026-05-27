# Gemini Live API 官方文件重點筆記（2026-05-27）

## 模型比較

| 功能 | gemini-3.1-flash-live-preview | gemini-2.5-flash-live-preview |
|---|---|---|
| Thinking | `thinkingLevel`: minimal/low/medium/high（預設 minimal） | `thinkingBudget` token 數 |
| 單一事件內容 | **一個事件可包含多個 parts（inlineData + transcript）** | 每個事件只有一個 part |
| send_client_content | 僅支援初始 context history | 整個對話都支援 |
| 非同步 function calling | **不支援** | 支援 |
| Proactive audio | **不支援** | 支援 |
| Affective dialogue | **不支援** | 支援 |

## 音訊格式

- **輸入**：raw 16-bit PCM, 16kHz, little-endian
  - MIME type: `audio/pcm;rate=16000`
  - 使用 `send_realtime_input(audio=Blob(data=chunk, mime_type="audio/pcm;rate=16000"))`
  - **舊的 `realtime_input.media_chunks` 已棄用**
- **輸出**：raw 16-bit PCM, 24kHz, little-endian

## WebSocket 訊息格式（直接 WebSocket，非 SDK）

### 連線 URL
```
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={API_KEY}
```

### Setup 訊息
```json
{
  "setup": {
    "model": "models/gemini-3.1-flash-live-preview",
    "generation_config": {
      "response_modalities": ["AUDIO"]
    },
    "system_instruction": {
      "parts": [{"text": "You are a real-time interpreter..."}]
    },
    "output_audio_transcription": {}
  }
}
```

### 音訊輸入訊息（新格式）
```json
{
  "realtime_input": {
    "audio": {
      "data": "<base64-encoded PCM16 16kHz>",
      "mime_type": "audio/pcm;rate=16000"
    }
  }
}
```

### 轉錄設定
- **輸出轉錄**：在 setup 中加入 `"output_audio_transcription": {}`
- **輸入轉錄**：在 setup 中加入 `"input_audio_transcription": {}`
- 轉錄語言由模型自動推斷

### 接收轉錄（gemini-3.1 特有）
- 一個事件可同時包含 `inlineData`（音訊）和 transcript
- 需要處理每個事件的所有 parts

## 重要差異（gemini-3.1 vs 舊版）

1. `send_client_content` 只能用於初始 context，對話中改用 `send_realtime_input`
2. 一個 server event 可包含多個 content parts
3. 預設 turn coverage: `TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO`
4. 不支援非同步 function calling

## 轉錄欄位（從實測確認）

server → client 訊息結構：
```json
{
  "serverContent": {
    "modelTurn": {
      "parts": [
        { "inlineData": { "mimeType": "audio/pcm;rate=24000", "data": "..." } },
        { "text": "轉錄文字" }
      ]
    },
    "outputTranscription": {
      "text": "轉錄文字"
    }
  }
}
```
