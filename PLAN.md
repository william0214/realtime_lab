# 實作計畫：會議小幫手 — Phase A（全 Gemini 架構）

> 最後更新：2026-04-01（Step 8 完成，expandGlossary.ts 完成）

## 目標

將現有即時語音翻譯系統改造為**多領域會議助手**。  
Phase A 採全 Gemini 架構（Live API + function calling RAG），包裝成 Electron 桌面應用，  
支援系統音訊擷取、專業領域術語 RAG、意圖改寫翻譯、信心度標記、會議摘要。

---

## 決策記錄

| 項目 | 決策 |
|------|------|
| 多領域 | 6 個領域（醫療/法律/金融/科技/商務/通用），手動選擇，自動偵測預留介面 |
| UI 標籤 | 依領域動態切換（醫療=醫生/病人，法律=律師/當事人…） |
| 翻譯模式 | 重度專業改寫（猜意圖、去口語、專業用語），不確定時加 ⚠️ |
| 前端顯示 | 只顯示改寫後翻譯 |
| 安全規則 | 先通用（數字保真、禁止捏造），之後擴充領域專用規則 |
| 音訊擷取 | Electron desktopCapturer（系統音訊）+ 麥克風 |
| 架構 | 先完成 A（全 Gemini），B（Gemini ASR + GPT-4o）之後做 |
| 成本目標 | ~$0.43/場（1 小時會議） |
| 向量資料庫 | 自建輕量 VectorStore（OpenAI embedding + JSON 檔持久化，不需外部 DB） |

---

## 進度總覽

```
階段 1：多領域基礎設施    [████████████████████] 100%  ✅ 全部完成
階段 2：RAG 向量資料庫     [████████████████████] 100%  ✅ 全部完成
階段 3：Electron 桌面應用  [████████████████████] 100%  ✅ 全部完成
階段 4：會議摘要           [████████████████████] 100%  ✅ 全部完成
```

---

## TODO List

### 階段 1：多領域基礎設施 — ✅ 完成

- [x] **Step 1**：定義領域配置系統
  - 建立 `server/src/services/domainService.ts`
  - 定義 `DomainCode` 型別：6 個領域
  - 每個領域含 `name`, `nameEn`, `icon`, `speakerLabels`, `promptFragment`, `safetyHint`
  - 匯出 `getDomainConfig()`, `getAllDomains()`, `getCommonSafetyRules()`

- [x] **Step 2**：改寫所有醫療硬編碼 Prompt
  - `translationService.ts`：`getFullTranslationPrompt()` 接收 domain，動態生成意圖改寫 + confidence JSON prompt
  - `geminiRealtimeClient.ts`：`buildInstructions()` 移除「醫療場域」，加入動態領域提示
  - `openaiRealtimeClient.ts`：同上
  - `translateText()` 回傳 `{translation, confidence}` 結構

- [x] **Step 3**：更新前端領域切換 UI
  - `App.tsx`：domain 狀態 + 下拉選單 + 動態 speaker labels
  - `useSocket.ts`：`config:update` 傳送 domain
  - `server/index.ts`：SocketConfig 加入 `domain: DomainCode`、新增 `/api/domains` endpoint

- [x] **Step 4**：翻譯結果加入 confidence 欄位
  - `types.ts`：`TranslationResult` 加 `confidence`
  - `useSocket.ts`：`TranslationEntry` 加 `confidence`
  - `App.tsx`：非 high confidence 顯示 ⚠️ 圖示 + tooltip
  - 所有 169 個既有測試通過 ✅

### 階段 2：RAG 向量資料庫 — ✅ 完成

- [x] **Step 5**：建立 VectorStore 服務
  - 建立 `server/src/services/vectorStore.ts`
  - 使用 OpenAI `text-embedding-3-small`（256 維）
  - 餘弦相似度搜尋，JSON 檔持久化於 `server/data/vectors/`
  - API：`addEntries()`, `queryGlossary()`, `loadFromDisk()`, `saveToDisk()`

- [x] **Step 6**：建立領域術語種子資料
  - 建立 5 個 glossary JSON（`server/data/glossaries/`）：
    - `medical.json` — 醫療術語（50 筆）
    - `legal.json` — 法律術語（50 筆）
    - `finance.json` — 金融術語（50 筆）
    - `tech.json` — 科技術語（50 筆）
    - `business.json` — 商務術語（50 筆）
  - 每筆格式：`{id, term, termEn, definition, context?, domain}`
  - 建立 `server/src/scripts/seedGlossary.ts`：載入種子資料到 VectorStore

- [x] **Step 7**：RAG 整合到翻譯流程
  - `geminiRealtimeClient.ts`：setup message 加入 `tools` + `lookup_glossary` function declaration
  - `buildInstructions()` 加入 RAG 提示（偵測術語時呼叫 lookup_glossary）
  - 新增 `sendToolResponse()` 方法處理 Gemini function call 回應
  - `handleMessage()` 解析 `toolCall.functionCalls` 並 emit `tool_call` 事件
  - `server/index.ts`：監聽 `tool_call` 事件 → 查詢 VectorStore → 回傳結果
  - `translationService.ts`：`translateText()` 接受 `glossaryHints` 參數
  - `getFullTranslationPrompt()` 注入「參考術語」區塊到 prompt
  - `server/index.ts`：`translateText()` wrapper 自動查詢 VectorStore 再翻譯

### 階段 3：Electron 桌面應用 — 🔄 進行中

- [x] **Step 8**：Electron 基礎架構 ✅
  - 安裝 `electron`, `electron-builder`
  - 建立 `client/electron/main.ts`（載入 Vite dev server / 打包 HTML）
  - 建立 `client/electron/preload.ts`（暴露 API 給 renderer）
  - 修改 `package.json`：加入 `electron:dev`, `electron:build` scripts
  - 修改 `vite.config.ts`：支援 Electron renderer 環境

- [ ] **Step 9**：系統音訊擷取 ✅
  - 建立 `client/src/hooks/useSystemAudio.ts`
  - 使用 Electron `desktopCapturer` API 擷取系統音訊
  - 修改 `useContinuousRecorder.ts`：支援外部 MediaStream
  - 新增 `audioSource: 'microphone' | 'system' | 'both'` 參數

- [x] **Step 10**：雙音訊流整合 ✅
  - 系統音訊 → ASR（對方說的話）
  - 麥克風 → ASR（你說的話）
  - Server 區分兩路 speaker label
  - `audio:chunk` 事件加入 `source: 'mic' | 'system'` 欄位

### 階段 4：會議摘要 — ✅ 完成

- [x] **Step 11**：會議記錄累積 ✅
  - 建立 `server/src/services/meetingService.ts`
  - API：`startMeeting()`, `addUtterance()`, `getMeetingTranscript()`, `endMeeting()`
  - 儲存完整逐字稿（speaker + sourceText + translatedText + timestamp）

- [x] **Step 12**：摘要生成 ✅
  - `meetingService.ts` 加入 `generateSummary(domain)`
  - 使用 Gemini REST API（非 Live）送完整逐字稿
  - 根據領域生成結構化摘要：`{summary, keyPoints[], actionItems[], duration}`
  - 前端：Socket 事件 `meeting:start/end/summarize` → `useSocket.ts` 整合

---

## 檔案變更總覽

### 已修改檔案

| 檔案 | 變更內容 | 狀態 |
|------|----------|------|
| `server/src/services/translationService.ts` | domain 參數、意圖改寫 prompt、JSON `{translation, confidence}` 輸出 | ✅ |
| `server/src/realtime/geminiRealtimeClient.ts` | domain 屬性、動態 buildInstructions()、移除醫療硬編碼 | ✅ |
| `server/src/realtime/openaiRealtimeClient.ts` | 同上 | ✅ |
| `server/src/realtime/types.ts` | `TranslationResult` + `confidence`、`IRealtimeClientOptions` + `domain` | ✅ |
| `server/src/realtime/index.ts` | Factory 傳遞 domain | ✅ |
| `server/src/index.ts` | SocketConfig + domain、`/api/domains` endpoint、confidence 傳遞 | ✅ |
| `client/src/hooks/useSocket.ts` | TranslationEntry + confidence、updateConfig + domain | ✅ |
| `client/src/App.tsx` | domain 下拉選單、動態 speaker labels、⚠️ confidence 指示器 | ✅ |

### 已新增檔案

| 檔案 | 用途 | 狀態 |
|------|------|------|
| `server/src/services/domainService.ts` | 6 領域配置、speaker labels、prompt fragments | ✅ |
| `server/src/services/vectorStore.ts` | 輕量 RAG 向量資料庫（OpenAI embedding + JSON） | ✅ |
| `server/data/glossaries/*.json` | 7 領域術語種子資料（各 50 筆，含 aviation）| ✅ |
| `server/src/scripts/seedGlossary.ts` | 術語載入腳本 | ✅ |
| `server/src/scripts/expandGlossary.ts` | 全自動術語擴充（LLM + Wikidata + MeSH）| ✅ |

### 待新增檔案

| 檔案 | 用途 | 階段 |
|------|------|------|
| `server/src/services/meetingService.ts` | 會議記錄與摘要 | 階段 4 |
| `client/electron/main.ts` | Electron 主程序 | ✅ |
| `client/electron/preload.ts` | Electron preload script | ✅ |
| `client/electron/tsconfig.json` | Electron 專用 TypeScript 設定 | ✅ |
| `client/src/electron.d.ts` | window.electronAPI 型別宣告 | ✅ |
| `client/src/hooks/useSystemAudio.ts` | 系統音訊擷取 | ✅ |
| `server/src/services/meetingService.ts` | 會議記錄與摘要 | ✅ |

---

## 驗證清單

| # | 驗證項目 | 狀態 |
|---|---------|------|
| 1 | 領域切換：UI 選不同領域 → 標籤動態變化 → prompt 含對應領域上下文 | ✅ |
| 2 | 意圖改寫：口語輸入 → 翻譯輸出專業改寫句 + confidence | ✅ |
| 3 | RAG：專業術語 → VectorStore 被查詢 → 翻譯使用正確術語 | ✅ (需 seed) |
| 4 | Electron：`npm run electron:dev` → 桌面視窗正常 → 錄音正常 | ✅ (Step 8 完成) |
| 5 | 系統音訊：播放音訊 → Electron 擷取 → ASR 產出文字 | ✅ (Step 9/10 完成) |
| 6 | 會議摘要：錄音結束 → 生成摘要 → 顯示結構化摘要 | ✅ (Step 11/12 完成) |
| 7 | 全部測試通過：`cd server && npm test` + `cd client && npm test` | ✅ (169/169) |
| 8 | 成本驗證：1 小時模擬會議 → API 成本 < $0.50 | ⬚ |

---

## 排除範圍（Phase A 不做）

- Phase B 混合架構（Gemini ASR + GPT-4o 翻譯）
- Speaker Diarization（AI 說話者辨識）— 用雙音訊流代替
- 各領域個別安全規則 — 先用通用規則
- 自動領域偵測 — 先做手動選擇，偵測預留介面
- 移動端 / Web 版 — 只做 macOS Electron
