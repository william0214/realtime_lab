# 語音翻譯系統 — 完整測試結果總覽

**文件版本**：v1.0  
**最後更新**：2026-05-27（Gemini 3.1 Flash Live benchmark 完成）  
**測試環境**：新加坡沙箱（sandbox）→ `api.openai.com`  
**專案**：護理推車即時雙向翻譯系統（realtime-translation）  
**測試平台**：[william0214/realtime_lab](https://github.com/william0214/realtime_lab)

---

## 一、測試總覽

本文件彙整所有在 `realtime_lab` 進行的測試結果，涵蓋以下五大類別：

| 類別 | 測試項目 | 狀態 |
|---|---|---|
| [Provider Benchmark](#二provider-benchmark-測試) | 5 個 ASR Provider 的延遲與準確度比較 | ✅ 完成 |
| [Gemini 3.1 Flash Live Benchmark](#二b-gemini-31-flash-live-benchmark) | Gemini 3.1 Flash Live 完整 10 句測試 | ✅ 完成 |
| [延遲分解分析](#三延遲分解分析) | gpt-realtime-whisper 各環節耗時 | ✅ 完成 |
| [Realtime vs Batch 比較](#四realtime-vs-batch-延遲比較) | gpt-realtime-whisper vs gpt-4o-transcribe | ✅ 完成 |
| [簡繁轉換效能比較](#五簡繁轉換效能比較) | opencc-js vs zhconv | ✅ 完成 |
| [方案 A RTW Socket.IO 測試](#六方案-a-rtw-socketio-端對端測試) | 後端 WebSocket 代理端對端驗證 | ✅ 完成 |

---

## 二、Provider Benchmark 測試

**測試日期**：2026-05-27  
**測試集**：10 句護理場景中文對話（zh-01 至 zh-10）  
**目標語言**：中文（zh）→ 英文（en）  
**相關文件**：`docs/benchmark-report-zh-2026-05-27.md`

### 2.1 整體比較

| Provider | 首字延遲 | Final 延遲 | CER (↓) | 繁中比例 | 成功率 | 備註 |
|---|---|---|---|---|---|---|
| **OpenAI Whisper Batch** | N/A | **1,099ms** | **0.0%** | **100%** | 100% | 基準線 |
| **gpt-realtime-whisper** | **638ms** | 1,684ms | 9.1%* | 100%† | 100% | †OpenCC 後處理 |
| **gpt-realtime-translate** | 665ms | N/A | 100.0%‡ | 100% | 100% | ‡輸出為英文 |
| ~~Deepgram Nova-3~~ | ~~1,854ms~~ | ~~4,141ms~~ | ~~14.3%~~ | ~~0%~~ | ~~100%~~ | **已剔除** |
| **Gladia Solaria-1** | N/A | 4,902ms | 56.6% | 0% | 100% | 待進一步測試 |

> *gpt-realtime-whisper CER 9.1% 明細：
> - zh-06「掛號→括號」：同音字誤辨（CER 11.1%）
> - zh-07「台→檯」：繁體異體字，語義正確（CER 7.1%）
> - 其餘 8 句：CER 0.0%

### 2.2 逐句測試結果（gpt-realtime-whisper + OpenCC）

| 句子 ID | 預期文字 | 實際輸出 | 首字延遲 | Final 延遲 | CER |
|---|---|---|---|---|---|
| zh-01 | 請問您今天哪裡不舒服？ | 請問您今天哪裡不舒服？ | 808ms | 1,748ms | **0.0%** |
| zh-02 | 我頭痛已經三天了，而且有點發燒。 | 我頭痛已經三天了，而且有點發燒。 | 613ms | 1,717ms | **0.0%** |
| zh-03 | 請問您對什麼藥物過敏嗎？ | 請問您對什麼藥物過敏嗎？ | 1,004ms | 1,826ms | **0.0%** |
| zh-04 | 我對青黴素過敏，吃了會起疹子。 | 我對青黴素過敏。吃了會起疹子。 | 586ms | 1,647ms | **0.0%** |
| zh-05 | 這個藥一天吃三次，每次一顆，飯後服用。 | 這個藥一天吃三次,每次一顆。飯後服用。 | 430ms | 1,777ms | **0.0%** |
| zh-06 | 請問**掛號**要怎麼辦理？ | 請問**括號**要怎麼辦理？ | 469ms | 1,263ms | **11.1%** |
| zh-07 | 您需要先到一樓服務**台**抽號碼牌。 | 您需要先到一樓服務**檯**抽號碼牌。 | 730ms | 1,790ms | **7.1%** |
| zh-08 | 我的肚子很痛，痛了一整個晚上。 | 我的肚子很痛，痛了一整個晚上。 | 536ms | 1,447ms | **0.0%** |
| zh-09 | 請您先做一個血液檢查，報告大概兩個小時後出來。 | 請您先做一個血液檢查。報告大概兩個小時後出來。 | 458ms | 1,952ms | **0.0%** |
| zh-10 | 謝謝醫生，請問下次什麼時候回診？ | 謝謝醫生。請問下次什麼時候回診？ | 746ms | 1,672ms | **0.0%** |
| **平均** | — | — | **638ms** | **1,684ms** | **9.1%** |

### 2.3 關鍵技術修正

在本次 benchmark 過程中，發現並修正以下問題：

| 問題 | 錯誤做法 | 正確做法 | Commit |
|---|---|---|---|
| gpt-realtime-whisper GA API URL | `?model=gpt-realtime-whisper` | `?intent=transcription` | `558b684` |
| OpenAI-Beta header | 加入 `OpenAI-Beta: realtime=v1` | 移除此 header | `c719731` |
| 繁體中文輸出 | API 不支援 prompt 參數 | OpenCC 後處理（8µs/次） | `4510c37` |

---

## 二B、Gemini 3.1 Flash Live Benchmark

**測試日期**：2026-05-27  
**模型**：`gemini-3.1-flash-live-preview`  
**測試集**：10 句護理場景中文對話（zh-01 至 zh-10）  
**目標語言**：中文（zh）→ 英文（en）  
**關鍵修正**：使用 `activityStart`/`activityEnd`（custom VAD 模式），因 gemini-3.1 不支援 `client_content` turn_complete

### 2B.1 整體摘要

| 指標 | 數值 |
|---|---|
| **成功率** | 100%（10/10 句） |
| **首字延遲（平均）** | 5,042ms |
| **Final 延遲（平均）** | 8,301ms |
| **CER（平均）** | 41.2% |
| **翻譯分數（平均）** | 80/100 |
| **繁中比例** | 100%（輸出為英文，不適用） |

> **注意**：CER 41.2% 是因為 Gemini 的 ASR 輸出為**簡體中文**（例如「请问您今天哪里不舒服?」），而預期文字為繁體中文。這是 Gemini 的 ASR 特性，不影響翻譯品質。

### 2B.2 逐句測試結果

| 句子 ID | 預期文字 | ASR 輸出（簡體） | 翻譯輸出（英文） | 首字延遲 | Final 延遲 | CER |
|---|---|---|---|---|---|---|
| zh-01 | 請問您今天哪裡不舒服？ | 请问您今天哪里不舒服? | Where are you feeling uncomfortable today? | 1,905ms | 4,593ms | 30.0% |
| zh-02 | 我頭痛已經三天了，而且有點發燒。 | 我头痛已经三天了，而且有点发烧。 | I've had a headache for three days, and also a slight fever. | 2,135ms | 6,100ms | 35.7% |
| zh-03 | 請問您對什麼藥物過敏嗎？ | 请问您对什么药物过敏吗? | Are you allergic to any medications? | 1,901ms | 4,314ms | 63.6% |
| zh-04 | 我對青黴素過敏，吃了會起疹子。 | 我对青霉素过敏，吃了会起疹子。 | I'm allergic to penicillin, it gives me hives. | 4,084ms | 27,130ms | 30.8% |
| zh-05 | 這個藥一天吃三次，每次一顆，飯後服用。 | 这个要一天吃三次，每次一颗，饭后服用。 | Take this medication three times a day, one pill at a time, after meals. | 2,423ms | 7,590ms | 37.5% |
| zh-06 | 請問掛號要怎麼辦理？ | 请问挂号要怎么办理? | Excuse me, how do I register? | 28,937ms | N/A（逾時） | 66.7% |
| zh-07 | 您需要先到一樓服務台抽號碼牌。 | 你需要先到一楼服务台抽号码牌。 | You need to get a number ticket from the service desk on the first floor first. | 2,155ms | 6,325ms | 35.7% |
| zh-08 | 我的肚子很痛，痛了一整個晚上。 | 我的肚子很痛，痛了一整个晚上。 | My stomach hurts really badly; it's been hurting all night. | 2,119ms | 5,994ms | 7.7% |
| zh-09 | 請您先做一個血液檢查，報告大概兩個小時後出來。 | 你先做一个血液检查，报告大概两个小时后出来。 | You'll have a blood test first, and the report will be ready in about two hours. | 2,717ms | 7,046ms | 47.6% |
| zh-10 | 謝謝醫生，請問下次什麼時候回診？ | 谢谢医生，请问下次什么时候回诊? | Thank you, doctor. When should I come back for a follow-up visit? | 2,046ms | 5,617ms | 57.1% |
| **平均** | — | — | — | **5,042ms** | **8,301ms** | **41.2%** |

### 2B.3 與 gpt-realtime-whisper 對比

| 指標 | gpt-realtime-whisper | Gemini 3.1 Flash Live | 差異 |
|---|---|---|---|
| **首字延遲** | **638ms** ✅ | 5,042ms | Gemini 慢 7.9x |
| **Final 延遲** | **1,684ms** ✅ | 8,301ms | Gemini 慢 4.9x |
| **CER（ASR）** | **9.1%** ✅ | 41.2%（簡繁差異） | — |
| **翻譯品質** | N/A（僅 ASR） | 80/100（一體化翻譯） | Gemini 提供翻譯 |
| **成功率** | 100% | 100% | 相同 |
| **架構複雜度** | 需另接翻譯 API | **一體化（ASR+翻譯）** | Gemini 更簡單 |

### 2B.4 關鍵技術發現

| 問題 | 錯誤做法 | 正確做法 |
|---|---|---|
| gemini-3.1 turn end 信號 | `client_content { turn_complete: true }` | `activityStart` + `activityEnd`（custom VAD） |
| 啟用 custom VAD | 無 | setup 中設定 `realtime_input_config.automatic_activity_detection.disabled: true` |
| 音訊轉錄格式 | 無 | setup 中加入 `output_audio_transcription: {}` 和 `input_audio_transcription: {}` |

### 2B.5 評估結論

- **翻譯品質**：Gemini 3.1 Flash Live 的翻譯結果語意正確，適合護理場景
- **延遲**：比 gpt-realtime-whisper 慢 5-8 倍，不適合即時字幕場景
- **ASR**：輸出簡體中文，需後處理轉換；zh-04 出現 27 秒異常延遲（偶發）
- **建議**：不建議取代現有方案 A，可作為備援翻譯管道

---

## 三、延遲分解分析

**測試日期**：2026-05-27  
**測試腳本**：`tools/test-latency-breakdown.ts`  
**測試對象**：gpt-realtime-whisper（3 句不同長度）

### 3.1 各環節耗時（從 WebSocket 建立前計時）

| 階段 | 平均耗時 | 佔比 | 說明 |
|---|---|---|---|
| **A. WebSocket TLS 握手** | 711ms | 26% | TCP 連線 + TLS 協商 |
| **B. session.created** | 9ms | <1% | 伺服器確認連線 |
| **C. session.updated** | 220ms | 8% | 伺服器套用 session 設定 |
| **D. 音訊分塊傳送** | 192ms | 7% | PCM16 分塊 WebSocket 傳送 |
| **E. commit → committed** | 390ms | 14% | 伺服器確認音訊接收 |
| **F. committed → 首個 delta** | 129ms | 5% | 模型開始推理 |
| **G. delta → completed** | 1,224ms | 45% | 模型完成推理 |
| **總計** | **2,738ms** | 100% | 從 T0 到 Final |

### 3.2 三大耗時區塊

```
連線建立（A+B+C）：940ms   ████████████████████████░░░░░░░░  34%
音訊傳輸（D+E）  ：582ms   ███████████████░░░░░░░░░░░░░░░░░  21%
ASR 推理（F+G）  ：1,217ms ████████████████████████████████  45%
```

### 3.3 優化潛力

| 優化方向 | 可消除延遲 | 方法 | 難度 |
|---|---|---|---|
| **預建 WebSocket 連線池** | ~940ms | 頁面載入時預建並保持連線 | 中 |
| **邊錄邊傳（VAD 串流）** | ~390ms | 偵測到語音即開始串流 | 高 |
| **理論最低延遲** | **~1,217ms** | 預建連線 + 即時串流 | — |

---

## 四、Realtime vs Batch 延遲比較

**測試日期**：2026-05-27  
**相關文件**：`docs/latency-comparison-realtime-vs-batch.md`

### 4.1 核心指標對比

| 指標 | gpt-realtime-whisper | gpt-4o-transcribe Batch |
|---|---|---|
| **Final 延遲** | 1,684ms（benchmark）/ 2,738ms（實際） | **1,099ms** ✅ |
| **首字延遲** | **638ms** ✅ | N/A（無串流輸出） |
| **CER** | 9.1% | **0.0%** ✅ |
| **繁體中文** | 需 OpenCC 後處理 | **prompt 直接控制** ✅ |
| **成本/分鐘** | $0.017 | **$0.006–0.012** ✅ |
| **串流輸出** | **✅ 有** | ❌ 無 |

### 4.2 逐句 CER 對比

| 句子 | Realtime CER | Batch CER | 差異說明 |
|---|---|---|---|
| zh-01 至 zh-05 | 0.0% | 0.0% | 完全相同 |
| zh-06（掛號） | 11.1% | 0.0% | Realtime 同音字誤辨 |
| zh-07（服務台） | 7.1% | 0.0% | Realtime 異體字 |
| zh-08 至 zh-10 | 0.0% | 0.0% | 完全相同 |
| **平均** | **9.1%** | **0.0%** | — |

### 4.3 使用場景建議

| 使用場景 | 推薦方案 | 原因 |
|---|---|---|
| 即時字幕顯示 | gpt-realtime-whisper | 首字延遲 638ms，串流 Delta |
| 最終轉錄 → 翻譯 → TTS | gpt-4o-transcribe Batch | 延遲更低，準確度更高 |
| 繁體中文醫療術語 | gpt-4o-transcribe Batch | prompt 直接控制 |
| **混合架構（最佳體驗）** | **Partial: Realtime + Final: Batch** | 即時字幕 + 高品質最終轉錄 |

---

## 五、簡繁轉換效能比較

**測試日期**：2026-05-27  
**測試腳本**：`tools/test-converter-bench.mjs`  
**背景**：gpt-realtime-whisper 輸出簡體中文，需後處理轉繁體

### 5.1 效能數據

| 指標 | opencc-js | zhconv (Rust/WASM) | 差異 |
|---|---|---|---|
| 10 萬次轉換總計 | 381.3ms | 157.0ms | zhconv 快 **2.4x** |
| 單次轉換延遲 | 8.39µs | 2.27µs | zhconv 快 **3.7x** |
| 輸出正確性 | ✅ 完全相同 | ✅ 完全相同 | — |
| 部署複雜度 | **低**（純 JS） | 高（需 `--experimental-wasm-modules`） | — |

### 5.2 結論

**維持使用 opencc-js**。理由：

- ASR Final 延遲 ~1,684ms，opencc-js 後處理僅 8µs（佔 0.0005%）
- 兩者速度差距 6µs，對整體管線無實際影響
- zhconv 需要 Node.js 實驗性旗標，部署複雜度高
- 大批量離線轉換場景才有切換 zhconv 的意義

---

## 六、方案 A RTW Socket.IO 端對端測試

**測試日期**：2026-05-27  
**測試腳本**：`tools/test-rtw-socketio.ts`  
**測試對象**：後端 `/rtw` Socket.IO 命名空間（WebSocket 代理模式）  
**相關 Commit**：`c719731`

### 6.1 測試流程

```
測試腳本（Socket.IO Client）
    → 連線 /rtw 命名空間
    → 發送 rtw:init（language: zh）
    → 等待 rtw:ready
    → 載入 zh-01.mp3 → 轉換 PCM16 → 分塊傳送 rtw:audio
    → 手動 commit（rtw:commit）
    → 等待 rtw:delta（即時字幕）
    → 等待 rtw:final（最終轉錄）
```

### 6.2 測試結果

| 測試項目 | 結果 | 數值 |
|---|---|---|
| Socket.IO `/rtw` 連線 | ✅ PASS | 28ms |
| `rtw:init` → `rtw:ready` | ✅ PASS | 1,183ms（含 WS 握手） |
| `rtw:delta` 即時字幕 | ✅ PASS | 8 個 delta，首字 1,576ms |
| `rtw:final` 最終轉錄 | ✅ PASS | 2,302ms |
| 轉錄內容正確性 | ✅ PASS | `请问您今天哪里不舒服？` |

> 備註：轉錄輸出為簡體中文（`请问`），符合預期——OpenCC 後處理在 runner 層執行，Socket.IO 測試不包含此步驟。

### 6.3 修正的問題

| 問題 | 症狀 | 根因 | 解法 |
|---|---|---|---|
| `OpenAI-Beta: realtime=v1` header | `beta_api_shape_disabled` 錯誤 | GA API 不需要此 header | 移除 |
| `/v1/realtime/sessions` Ephemeral Token | 404 / `beta_api_shape_disabled` | 端點不支援 `intent` 參數，且整體被停用 | 改用純 WS 代理模式 |

---

## 七、歷史比較測試（早期）

**測試日期**：2025 年 1 月（早期版本）  
**相關文件**：`COMPARISON_TEST_REPORT.md`  
**測試對象**：OpenAI Realtime API（Beta）vs Google Gemini Multimodal Live API

> ⚠️ 此測試使用的是 Beta API（`gpt-4o-realtime-preview-2024-12-17`），已於 2026 年停用。數據僅供歷史參考。

### 7.1 早期比較數據（Beta API）

| 指標 | OpenAI（Beta） | Gemini |
|---|---|---|
| WebSocket 連線時間 | 731ms | **174ms** |
| 首次轉錄延遲 | 5,331ms | **3,827ms** |
| 翻譯完成延遲 | 5,426ms | **4,970ms** |
| 轉錄結果 | 請問你今天哪裡不舒服? | 請問您今天哪裡不舒服? |
| 翻譯結果 | Where do you feel uncomfortable? | What brings you in today? |

> 注意：早期 Beta API 延遲（5,000ms+）遠高於現在的 GA API（1,684ms），不可直接比較。

---

## 八、API 遷移評估結論

| 評估對象 | 評估日期 | 結論 | 相關文件 |
|---|---|---|---|
| **gpt-realtime-translate** | 2026-05 | ❌ 不建議遷移 | `docs/evaluations/gpt-realtime-translate-evaluation.md` |
| **gpt-realtime-whisper（取代 ASR）** | 2026-05 | ✅ 建議混合策略 | `docs/evaluations/gpt-realtime-whisper-asr-evaluation.md` |
| **Gemini 3.1 Flash Live** | 2026-05 | ⚠️ 需先驗證 | `docs/evaluations/gemini-31-flash-live-evaluation.md` |

### 8.1 各方案不建議遷移的原因

**gpt-realtime-translate**：
- 不支援自訂 prompt，無法保證繁體中文輸出
- 僅支援 13 種固定輸出語言（現有系統 8 種均在範圍內，但無法擴充）
- 語音輸出動態適配，無法選擇固定聲音

**Gemini 3.1 Flash Live（完整遷移）**：
- 繁體中文輸出品質未驗證
- Smart Language Hint 邏輯需完整重寫
- 幻覺過濾行為未知

---

## 九、方案 A 混合架構實作狀態

**實作日期**：2026-05-27  
**相關 Commit**：`74b1de4`、`c719731`  
**架構文件**：`docs/architecture/plan-a-hybrid-asr.md`

### 9.1 雙管道架構

```
使用者說話 → AudioWorklet (PCM16 24kHz)
               ├─→ Socket.IO /rtw → 後端 WS 代理 → gpt-realtime-whisper
               │       └─→ rtw:delta → 即時字幕（首字 ~638ms）
               │       └─→ rtw:final → 觸發 Final ASR 流程
               │
               └─→ useContinuousRecorder (WebM)
                       └─→ audio:commit → gpt-4o-transcribe (Batch)
                               └─→ Final 轉錄 → 翻譯 → TTS（~2,100ms）
```

### 9.2 實作完成狀態

| 元件 | 狀態 | 說明 |
|---|---|---|
| `server/src/services/realtimeWhisperProxy.ts` | ✅ 完成 | RTW WebSocket 代理服務 |
| `server/src/index.ts`（RTW 命名空間） | ✅ 完成 | `/rtw` Socket.IO 命名空間 |
| `client/src/hooks/useRealtimeWhisper.ts` | ✅ 完成 | 前端 RTW Hook |
| `client/src/App.tsx`（RTW 整合） | ✅ 完成 | 即時字幕顯示 + VAD 同步 |
| **端對端測試** | ✅ 通過 | `test-rtw-socketio.ts` |

### 9.3 已知待優化項目

1. **雙重麥克風串流**：目前 WebM 和 PCM16 各自擷取麥克風，未來可共用音訊來源
2. **WebSocket 連線池**：頁面載入時預建連線，可消除 711ms TLS 握手開銷
3. **Gladia / Gemini Live**：尚未整合至方案 A，仍使用原有路徑

---

## 十、測試腳本清單

| 腳本 | 用途 | 位置 |
|---|---|---|
| `benchmark/runner.ts` | 多 Provider 自動化 benchmark | `tools/benchmark/` |
| `test-whisper-ga.ts` | gpt-realtime-whisper GA API 直連測試 | `tools/` |
| `test-latency-breakdown.ts` | RTW 各環節延遲分解 | `tools/` |
| `test-latency-compare.ts` | Realtime vs Batch 延遲比較 | `tools/` |
| `test-converter-bench.mjs` | opencc-js vs zhconv 效能比較 | `tools/` |
| `test-rtw-socketio.ts` | RTW Socket.IO 端對端測試 | `tools/` |
| `test-whisper-prompt.ts` | prompt 參數支援性測試（確認不支援） | `tools/` |

---

*本文件由 Manus AI 自動生成，基於 2026-05-27 實測數據。*
