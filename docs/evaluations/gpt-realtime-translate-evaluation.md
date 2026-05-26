# GPT-Realtime-Translate 遷移評估報告

**專案**：護理推車即時雙向翻譯系統（realtime-translation）  
**評估日期**：2026 年 5 月 11 日  
**評估對象**：OpenAI `gpt-realtime-translate` API  
**評估目的**：分析是否值得將現有 VAD + Whisper ASR + GPT 翻譯架構遷移至新的 Realtime Translate API

---

## 一、GPT-Realtime-Translate 是什麼？

OpenAI 於 2026 年 5 月推出 `gpt-realtime-translate`，這是一個**專為即時語音翻譯設計的串流語音對語音（speech-to-speech）模型**，與一般語音助理模型（如 `gpt-realtime-2`）的定位截然不同。[^1]

> "This model is unique in that it is primarily about **empowering humans to be multilingual as opposed to building AI voice agents**."  
> — OpenAI Cookbook, May 2026

其核心特點如下：

- **專為口譯訓練**：以數千小時的專業口譯員音訊訓練，模型不會「回答問題」，只會「翻譯說話內容」，不會把使用者的話當成指令執行。
- **連續串流輸入輸出**：輸入音訊同時串流輸出翻譯後語音，不需等待說話者停頓，實現真正低延遲。
- **自動語言偵測**：支援超過 70 種輸入語言，自動偵測來源語言，開發者只需指定目標輸出語言。
- **動態語音適配（Dynamic Voice Adaptation）**：輸出語音會跟隨來源說話者的語調、音高和說話風格動態調整，不使用固定語音。

---

## 二、技術架構比較

### 現有系統架構（v2.5.0）

```
麥克風 → VAD（前端 JavaScript）
       → WebM Chunk → Whisper ASR（gpt-4o-transcribe）
       → 文字 → 智慧緩衝合併（Smart Buffer）
       → 翻譯 LLM（gpt-4.1-mini）
       → 翻譯文字顯示
```

**特點**：三段式架構（ASR → 文字緩衝 → 翻譯），每段獨立處理，可精細控制每個環節。

### GPT-Realtime-Translate 架構

```
麥克風 → WebRTC / WebSocket
       → gpt-realtime-translate（雲端，連續串流）
       → 翻譯後語音 + 字幕 Delta（同時輸出）
```

**特點**：單一模型端對端處理，語音直接輸出翻譯後語音，同時提供文字逐字稿。

| 比較項目 | 現有系統（v2.5.0） | GPT-Realtime-Translate |
|---|---|---|
| 架構複雜度 | 三段式（ASR + Buffer + 翻譯） | 單一端對端模型 |
| 輸出形式 | 翻譯文字（無語音輸出） | 翻譯語音 + 文字逐字稿 |
| 延遲特性 | VAD 觸發後約 2-4 秒 | 連續串流，邊說邊翻 |
| 語言偵測 | Whisper 自動偵測 + LLM 二階段 | 模型自動偵測（70+ 語言） |
| 自訂 Prompt | 支援（可加繁體中文規則等） | **不支援**（無法自訂 prompt） |
| 語音選擇 | 無 TTS（純文字顯示） | 動態語音適配（無法選擇固定聲音） |
| 連接端點 | REST API（HTTP POST） | `/v1/realtime/translations`（WebRTC 或 WebSocket） |
| 輸出語言數 | 8 種（可擴充） | **13 種固定輸出語言** |
| 繁體中文控制 | 可強制繁體中文 | **無法控制**（zh 輸出可能為簡體） |

---

## 三、支援語言分析

### 現有系統支援語言（8 種）

英文、越南文、印尼文、菲律賓語、義大利語、日文、韓文、泰文

### GPT-Realtime-Translate 支援輸出語言（13 種）[^2]

`es`（西班牙語）、`pt`（葡萄牙語）、`fr`（法語）、`ja`（日語）、`ru`（俄語）、`zh`（中文）、`de`（德語）、`ko`（韓語）、`hi`（印地語）、`id`（印尼語）、`vi`（越南語）、`it`（義大利語）、`en`（英語）

**對本系統的影響**：現有 8 種語言全部在 GPT-Realtime-Translate 的 13 種支援範圍內，**語言覆蓋率 100%**，不存在語言缺口。

> ⚠️ **繁體中文問題**：GPT-Realtime-Translate 的 `zh` 輸出語言**無法保證繁體中文**，且不支援自訂 prompt，因此無法加入「強制繁體中文」規則。這對本系統是一個**重大限制**，因為現有系統在 `translationProviders.ts` 中已加入嚴格的繁體中文強制規則。

---

## 四、成本比較

### 現有系統成本（每分鐘對話）

| 服務 | 模型 | 計費方式 | 估算（每分鐘） |
|---|---|---|---|
| ASR | gpt-4o-transcribe | $0.006 / 分鐘 | ~$0.006 |
| 翻譯 LLM | gpt-4.1-mini | ~$0.0004 / 1K tokens | ~$0.002-0.004 |
| **合計** | | | **~$0.008-0.010 / 分鐘** |

*假設每分鐘約 150 中文字，翻譯約 200 tokens*

### GPT-Realtime-Translate 成本（每分鐘對話）

| 服務 | 模型 | 計費方式 | 每分鐘費用 |
|---|---|---|---|
| 翻譯 | gpt-realtime-translate | $0.034 / 分鐘 | $0.034 |
| 逐字稿（選用） | gpt-realtime-whisper | $0.017 / 分鐘 | $0.017 |
| **合計（含逐字稿）** | | | **$0.051 / 分鐘** |
| **合計（僅翻譯）** | | | **$0.034 / 分鐘** |

*以 2026 年 5 月匯率 1 USD ≈ 31.4 TWD 換算*

### 成本比較總結

| 方案 | 每分鐘費用（USD） | 每小時費用（USD） | 每小時費用（TWD） |
|---|---|---|---|
| 現有系統 | ~$0.009 | ~$0.54 | ~$17 |
| Realtime Translate（僅翻譯） | $0.034 | $2.04 | ~$64 |
| Realtime Translate（含逐字稿） | $0.051 | $3.06 | ~$96 |

**GPT-Realtime-Translate 成本約為現有系統的 3.8-5.7 倍**。對於護理場景（每日使用數小時），成本差異相當顯著。

---

## 五、延遲與翻譯品質分析

### 延遲

| 指標 | 現有系統 | GPT-Realtime-Translate |
|---|---|---|
| 翻譯觸發機制 | VAD 靜音 2 秒後觸發 | 連續串流，邊說邊翻 |
| 首次翻譯延遲 | 約 2-4 秒（含 ASR + Buffer + 翻譯） | 約 200ms 輸出塊（連續） |
| 適合場景 | 完整句子翻譯（準確優先） | 即時口譯（速度優先） |

GPT-Realtime-Translate 在**延遲**方面具有明顯優勢，特別適合需要即時口譯的場景（如直播、會議）。然而，對於護理場景，**準確性**通常比即時性更重要——護士需要確認完整的病患陳述後再翻譯，而非邊說邊翻。

### 翻譯品質

GPT-Realtime-Translate 以「專業口譯員音訊」訓練，針對口語翻譯優化，特別擅長處理語序差異大的語言對（如中文↔英文）。然而，現有系統使用 `gpt-4.1-mini` 翻譯模型，**可透過 system prompt 精細控制翻譯風格**（如醫療術語、繁體中文），這是 GPT-Realtime-Translate 目前無法做到的。

---

## 六、遷移難度評估

### 技術遷移工作量

| 工作項目 | 難度 | 說明 |
|---|---|---|
| 前端 WebRTC 連接 | 中等 | 需改用 WebRTC 替代現有 VAD + WebM 架構 |
| 後端 Session 管理 | 中等 | 需建立 `/v1/realtime/translations` 連接管理 |
| 移除 VAD 邏輯 | 低 | 不再需要前端 VAD 偵測 |
| 移除 ASR 邏輯 | 低 | 不再需要 Whisper ASR 呼叫 |
| 移除翻譯 LLM 邏輯 | 低 | 不再需要 gpt-4.1-mini 翻譯呼叫 |
| 繁體中文保證 | **高（無解）** | 新 API 不支援自訂 prompt，無法保證繁體中文 |
| 雙向對話架構 | 高 | 需為每個方向建立獨立 session（中→外語、外語→中） |
| 現有 UI 整合 | 中等 | 對話氣泡顯示邏輯需調整 |

### 主要遷移風險

1. **繁體中文無法保證**：這是本系統的核心需求，但 GPT-Realtime-Translate 不支援自訂 prompt，無法加入「強制繁體中文」規則。`zh` 輸出可能混入簡體字。
2. **雙向對話複雜度增加**：護理場景需要中文↔外語雙向翻譯，每個方向需獨立 session，連接管理複雜度倍增。
3. **語音輸出的必要性**：新 API 主要輸出翻譯後的語音，但本系統目前以文字顯示為主。若只需要文字，使用 Realtime Translate 的成本效益較低。
4. **Rate Limit 限制**：Tier 1 帳號每分鐘僅支援 50 分鐘音訊，護理場景若多台設備同時使用可能遇到限制。[^3]

---

## 七、適用場景比較

| 場景 | 現有系統 | GPT-Realtime-Translate |
|---|---|---|
| 護理推車雙向翻譯（文字顯示） | ✅ 最適合 | ⚠️ 過度設計（主要輸出語音） |
| 需要繁體中文 | ✅ 已實作強制規則 | ❌ 無法保證 |
| 醫療術語精確翻譯 | ✅ 可透過 prompt 控制 | ❌ 無法自訂 prompt |
| 即時口譯（邊說邊翻） | ❌ 有 2-4 秒延遲 | ✅ 連續串流 |
| 直播/會議同步口譯 | ❌ 不適合 | ✅ 最適合 |
| 成本控制 | ✅ 低成本 | ❌ 成本高 3-5 倍 |

---

## 八、結論與建議

### 核心結論

**不建議完全遷移至 GPT-Realtime-Translate**，理由如下：

1. **繁體中文無法保證**是本系統的硬性需求，而新 API 無法解決此問題。
2. **成本增加 3-5 倍**，對長時間使用的護理場景影響顯著。
3. **護理場景以文字顯示為主**，不需要語音輸出，使用 Realtime Translate 的核心優勢（語音串流）無法發揮。
4. **現有系統已能滿足需求**：v2.5.0 的智慧緩衝合併機制已大幅改善翻譯品質，延遲在護理場景可接受。

### 建議方案

| 方案 | 說明 | 推薦程度 |
|---|---|---|
| **方案 A：維持現有架構** | 繼續優化 VAD + Whisper + GPT 翻譯架構 | ⭐⭐⭐⭐⭐ **推薦** |
| **方案 B：混合使用** | 現有系統處理中↔外語翻譯（文字），Realtime Translate 僅用於未來可能的語音播放功能 | ⭐⭐⭐ 可考慮 |
| **方案 C：完全遷移** | 放棄繁體中文保證，全面採用 Realtime Translate | ⭐ 不推薦 |

### 短期行動建議

若您仍想評估 GPT-Realtime-Translate 的實際效果，建議：

1. **建立 A/B 測試環境**：在設定頁面加入「Realtime Translate 模式」選項，讓使用者可以切換比較兩種模式的翻譯品質和延遲。
2. **先測試繁體中文輸出**：在正式遷移前，先測試 `zh` 輸出是否符合繁體中文需求。
3. **評估語音播放需求**：若未來計劃加入 TTS 語音播放功能，GPT-Realtime-Translate 的動態語音適配可能是一個加分項。

---

## 參考資料

[^1]: [OpenAI Cookbook - Build Live Translation Apps with gpt-realtime-translate](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide)（May 7, 2026）

[^2]: [OpenAI API Docs - Realtime Translation Guide](https://developers.openai.com/api/docs/guides/realtime-translation)

[^3]: [OpenAI API Docs - gpt-realtime-translate Model](https://developers.openai.com/api/docs/models/gpt-realtime-translate)

[^4]: [OpenAI API Pricing](https://openai.com/api/pricing/)

[^5]: [Yahoo 新聞 - OpenAI 推出 GPT-Realtime-Translate](https://tw.news.yahoo.com/openai-推出-gpt-realtime-translate-231410980.html)（2026 年 5 月 11 日）
