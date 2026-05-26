# Gemini 3.1 Flash Live 遷移評估報告

> **評估日期**：2026-05-26  
> **評估對象**：護理推車即時雙向翻譯系統（realtime-translation）  
> **評估目的**：評估是否將現有 OpenAI 架構（Whisper ASR + GPT-4.1-mini 翻譯 + OpenAI TTS）遷移至 Gemini 3.1 Flash Live  
> **結論摘要**：⚠️ **部分遷移可行，建議先在 realtime_lab 驗證後再決定**

---

## 一、現有系統架構摘要

現有系統採用三層可插拔架構，各層均使用 OpenAI 服務：

```
音訊輸入（AudioWorklet + WebM Muxer）
    ↓ PCM → WebM Blob（VAD 觸發）
ASR 層：OpenAI Whisper / gpt-4o-transcribe
    ↓ 文字轉錄（含語言偵測、Smart Language Hint）
翻譯層：gpt-4.1-mini（可插拔，支援 openai / google / azure / deepl）
    ↓ 繁體中文強制 Prompt
TTS 層：OpenAI tts-1（依語言選擇 voice）
    ↓ MP3 音訊輸出
```

**關鍵設計特點：**
- 繁體中文強制規則（`CRITICAL: Output MUST be Traditional Chinese`）
- Whisper 幻覺偵測（30+ 個 pattern 過濾）
- Smart Language Hint（護士預設 zh，病人依 profile）
- 語言快取機制（避免每次重新偵測）
- 可插拔 Provider 架構（TranslationProvider 介面）

---

## 二、Gemini 3.1 Flash Live 技術規格

| 項目 | 規格 |
|---|---|
| **模型 ID** | `gemini-3.1-flash-live-preview` |
| **連接方式** | WebSocket (WSS) 雙向串流 |
| **音訊輸入格式** | 原始 PCM 16-bit, 16kHz, little-endian |
| **音訊輸出格式** | 原始 PCM 16-bit, 24kHz, little-endian |
| **支援語言** | 70 種（含中文、越南語、印尼語、菲律賓語、英文等） |
| **上下文視窗** | 131K tokens |
| **最大輸出** | 66K tokens |
| **Function Calling** | ✅ 支援 |
| **自訂 System Prompt** | ✅ 支援 |
| **語音轉錄（輸入）** | ✅ 支援（`inputAudioTranscription`） |
| **語音轉錄（輸出）** | ✅ 支援（`outputAudioTranscription`） |
| **情感對話（Affective Dialog）** | ✅ 支援（偵測語氣調整回應風格） |
| **可打斷（Barge-in）** | ✅ 支援 |
| **知識截止** | 2025 年 1 月 |

**定價（付費方案）：**

| 類型 | 費用 |
|---|---|
| 文字輸入 | $0.75 / 1M tokens |
| 音訊輸入 | $3.00 / 1M tokens（≈ $0.005 / 分鐘） |
| 文字輸出 | $4.50 / 1M tokens |
| 音訊輸出 | $12.00 / 1M tokens（≈ $0.018 / 分鐘） |

> 音訊以 25 tokens/秒計算。1 分鐘音訊 = 1,500 tokens。

---

## 三、與現有架構的逐項比較

### 3.1 ASR（語音轉文字）

| 比較項目 | 現有（Whisper/gpt-4o-transcribe） | Gemini 3.1 Flash Live |
|---|---|---|
| 轉錄方式 | 單次請求（VAD 觸發後送整段） | 連續串流（即時 Partial Transcript） |
| 首字延遲 | 300-800ms（含 WebM 封裝 + HTTP 往返） | < 100ms（原生串流） |
| 繁體中文轉錄 | ✅ 可透過 `language=zh` hint | ✅ 可透過 System Prompt 指定 |
| 語言自動偵測 | ✅ Whisper 原生支援 | ✅ 支援 70 種語言 |
| Smart Language Hint | ✅ 已實作（護士/病人分別處理） | ⚠️ 需重新實作（不同 API 範式） |
| 幻覺過濾 | ✅ 30+ pattern 過濾 | ❓ 未知（需實測） |
| 成本/分鐘 | ~$0.003（gpt-4o-mini-transcribe） | ~$0.005（音訊輸入） |

**結論**：Gemini 的串流 ASR 延遲優勢明顯，但 Smart Language Hint 邏輯需重寫，幻覺過濾行為未知。

---

### 3.2 翻譯（Text-to-Text）

| 比較項目 | 現有（gpt-4.1-mini） | Gemini 3.1 Flash Live |
|---|---|---|
| 翻譯觸發 | Final Transcript 後獨立呼叫 LLM | 整合在 Live 對話流程中（無獨立翻譯步驟） |
| 繁體中文強制 | ✅ 明確 Prompt 規則 | ✅ 可透過 System Prompt 設定（**需驗證**） |
| 醫療術語控制 | ✅ 可注入 Prompt | ✅ 可注入 System Prompt |
| 翻譯模型切換 | ✅ 可切換 gpt-4o-mini/gpt-4.1/gpt-4o | ❌ 固定使用 Gemini 模型 |
| 翻譯延遲 | 200-400ms（獨立 LLM 呼叫） | 整合在語音流程中（難以單獨測量） |
| 成本 | ~$0.001/次（gpt-4.1-mini） | 含在 Live API 費用中 |

**關鍵疑慮**：Gemini Live 是「語音對話」模型，翻譯是透過 System Prompt 引導，而非獨立翻譯 API。繁體中文輸出品質**必須實測驗證**。

---

### 3.3 TTS（文字轉語音）

| 比較項目 | 現有（OpenAI tts-1） | Gemini 3.1 Flash Live |
|---|---|---|
| 輸出格式 | MP3（前端直接播放） | PCM 16-bit 24kHz（需前端解碼） |
| 語音選擇 | 依語言選擇 voice（alloy/nova） | 30 種 HD 語音，24 種語言 |
| 語音品質 | 中等 | **更自然、情感豐富** |
| 延遲 | 120-350ms | 原生串流（邊生成邊播放） |
| 成本/分鐘 | ~$0.015（tts-1） | ~$0.018（音訊輸出） |
| 前端整合複雜度 | 低（直接播放 MP3） | **高**（需 PCM 解碼 + AudioContext 播放） |

---

### 3.4 整體架構影響

| 架構層面 | 現有系統 | 遷移至 Gemini Live |
|---|---|---|
| 後端連接方式 | HTTP REST（Whisper + GPT + TTS 各自獨立） | WebSocket 長連線（全程保持） |
| 狀態管理 | 無狀態（每次請求獨立） | **有狀態**（Session 需管理） |
| Provider 可插拔性 | ✅ 完整（ASR/翻譯/TTS 各自可換） | ❌ 全部綁定 Gemini（難以局部替換） |
| 故障轉移 | ✅ 可切換 Provider | ❌ 單一 Provider，無備援 |
| 前端音訊管道 | AudioWorklet → WebM Muxer → HTTP | AudioWorklet → PCM → WebSocket |
| 部署複雜度 | 低（無狀態 HTTP） | **高**（WebSocket 長連線 + Session 管理） |

---

## 四、成本試算比較

**假設條件**：每日 50 次對話，每次 3 分鐘，共 150 分鐘/日

| 服務 | 現有架構 | Gemini 3.1 Flash Live |
|---|---|---|
| ASR | $0.45（gpt-4o-mini-transcribe） | $0.75（音訊輸入） |
| 翻譯 | $0.15（gpt-4.1-mini） | 含在 Live 費用中 |
| TTS | $2.25（tts-1） | $2.70（音訊輸出） |
| **每日總計** | **~$2.85** | **~$3.45** |
| **每月總計** | **~$85.5** | **~$103.5** |

> Gemini 3.1 Flash Live 每月**多出約 $18**（約貴 21%），但包含更高品質的語音輸出與更低的 ASR 延遲。

---

## 五、繁體中文輸出可行性分析

這是本系統最關鍵的需求。Gemini 3.1 Flash Live **支援自訂 System Prompt**，因此理論上可以注入繁體中文強制規則。

**潛在 System Prompt 設計：**
```
你是一個即時翻譯助理，專門服務台灣護理場景。
規則：
1. 輸出語言為繁體中文（Traditional Chinese）
2. 使用台灣慣用詞彙，禁止使用簡體中文
3. 醫療術語使用台灣標準用法
4. 只輸出翻譯結果，不加任何解釋
```

**風險評估**：
- Gemini 模型在繁體中文輸出的一致性**尚未在護理場景中驗證**
- Live 對話模式下，模型可能因「對話上下文」影響而偏離 System Prompt 指示
- 需要在 `realtime_lab` 進行至少 50 次對話測試才能確認

---

## 六、遷移風險評估

| 風險項目 | 風險等級 | 說明 |
|---|---|---|
| 繁體中文輸出不穩定 | 🔴 高 | 未在護理場景驗證，可能混入簡體字 |
| WebSocket Session 管理複雜 | 🟡 中 | 需重寫後端連線管理邏輯 |
| 幻覺過濾行為未知 | 🟡 中 | Gemini 是否有類似 Whisper 的幻覺問題未知 |
| Smart Language Hint 重寫 | 🟡 中 | 護士/病人分別處理邏輯需重新設計 |
| PCM 前端解碼複雜度 | 🟡 中 | 需新增 AudioContext PCM 解碼播放 |
| Provider 可插拔性喪失 | 🟡 中 | 全部綁定 Gemini，無法局部切換 |
| Preview 版本穩定性 | 🟡 中 | `gemini-3.1-flash-live-preview` 仍為預覽版 |
| 成本增加 21% | 🟢 低 | 差異可接受，但需評估長期影響 |

---

## 七、建議方案

### 方案 A：維持現有架構（推薦短期）

**適合時機**：現有系統穩定運行，無明顯效能瓶頸

**優點**：
- 繁體中文品質已驗證
- Provider 可插拔，可局部優化
- 無狀態 HTTP，部署簡單

**缺點**：
- ASR 延遲較高（300-800ms）
- TTS 語音品質中等

---

### 方案 B：混合策略（推薦中期）

**架構**：
```
音訊輸入
├── [Gemini Live WebSocket] → 即時字幕串流（< 100ms）
└── [現有 VAD + gpt-4o-transcribe] → Final 轉錄 → gpt-4.1-mini 翻譯 → OpenAI TTS
```

**優點**：
- 即時字幕延遲大幅降低
- 翻譯品質與繁體中文輸出不受影響
- 風險最低

**缺點**：
- 需同時維護兩套連線
- 成本略增

---

### 方案 C：完全遷移至 Gemini Live（需驗證後才考慮）

**前提條件**（必須全部達成）：
1. ✅ `realtime_lab` 三模型比較測試完成
2. ✅ 繁體中文輸出在 50+ 次對話中穩定（< 5% 簡體字出現率）
3. ✅ 幻覺過濾行為與現有系統相當
4. ✅ `gemini-3.1-flash-live-preview` 升級為正式版本

---

## 八、驗證計畫（使用 realtime_lab）

已建立的 `realtime_lab` 三模型比較平台可直接用於驗證：

| 驗證項目 | 測試方法 | 通過標準 |
|---|---|---|
| 繁體中文輸出 | 50 次中文對話，統計簡體字出現率 | < 5% |
| 翻譯準確度 | 護理常用語 20 句，人工評分 | 平均 ≥ 4/5 分 |
| ASR 延遲 | 測量首字 Delta 時間 | < 200ms |
| 幻覺過濾 | 靜音/噪音輸入 10 次 | 0 次錯誤輸出 |
| 醫療術語 | 20 個護理術語翻譯 | 100% 正確 |

---

## 九、最終建議

```
現在（立即）：在 realtime_lab 進行 Gemini 3.1 Flash Live 驗證測試
                ↓
1-2 週後：根據驗證結果決定
    ├── 繁體中文穩定 → 規劃完整遷移（3-4 週工程）
    └── 繁體中文不穩定 → 採用混合策略（僅替換 ASR 層）
```

**核心判斷依據**：繁體中文輸出的穩定性是本系統最不可妥協的需求。在 `realtime_lab` 驗證完成前，**不建議對正式系統進行任何遷移動作**。

---

## 附錄：相關評估報告

| 報告 | 說明 |
|---|---|
| [`gpt-realtime-translate-evaluation.md`](./gpt-realtime-translate-evaluation.md) | OpenAI gpt-realtime-translate 遷移評估 |
| [`gpt-realtime-whisper-asr-evaluation.md`](./gpt-realtime-whisper-asr-evaluation.md) | gpt-realtime-whisper 取代 ASR 評估 |
| 本文件 | Gemini 3.1 Flash Live 完整遷移評估 |

---

*報告由 Manus AI 自動生成，基於 OpenAI 與 Google 官方文件及現有系統程式碼分析。*
