# 📖 會議小幫手 — 完整使用手冊

> 版本：Phase A（全 Gemini 架構）｜更新：2026-04-01

---

## 目錄

1. [系統概覽](#1-系統概覽)
2. [安裝與設定](#2-安裝與設定)
3. [快速啟動](#3-快速啟動)
4. [操作介面說明](#4-操作介面說明)
5. [核心功能使用](#5-核心功能使用)
   - 5.1 [即時語音翻譯](#51-即時語音翻譯)
   - 5.2 [領域切換](#52-領域切換)
   - 5.3 [系統音訊擷取（Electron）](#53-系統音訊擷取electron)
   - 5.4 [會議記錄與摘要](#54-會議記錄與摘要)
6. [術語庫管理（開發者）](#6-術語庫管理開發者)
7. [Electron 桌面應用](#7-electron-桌面應用)
8. [環境變數參考](#8-環境變數參考)
9. [故障排除](#9-故障排除)
10. [常見問題 FAQ](#10-常見問題-faq)

---

## 1. 系統概覽

會議小幫手是一套**即時雙向語音翻譯系統**，主要用途：

| 場景 | 說明 |
|------|------|
| 醫療問診 | 醫生（中文）↔ 外籍病人（英文），自動翻譯 |
| 法律諮詢 | 律師 ↔ 當事人，正式用語翻譯 |
| 商務會議 | 多語言與會者即時字幕翻譯 |
| 航空通話 | 機組 ↔ 航管術語翻譯 |
| 遠端會議 | 系統音訊擷取，翻譯遠端說話者 |

**翻譯流程：**

```
麥克風/系統音訊
    ↓ WebM/Opus（瀏覽器錄製）
Server（ffmpeg 轉 PCM16）
    ↓
Gemini Live API（ASR + 串流翻譯）
    ↓ 同時
VectorStore（RAG 術語查詢）→ 注入翻譯 Prompt
    ↓
GPT-4o-mini（最終高品質翻譯 + confidence）
    ↓
前端顯示（打字機效果 + ⚠️ 低信心提示）
    ↓（若有進行中會議）
MeetingService（加入逐字稿）
```

---

## 2. 安裝與設定

### 2.1 系統需求

| 項目 | 需求 |
|------|------|
| Node.js | 20 以上 |
| npm | 9 以上 |
| ffmpeg | 必要（音訊轉換） |
| OpenAI API Key | 翻譯 + Embedding |
| Google API Key | Gemini ASR + 會議摘要 |

安裝 ffmpeg：

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
```

### 2.2 安裝依賴

```bash
git clone <repo>
cd realtime_lab

cd server && npm install
cd ../client && npm install
```

### 2.3 設定環境變數

在 `server/` 建立 `.env`（參考 `.env.example`）：

```bash
# 必填
OPENAI_API_KEY=sk-...          # 翻譯 (gpt-4o-mini) + Embedding
GOOGLE_API_KEY=AIza-...        # Gemini Live API (ASR)
GEMINI_API_KEY=AIza-...        # Gemini REST API (摘要)，可與上方相同
REALTIME_PROVIDER=gemini       # 或 openai

# 選填
PORT=3001
GEMINI_LIVE_MODEL=gemini-2.0-flash-exp
GEMINI_SUMMARY_MODEL=gemini-2.0-flash
GEMINI_VOICE=Kore              # Puck / Charon / Kore / Fenrir / Aoede
```

> ⚠️ 永遠不要將 `.env` 提交到 Git。`.gitignore` 已包含此檔案。

---

## 3. 快速啟動

### 方法 A：一鍵腳本（推薦）

```bash
./start-demo.sh
```

開啟 <http://localhost:5173>

### 方法 B：手動啟動

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm run dev
```

### 方法 C：Electron 桌面應用

```bash
cd client && npm run electron:dev
```

---

## 4. 操作介面說明

```
┌─────────────────────────────────────────┐
│  🎙️ 會議小幫手                  [領域 ▾] │
│  ● Gemini Connected                      │
├──────────────┬──────────────────────────┤
│  醫生        │  Patient                 │
│  ─────────   │  ─────────               │
│  [原文泡泡]  │  [翻譯泡泡]             │
│              │                          │
│  [原文泡泡]  │  [翻譯泡泡] ⚠️           │
├──────────────┴──────────────────────────┤
│  [🎤 開始錄音]  [📋 開始會議]  [摘要]   │
└─────────────────────────────────────────┘
```

| 元素 | 說明 |
|------|------|
| **領域下拉選單** | 切換 7 個專業領域，動態更新說話者標籤與 Prompt |
| **左欄（說話者 A）** | 本地說話者（麥克風） |
| **右欄（說話者 B）** | 翻譯結果或遠端說話者（系統音訊） |
| **⚠️ 圖示** | 翻譯信心度為 medium/low，請人工確認 |
| **🎤 開始/停止錄音** | 開始連續錄音並串流到後端 |
| **📋 開始/結束會議** | 啟動會議記錄功能 |
| **摘要** | 觸發 Gemini 生成結構化摘要 |

---

## 5. 核心功能使用

### 5.1 即時語音翻譯

**基本流程：**

1. 選擇正確的**來源語言**和**目標語言**（界面頂部）
2. 選擇**領域**（右上角下拉選單）
3. 點擊「**🎤 開始錄音**」
4. 開始說話，翻譯結果會以打字機效果顯示
5. 對方說話（偵測到目標語言）時自動切換方向並顯示在右欄
6. 點擊「**停止錄音**」結束

**信心度指示：**

| 標記 | 意義 |
|------|------|
| 無標記 | 高信心（high），譯文可信 |
| ⚠️ | 中/低信心，建議人工確認 |

### 5.2 領域切換

領域切換會同步：
- 說話者標籤（左/右欄名稱）
- 翻譯 Prompt（加入領域專業上下文）
- RAG 查詢範圍（只查詢該領域術語庫）
- Gemini Live 指令（加入領域知識）

**切換方式：** 點擊右上角領域選單 → 選擇領域 → 立即生效

> 切換領域**不需要**重新連線或重啟錄音。

### 5.3 系統音訊擷取（Electron）

在 **Electron 桌面模式**下可擷取系統播放的音訊（例如遠端會議對方的聲音）：

1. 用 `npm run electron:dev` 或 `npm run electron:build` 啟動
2. 音訊來源選擇器出現（僅 Electron 下可見）
3. 點擊「選擇系統音訊來源」→ 選擇目標視窗或螢幕
4. 啟用後：
   - **麥克風** = 本地說話者（正向翻譯）
   - **系統音訊** = 遠端說話者（反向翻譯）
   - 兩路分開辨識，自動標記說話者

> 瀏覽器模式不支援系統音訊擷取，僅能使用麥克風。

### 5.4 會議記錄與摘要

**開始會議：**

1. 先選好領域
2. 點擊「**📋 開始會議**」
3. 系統開始累積所有翻譯紀錄（含原文、譯文、說話者、時間戳）

**結束並取得摘要：**

1. 點擊「**結束會議**」
2. 點擊「**📝 生成摘要**」（呼叫 Gemini REST API）
3. 摘要畫面顯示：

```
📋 會議摘要
─────────────────────────
整體摘要：[2-4 句說明]

重點：
• 重點 1
• 重點 2

行動項目：
• 行動 1

時長：15 分鐘 ｜ 發言：23 次
```

> 摘要生成約需 5-10 秒（取決於逐字稿長度）。  
> 數字、劑量、日期保持原文精確，不會被改寫。

---

## 6. 術語庫管理（開發者）

術語庫位於 `server/data/glossaries/*.json`，每個領域 50+ 筆。

### 6.1 載入術語庫

首次使用前或新增術語後，需載入到 VectorStore：

```bash
cd server

# 載入全部 7 個領域
npx ts-node src/scripts/seedGlossary.ts

# 只載入特定領域
npx ts-node src/scripts/seedGlossary.ts medical
```

### 6.2 手動新增術語

編輯對應的 JSON 檔案，例如 `server/data/glossaries/medical.json`：

```json
{
  "id": "med-051",
  "term": "心房顫動",
  "termEn": "atrial fibrillation (AFib)",
  "definition": "心房不規則跳動的心律不整",
  "context": "病人有心房顫動病史",
  "domain": "medical"
}
```

然後重新執行 `seedGlossary.ts`。

### 6.3 自動擴充術語庫

使用三個來源自動生成新術語：

```bash
cd server

# 預覽（不寫入）
npx ts-node src/scripts/expandGlossary.ts medical --dry-run

# 用 LLM（GPT-4o-mini）擴充醫療領域 20 筆
npx ts-node src/scripts/expandGlossary.ts medical --source=llm

# 用 Wikidata SPARQL 擴充所有領域
npx ts-node src/scripts/expandGlossary.ts --source=wikidata

# 用 MeSH REST API 擴充醫療（免費，無需 key）
npx ts-node src/scripts/expandGlossary.ts medical --source=mesh

# 三個來源全用
npx ts-node src/scripts/expandGlossary.ts --source=all

# 擴充後重新載入
npx ts-node src/scripts/seedGlossary.ts
```

| 來源 | 需要 Key | 適用領域 | 說明 |
|------|---------|---------|------|
| `llm` | OPENAI_API_KEY | 全部 | GPT-4o-mini 生成，最靈活 |
| `wikidata` | 不需要 | 全部 | SPARQL 查詢，免費 |
| `mesh` | 不需要 | 僅醫療 | NLM MeSH API，醫療術語最完整 |

---

## 7. Electron 桌面應用

### 7.1 開發模式

```bash
cd client
npm run electron:dev
# 同時啟動 Vite dev server + Electron
```

### 7.2 編譯 TypeScript

```bash
npm run electron:compile
# 輸出到 dist-electron/main.js, dist-electron/preload.js
```

### 7.3 打包成 .dmg（macOS）

```bash
npm run electron:build
# 輸出到 release/ 目錄
```

### 7.4 Electron 特有功能

| 功能 | 說明 |
|------|------|
| 系統音訊擷取 | `desktopCapturer` API，需選擇視窗/螢幕來源 |
| `window.electronAPI.isElectron` | 判斷是否在 Electron 環境 |
| `window.electronAPI.platform` | 取得作業系統 |
| `window.electronAPI.getDesktopSources()` | 取得可用音訊來源列表 |

---

## 8. 環境變數參考

| 變數 | 必填 | 說明 |
|------|------|------|
| `OPENAI_API_KEY` | ✅ | GPT-4o-mini 翻譯 + text-embedding-3-small |
| `GOOGLE_API_KEY` | ✅ | Gemini Live API |
| `GEMINI_API_KEY` | ✅ | Gemini REST API（摘要），可與上方相同 |
| `REALTIME_PROVIDER` | — | `gemini`（預設）或 `openai` |
| `PORT` | — | 後端埠號，預設 `3001` |
| `GEMINI_LIVE_MODEL` | — | Live 模型，預設 `gemini-2.0-flash-exp` |
| `GEMINI_SUMMARY_MODEL` | — | 摘要模型，預設 `gemini-2.0-flash` |
| `GEMINI_VOICE` | — | 語音角色：`Puck/Charon/Kore/Fenrir/Aoede` |

---

## 9. 故障排除

### 9.1 連線問題

**症狀：** 畫面顯示 `disconnected` 或 `error`

```bash
# 確認後端運行
curl http://localhost:3001/api/health

# 確認 .env 已設定
cat server/.env | grep API_KEY
```

### 9.2 無轉錄結果

**常見原因與排查：**

| 症狀 | 原因 | 解法 |
|------|------|------|
| 錄音按鈕無反應 | 麥克風權限未開啟 | 瀏覽器設定 → 允許麥克風 |
| 有錄音但不轉錄 | ffmpeg 未安裝 | `brew install ffmpeg` |
| 轉錄結果為 `"…"` | 音訊格式不符 / 近似靜音 | 確認 REALTIME_PROVIDER 對應 key |
| `transcription_time = 0ms` | 未收到語音/未觸發 VAD | 調整 `vad.energyThreshold` |

查看 session log：

```bash
ls server/logs/session_*.jsonl
cat server/logs/session_<id>.jsonl | jq '.event_type'
```

### 9.3 1005 WebSocket 斷線

- 原因：長時間無音訊、網路問題、Provider 閒置 timeout
- 系統行為：自動重連（指數退避 1s → 2s → 4s → 最大 30s）
- 若頻繁斷線：縮短錄音間隔或改用 `openai` provider

### 9.4 RAG 術語查詢無效

```bash
# 確認 VectorStore 已初始化
ls server/data/vectors/

# 若目錄空白或缺檔，重新 seed
cd server && npx ts-node src/scripts/seedGlossary.ts
```

### 9.5 摘要生成失敗

- 確認 `GEMINI_API_KEY` 已設定（非 `GOOGLE_API_KEY`）
- 確認有進行中的會議（需先 `meeting:start`）
- 確認逐字稿不為空（至少需有 1 條發言）

### 9.6 Electron 系統音訊無聲

- macOS 需要授予螢幕錄製權限：**系統偏好設定 → 隱私與安全性 → 螢幕錄製 → 允許會議小幫手**
- 選擇音訊來源時，請選**包含音訊的視窗**（非純螢幕截圖）
- 部分應用（例如 Spotify）有 DRM 保護，無法擷取

---

## 10. 常見問題 FAQ

**Q: 支援哪些語言？**

目前經過測試的語言：繁體中文（`zh-TW`）、英文（`en`）、日文（`ja`）、韓文（`ko`）、越南文（`vi`）、印尼文（`id`）、泰文（`th`）。

**Q: 翻譯方向怎麼決定？**

系統自動偵測說話語言。若偵測到目標語言（例如英文），自動切換為反向翻譯（英→中）。使用系統音訊時，系統音訊固定為「對方說話」（反向），麥克風固定為「本地說話」（正向）。

**Q: ⚠️ 標記出現了，該怎麼辦？**

翻譯系統給出 `medium` 或 `low` 信心時顯示。建議：
1. 請說話者重複一次更清晰的發音
2. 對照原文（左欄）手動確認翻譯
3. 若是術語問題，補充到對應領域術語庫

**Q: 會議摘要的數字/劑量會被改寫嗎？**

不會。Prompt 明確要求「數字、日期、劑量必須與逐字稿完全一致」。若發現異常請在 GitHub 開 Issue。

**Q: 可以離線使用嗎？**

不行。ASR（Gemini/OpenAI Realtime API）、翻譯（GPT-4o-mini）和摘要（Gemini REST）均需網路連線。VectorStore 本身是本地的。

**Q: Electron 和瀏覽器模式有何差異？**

| 功能 | 瀏覽器 | Electron |
|------|--------|---------|
| 即時翻譯 | ✅ | ✅ |
| 系統音訊擷取 | ❌ | ✅ |
| 雙音訊流分軌 | ❌ | ✅ |
| 離線打包 | ❌ | ✅ (.dmg) |

**Q: API 費用大概多少？**

1 小時會議（Gemini 提供者）估計 ~$0.43：
- Gemini Live API（ASR）：~$0.30
- GPT-4o-mini（翻譯）：~$0.10
- Gemini REST（摘要，1 次）：~$0.03

---

*更多技術細節請參閱 [PLAN.md](./PLAN.md) 與 [DEVLOG.md](./DEVLOG.md)*
