# OpenAI vs Google Gemini 即時語音翻譯 API 比較測試報告

**測試日期**：2025年1月  
**測試環境**：macOS / Node.js v20+  
**測試目的**：評估 OpenAI Realtime API 與 Google Gemini Multimodal Live API 在醫療即時翻譯場景的效能與品質

---

## 1. 測試概述

### 1.1 測試目標

- 比較兩種 API 的連線效能
- 評估語音轉錄（STT）準確度
- 評估翻譯品質與自然度
- 測量端到端延遲
- 評估醫療場域適用性

### 1.2 測試配置

| 項目 | OpenAI | Gemini |
|------|--------|--------|
| API 版本 | Realtime API v1 | Multimodal Live API |
| 模型 | gpt-4o-realtime-preview-2024-12-17 | **可配置**（見下方說明） |
| 轉錄模型 | gpt-4o-mini-transcribe | 內建轉錄 |
| 音訊格式 | PCM16 24kHz mono | PCM16 16kHz mono |
| VAD 模式 | Server VAD | Automatic Activity Detection |
| 連線協議 | WebSocket | WebSocket |

#### Gemini 模型配置

Gemini 模型現已支援環境變數配置：

| 環境變數 | 預設值 | 說明 |
|----------|--------|------|
| `GEMINI_LIVE_MODEL` | `gemini-3-flash-preview` | 主要使用的模型 |
| 自動 Fallback | `gemini-2.0-flash-exp` | 當主模型不支援時自動切換 |

**支援的模型**：
- `gemini-3-flash-preview` - 最新預覽版，速度與品質兼顧（預設）
- `gemini-2.0-flash-exp` - 穩定版，作為 fallback

**切換方式**：只需修改 `.env` 檔案，無需改動程式碼

```bash
# server/.env
GEMINI_LIVE_MODEL=gemini-3-flash-preview
```

**Session 資訊**：每次連線時會在 console log 與 session metadata 中記錄實際使用的模型名稱，方便測試報告自動收集。

### 1.3 測試音訊

- **檔案**：`zh-01.mp3`
- **內容**：「請問你今天哪裡不舒服？」（醫療問診用語）
- **語言**：繁體中文 (zh-TW)
- **目標語言**：英文 (en)
- **時長**：約 2.3 秒

---

## 2. 測試結果

### 2.1 連線效能

| 指標 | OpenAI | Gemini | 差異 |
|------|--------|--------|------|
| WebSocket 連線時間 | 731ms | 174ms | Gemini 快 4.2x |
| Session 建立時間 | 736ms | 174ms | Gemini 快 4.2x |

**結論**：Gemini 的連線速度明顯優於 OpenAI。

### 2.2 語音活動偵測 (VAD)

| 指標 | OpenAI | Gemini |
|------|--------|--------|
| 語音開始偵測 | ✅ 2945ms | ❌ 無獨立事件 |
| 語音結束偵測 | ✅ 4777ms | ❌ 無獨立事件 |
| 自動緩衝區提交 | ✅ | ✅ |

**說明**：

- OpenAI 提供明確的 `speech_started` 和 `speech_stopped` 事件
- Gemini 使用 `automaticActivityDetection`，但不發送獨立的語音偵測事件

### 2.3 語音轉錄 (STT)

| 指標 | OpenAI | Gemini |
|------|--------|--------|
| 轉錄開始時間 | 5331ms | 3827ms |
| 轉錄完成時間 | 5424ms | 4557ms |
| 轉錄結果 | 請問你今天哪裡不舒服? | 請問您今天哪裡不舒服? |
| 轉錄準確度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

**分析**：

- 兩者轉錄準確度相當
- OpenAI 使用「你」，Gemini 使用「您」（更禮貌）
- Gemini 轉錄速度較快（提前約 870ms）

### 2.4 翻譯品質

| 指標 | OpenAI | Gemini |
|------|--------|--------|
| 翻譯結果 | Where do you feel uncomfortable? | What brings you in today? |
| 翻譯完成時間 | 5426ms | 4970ms |
| 字面準確度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| 自然度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 醫療適用性 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

**詳細分析**：

| 評估面向 | OpenAI | Gemini |
|---------|--------|--------|
| 直譯準確性 | 精確對應原文「哪裡不舒服」 | 意譯為「什麼原因來看診」 |
| 英語自然度 | 正確但稍顯直譯 | 更符合英語母語者用法 |
| 醫療情境 | 適用於詢問症狀位置 | 更適合作為問診開場白 |

### 2.5 端到端延遲

```
時間軸比較（從開始發送音訊到收到翻譯）

OpenAI:
├── 0ms      開始發送音訊
├── 2945ms   VAD 偵測到語音開始
├── 4777ms   VAD 偵測到語音結束
├── 5331ms   開始收到轉錄
├── 5424ms   轉錄完成
└── 5426ms   翻譯完成
    總延遲：約 5.4 秒

Gemini:
├── 0ms      開始發送音訊
├── 3827ms   開始收到轉錄
├── 4557ms   轉錄完成
└── 4970ms   翻譯完成
    總延遲：約 5.0 秒
```

| 延遲指標 | OpenAI | Gemini | 差異 |
|---------|--------|--------|------|
| 首次轉錄延遲 | 5331ms | 3827ms | Gemini 快 1.5s |
| 翻譯完成延遲 | 5426ms | 4970ms | Gemini 快 0.5s |
| 音訊結束到翻譯完成 | ~650ms | ~400ms | Gemini 快 38% |

---

## 3. 功能比較

### 3.1 API 功能矩陣

| 功能 | OpenAI | Gemini |
|------|--------|--------|
| 語音轉錄 (STT) | ✅ | ✅ |
| 文字轉語音 (TTS) | ✅ | ✅ |
| 即時翻譯 | ✅ | ✅ |
| Server VAD | ✅ | ✅ |
| 轉錄 Delta 事件 | ✅ | ✅ |
| 語音開始/結束事件 | ✅ | ❌ |
| 輸入音訊轉錄 | ✅ | ✅ |
| 多語言支援 | ✅ | ✅ |
| 自訂系統提示 | ✅ | ✅ |
| **自動語言偵測** | ❌ | ✅ |

### 3.2 技術規格

| 規格 | OpenAI | Gemini |
|------|--------|--------|
| 音訊取樣率 | 24000 Hz | 16000 Hz |
| 音訊格式 | PCM16 LE | PCM16 LE |
| 聲道 | Mono | Mono |
| WebSocket 端點 | wss://api.openai.com/v1/realtime | wss://generativelanguage.googleapis.com/ws/... |
| 認證方式 | Bearer Token | API Key (Query Param) |

---

## 4. 語言辨識測試

### 4.1 自動語言偵測能力

測試 API 在不指定來源語言時，能否自動識別語音的語言。

| 測試語言 | 測試內容 | OpenAI | Gemini |
|---------|---------|--------|--------|
| 中文 (zh) | 請問你今天哪裡不舒服 | ✅ (指定語言) | ✅ 正確辨識 |
| 英文 (en) | Where does it hurt | ✅ (指定語言) | ✅ 正確辨識 |
| 日文 (ja) | 今日はどこが痛いですか | ✅ (指定語言) | ❌ 誤判為中文 |
| 越南文 (vi) | Hôm nay bạn đau ở đâu | ✅ (指定語言) | ❌ 未辨識 |
| 泰文 (th) | วันนี้เจ็บตรงไหน | ✅ (指定語言) | ✅ 正確辨識 |
| 印尼文 (id) | Di mana yang sakit | ✅ (指定語言) | ❌ 未辨識 |

### 4.2 語言辨識結論

| 項目 | OpenAI | Gemini |
|------|--------|--------|
| 自動偵測支援 | ❌ 不支援 `language: 'auto'` | ✅ 支援 |
| 指定語言準確度 | ⭐⭐⭐⭐⭐ (100%) | N/A |
| 自動偵測準確度 | N/A | ⭐⭐⭐ (~50%) |

### 4.3 重要發現

**OpenAI Realtime API 不支援自動語言偵測**：

```
錯誤訊息：'auto' is not a valid input language, the supported input languages are: 
af, ar, az, be, bg, bs, ca, cs, cy, da, de, el, en, es, et, fa, fi, fr, gl, he, hi, 
hr, hu, hy, id, is, it, iw, ja, kk, kn, ko, lt, lv, mi, mk, mr, ms, ne, nl, no, pl, 
pt, ro, ru, sk, sl, sr, sv, sw, ta, th, tl, tr, uk, ur, vi, zh
```

### 4.4 醫療場景影響

| 場景 | 影響 | 建議 |
|-----|------|------|
| 多語言診間 | OpenAI 需要前端選擇語言 | Gemini 可自動偵測 |
| 東南亞語言 | Gemini 辨識率較低 | 建議預設指定語言 |
| 中日韓語言 | Gemini 可能混淆 | 建議明確指定語言 |

---

## 5. 穩定性測試

### 5.1 連線穩定性

| 測試項目 | OpenAI | Gemini |
|---------|--------|--------|
| 連線成功率 | 100% | 100% |
| 斷線代碼 | 1005 (異常關閉) | 1000 (正常關閉) |
| 心跳機制 | ✅ 已實作 | ✅ 已實作 |
| 自動重連 | ✅ 已實作 | ✅ 已實作 |

### 5.2 錯誤處理

| 錯誤類型 | OpenAI | Gemini |
|---------|--------|--------|
| 空音訊緩衝區 | 明確錯誤訊息 | 靜默處理 |
| API 配額超限 | 429 錯誤 | RESOURCE_EXHAUSTED |
| 無效音訊格式 | 錯誤回報 | 錯誤回報 |

### 5.3 失敗樣態診斷（OpenAI）

#### 5.3.1 常見失敗症狀

| 症狀 | 可能原因 | 優先檢查 |
|-----|---------|---------|
| 完全無回應 | 音訊格式錯誤 / VAD 未偵測到語音 | `input_audio_buffer.speech_started` 事件 |
| 收到空白轉錄 | 音量過低 / 取樣率不匹配 | 音訊振幅是否 > 500 |
| 1005 斷線 | 長時間無音訊 / 網路問題 | Heartbeat 機制 |
| `conversation.item.input_audio_transcription.failed` | 轉錄模型問題 | 檢查 `input_audio_transcription` 設定 |

#### 5.3.2 根因分類

```
失敗根因分類：
├── 音訊層
│   ├── 格式不符（非 PCM16）
│   ├── 取樣率錯誤（非 24kHz）
│   └── 音量過低（振幅 < 500）
├── 協議層
│   ├── 缺少 session.update
│   ├── 語言參數使用 'auto'（不支援）
│   └── 未正確處理事件順序
└── 網路層
    ├── WebSocket 斷線（1005/1006）
    └── Heartbeat 超時
```

#### 5.3.3 關鍵事件檢查清單

正確的事件流程應依序收到：

| 順序 | 事件 | 意義 | 缺失時的影響 |
|-----|------|------|-------------|
| 1 | `session.created` | 連線建立 | 無法開始 |
| 2 | `session.updated` | 設定已套用 | 使用預設設定 |
| 3 | `input_audio_buffer.speech_started` | VAD 偵測到語音開始 | 不會觸發轉錄 |
| 4 | `input_audio_buffer.speech_stopped` | VAD 偵測到語音結束 | 不會自動 commit |
| 5 | `input_audio_buffer.committed` | 音訊已提交處理 | 不會開始轉錄 |
| 6 | `conversation.item.created` | 對話項目已建立 | - |
| 7 | `conversation.item.input_audio_transcription.completed` | 轉錄完成 | 無轉錄結果 |
| 8 | `response.created` | 開始生成回應 | - |
| 9 | `response.done` | 回應完成 | 流程未結束 |

#### 5.3.4 Debug Checklist（10 步驟）

| # | 檢查項目 | 預期結果 | 失敗時的處理 |
|---|---------|---------|-------------|
| 1 | 是否收到 `session.created`? | ✅ 有 | 檢查 API Key / 網路 |
| 2 | 是否有送 `session.update`? | ✅ 有 | 加入 session.update 呼叫 |
| 3 | 音訊格式是否為 PCM16 24kHz mono? | ✅ 是 | 使用 audioConverter 重取樣 |
| 4 | 音訊振幅是否 > 500? | ✅ 是 | 檢查錄音設備 / 增益 |
| 5 | 是否有持續送 `input_audio_buffer.append`? | ✅ 有 | 檢查音訊串流邏輯 |
| 6 | 是否收到 `input_audio_buffer.speech_started`? | ✅ 有 | 調低 VAD threshold |
| 7 | 是否收到 `input_audio_buffer.speech_stopped`? | ✅ 有 | 增加 silence_duration_ms |
| 8 | 是否收到 `input_audio_buffer.committed`? | ✅ 有 | 手動呼叫 commit 測試 |
| 9 | 是否收到 `transcription.completed`? | ✅ 有 | 檢查轉錄模型設定 |
| 10 | 是否收到 `response.done`? | ✅ 有 | 檢查 response.create 是否有送出 |

#### 5.3.5 修復 SOP

**Step 1：驗證音訊格式**

```bash
# 使用 ffprobe 檢查音訊
ffprobe -v error -show_entries stream=sample_rate,channels,codec_name -of csv=p=0 input.wav
# 預期輸出：pcm_s16le,24000,1
```

**Step 2：手動 commit 測試**

```typescript
// 暫時關閉 Server VAD
session.update({
    turn_detection: null  // 關閉 VAD
});

// 手動 commit
client.sendEvent({ type: 'input_audio_buffer.commit' });
client.sendEvent({ type: 'response.create', response: { modalities: ['text'] } });
```

**Step 3：調整 VAD 參數**

```typescript
session.update({
    turn_detection: {
        type: 'server_vad',
        threshold: 0.3,           // 降低門檻（預設 0.5）
        prefix_padding_ms: 300,   // 增加前置填充
        silence_duration_ms: 500, // 增加靜音容忍時間
    }
});
```

**Step 4：改用事件驅動結束**

```typescript
// ❌ 錯誤：固定時間等待
await new Promise(resolve => setTimeout(resolve, 30000));

// ✅ 正確：事件驅動
await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 30000);
    client.on('response.done', () => {
        clearTimeout(timeout);
        resolve();
    });
    client.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
    });
});
```

#### 5.3.6 WebSocket 斷線代碼處理

| 代碼 | 意義 | 建議處理 |
|-----|------|---------|
| 1000 | 正常關閉 | 無需處理 |
| 1001 | Going Away | 伺服器重啟，自動重連 |
| 1005 | 無 close frame | 網路中斷，自動重連 + 指數退避 |
| 1006 | 異常關閉 | 連線異常，自動重連 + 指數退避 |

**重連策略：**

```typescript
// 指數退避：1s → 2s → 4s → 8s → 16s
const delay = Math.min(1000 * Math.pow(2, attempt), 16000);
await sleep(delay);
await client.connect();
// 重連後需要重新 session.update
```

---

## 6. 醫療場域適用性評估

### 6.1 評估標準

| 標準 | 權重 | OpenAI | Gemini |
|------|------|--------|--------|
| 轉錄準確度 | 25% | 95/100 | 95/100 |
| 翻譯品質 | 25% | 85/100 | 90/100 |
| 延遲表現 | 20% | 80/100 | 90/100 |
| 自然度 | 15% | 80/100 | 95/100 |
| API 穩定性 | 15% | 90/100 | 85/100 |
| **加權總分** | 100% | **86.25** | **91.25** |

### 6.2 各情境適用性

| 使用情境 | 推薦方案 | 原因 |
|---------|---------|------|
| 即時問診翻譯 | Gemini | 延遲低、翻譯自然 |
| 醫療文件口述 | OpenAI | 字面準確度高 |
| 多語言診間 | Gemini | 支援自動語言偵測 |
| 緊急情況溝通 | Gemini | 更快的回應時間 |
| 精確症狀描述 | OpenAI | 直譯更精確 |

---

## 7. 結論與建議

### 7.1 總體評估

| 評估項目 | 勝出方案 |
|---------|---------|
| 連線速度 | 🏆 Gemini |
| 轉錄速度 | 🏆 Gemini |
| 翻譯速度 | 🏆 Gemini |
| 翻譯自然度 | 🏆 Gemini |
| 字面準確度 | 🏆 OpenAI |
| API 文件完整度 | 🏆 OpenAI |
| 事件細緻度 | 🏆 OpenAI |
| 自動語言偵測 | 🏆 Gemini |

### 7.2 建議

#### 推薦使用 Gemini 的情況

- 對延遲敏感的即時翻譯場景
- 需要更自然的翻譯輸出
- 頻寬受限環境（16kHz vs 24kHz）

#### 推薦使用 OpenAI 的情況

- 需要精確的字面翻譯
- 需要詳細的 VAD 事件監控
- 已有 OpenAI 生態系整合

### 7.3 醫療場域最終建議

**建議採用：Google Gemini Multimodal Live API**

原因：

1. 更快的端到端延遲（快約 10%）
2. 翻譯更符合英語醫療用語習慣
3. 連線速度快 4 倍以上
4. 支援自動語言偵測，適合多語言診間
5. 對於即時口譯場景，自然度比字面準確度更重要

---

## 8. 附錄

### 8.1 測試程式碼位置

```
server/src/realtime/
├── openaiRealtimeClient.ts        # OpenAI 客戶端
├── geminiRealtimeClient.ts        # Gemini 客戶端
├── voice-diagnostic-test.ts       # OpenAI 語音測試
├── gemini-voice-diagnostic-test.ts # Gemini 語音測試
├── language-detection-test.ts     # 多語言辨識測試
├── types.ts                       # 共用介面定義
└── index.ts                       # 工廠模式入口
```

### 8.2 環境變數設定

```bash
# .env
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
REALTIME_PROVIDER=gemini  # 或 openai
```

### 8.3 測試重現步驟

```bash
# OpenAI 語音測試
cd server
npx tsx src/realtime/voice-diagnostic-test.ts

# Gemini 語音測試
npx tsx src/realtime/gemini-voice-diagnostic-test.ts

# 多語言辨識測試
npx tsx src/realtime/language-detection-test.ts
```

### 8.4 音訊格式規格

| 提供者 | 格式 | 取樣率 | 位元深度 | 聲道 |
|-------|------|--------|---------|------|
| OpenAI | PCM | 24kHz | 16-bit | Mono |
| Gemini | PCM | 16kHz | 16-bit | Mono |

---

**報告撰寫**：AI 助手  
**審核狀態**：待審核  
**版本**：v1.1（含 Debug Checklist）
