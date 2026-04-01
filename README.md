# 🎙️ 會議小幫手 — 即時語音翻譯實驗室

多領域即時語音翻譯系統（**Phase A — 全 Gemini 架構**），支援 OpenAI Realtime API 與 Google Gemini Multimodal Live API 雙提供者，專為專業會議場景設計。

[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18+-61DAFB.svg)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-41+-47848F.svg)](https://www.electronjs.org/)

---

## ✨ 功能特色

- 🎤 **即時語音辨識** — WebSocket 串流，低延遲轉錄
- 🌐 **雙向即時翻譯** — 中英雙向，自動偵測說話方向
- 🏷️ **7 大專業領域** — 醫療 / 法律 / 金融 / 科技 / 商務 / 航空 / 通用，動態切換
- 📚 **RAG 術語 RAG** — 本地向量庫 (OpenAI Embedding)，翻譯自動查詢專業術語
- 🔄 **雙提供者支援** — OpenAI 與 Gemini 可切換
- 🖥️ **Electron 桌面應用** — 支援系統音訊擷取，無須瀏覽器
- 🔊 **雙音訊流** — 麥克風（本地） + 系統音訊（遠端），分軌辨識
- 📝 **打字機效果** — 翻譯結果逐字顯示 + 信心度 ⚠️ 指示
- 📋 **會議摘要** — 逐字稿累積 + Gemini 生成結構化摘要
- 🔊 **VAD 語音偵測** — 自動偵測語音開始/結束

---

## 🏗️ 專案架構

```
realtime_lab/
├── client/                         # React 前端 + Electron
│   ├── electron/
│   │   ├── main.ts                 # Electron 主程序
│   │   └── preload.ts              # Electron preload (系統音訊 API)
│   └── src/
│       ├── components/
│       │   └── TranslationBubble.tsx
│       ├── hooks/
│       │   ├── useContinuousRecorder.ts  # 錄音（mic / system / both）
│       │   ├── useSystemAudio.ts         # 系統音訊擷取 (Electron)
│       │   ├── useSocket.ts              # Socket.IO + 會議管理
│       │   └── useTypewriter.ts
│       └── App.tsx
│
├── server/src/
│   ├── realtime/
│   │   ├── geminiRealtimeClient.ts  # Gemini Live API（含 RAG tool call）
│   │   └── openaiRealtimeClient.ts
│   ├── services/
│   │   ├── domainService.ts         # 7 個領域配置
│   │   ├── translationService.ts    # 翻譯 + 信心度
│   │   ├── vectorStore.ts           # 本地 RAG 向量庫
│   │   └── meetingService.ts        # 會議記錄 + 摘要
│   ├── scripts/
│   │   ├── seedGlossary.ts          # 載入術語種子資料
│   │   └── expandGlossary.ts        # 自動擴充術語（LLM/Wikidata/MeSH）
│   └── data/
│       └── glossaries/              # 7 個領域 JSON 術語庫（各 50+ 筆）
│
└── tools/                           # 測試工具與音檔
```

---

## 🚀 快速開始

### 環境需求

- Node.js 20+
- npm
- ffmpeg（音訊轉換）：`brew install ffmpeg`
- OpenAI API Key（翻譯 + Embedding）
- Google API Key（Gemini Realtime + 會議摘要）

### 1. 安裝依賴

```bash
cd server && npm install
cd ../client && npm install
```

### 2. 設定環境變數

在 `server/` 建立 `.env`：

```bash
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza-...
GEMINI_API_KEY=AIza-...          # 同上，用於會議摘要 REST API
REALTIME_PROVIDER=gemini          # 或 openai
PORT=3001

# 可選
GEMINI_LIVE_MODEL=gemini-2.0-flash-exp
GEMINI_SUMMARY_MODEL=gemini-2.0-flash
GEMINI_VOICE=Kore
```

### 3. 載入術語庫（可選，需 OPENAI_API_KEY）

```bash
cd server
npx ts-node src/scripts/seedGlossary.ts          # 載入全部 7 個領域
npx ts-node src/scripts/seedGlossary.ts medical  # 只載入醫療
```

### 4. 啟動服務

**瀏覽器模式：**

```bash
./start-demo.sh
# 前往 http://localhost:5173
```

**Electron 桌面模式：**

```bash
cd client
npm run electron:dev
```

---

## ⚙️ 提供者比較

| 功能 | OpenAI | Gemini |
|------|--------|--------|
| 連線速度 | ~730ms | ~170ms |
| 音訊格式 | PCM16 24kHz | PCM16 16kHz |
| 自動語言偵測 | ❌ | ✅ |
| RAG function calling | ❌ | ✅ |
| VAD 事件 | ✅ 詳細 | ⚠️ 基本 |
| 字面準確度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 翻譯自然度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

> 詳細比較請參閱 [COMPARISON_TEST_REPORT.md](./COMPARISON_TEST_REPORT.md)

---

## 🏷️ 支援領域

| 領域 | 代碼 | 說話者標籤 |
|------|------|-----------|
| 醫療 | `medical` | 醫生 ↔ 病人 |
| 法律 | `legal` | 律師 ↔ 當事人 |
| 金融 | `finance` | 理專 ↔ 客戶 |
| 科技 | `tech` | 工程師 ↔ 客戶 |
| 商務 | `business` | 業務 ↔ 客戶 |
| 航空 | `aviation` | 簽派/機長 ↔ 航管/組員 |
| 通用 | `general` | 說話者 A ↔ 說話者 B |

---

## 🔧 API 端點

### REST API

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/provider` | 取得當前提供者 |
| POST | `/api/provider` | 切換提供者 |
| GET | `/api/health` | 健康檢查 |
| GET | `/api/domains` | 取得所有領域列表 |

### WebSocket 事件（Client → Server）

| 事件 | Payload | 說明 |
|------|---------|------|
| `audio:chunk` | `{ buffer, source }` | 音訊資料（mic/system） |
| `audio:start` | — | 開始錄音，重置 buffer |
| `audio:commit` | — | 提交音訊，觸發翻譯 |
| `config:update` | `{ sourceLang, targetLang, domain }` | 更新語言與領域 |
| `meeting:start` | `{ domain? }` | 開始會議記錄 |
| `meeting:end` | — | 結束會議 |
| `meeting:summarize` | — | 生成 Gemini 摘要 |
| `meeting:transcript` | — | 取得逐字稿 |

### WebSocket 事件（Server → Client）

| 事件 | 說明 |
|------|------|
| `translate_partial` | 即時翻譯（串流中） |
| `translate_final` | 最終翻譯 + confidence |
| `meeting:started` | 會議已開始 |
| `meeting:ended` | 會議已結束 |
| `meeting:summary` | 結構化摘要 |
| `meeting:error` | 會議操作錯誤 |

---

## 🧪 測試

```bash
cd server && npm test   # 67 tests
cd client && npm test   # 102 tests
```

### 術語自動擴充

```bash
cd server
# 預覽（不寫入）
npx ts-node src/scripts/expandGlossary.ts medical --dry-run

# 用 LLM 擴充所有領域
npx ts-node src/scripts/expandGlossary.ts --source=llm

# 擴充後重新載入 VectorStore
npx ts-node src/scripts/seedGlossary.ts
```

### 診斷測試

```bash
cd server
npx tsx src/realtime/voice-diagnostic-test.ts
npx tsx src/realtime/gemini-voice-diagnostic-test.ts
```

---

## 📁 測試音檔

測試音檔位於 `tools/audio/` 目錄。生成新音檔：

```bash
cd tools && npx tsx tts-generator.ts
```

---

## 🔍 故障排除

| 問題 | 解法 |
|------|------|
| WebSocket 連線失敗 | `curl http://localhost:3001/api/health` 確認後端運行 |
| 無轉錄結果 | 確認麥克風權限 / ffmpeg 已安裝 / 檢查 VAD 事件 log |
| 1005 斷線 | 網路問題，系統自動重連（指數退避） |
| RAG 無效 | 先執行 `seedGlossary.ts` 載入術語庫 |
| 摘要失敗 | 確認 `GEMINI_API_KEY` 已設定 |

> 詳見 [USER_GUIDE.md](./USER_GUIDE.md) 的完整故障排除章節

---

## 📚 相關文件

| 文件 | 說明 |
|------|------|
| [USER_GUIDE.md](./USER_GUIDE.md) | **完整使用手冊**（一般用戶 + 開發者） |
| [PLAN.md](./PLAN.md) | Phase A 實作計畫與進度 |
| [COMPARISON_TEST_REPORT.md](./COMPARISON_TEST_REPORT.md) | OpenAI vs Gemini 完整測試報告 |
| [DEMO_GUIDE.md](./DEMO_GUIDE.md) | Demo 展示操作指南 |
| [DEVLOG.md](./DEVLOG.md) | 開發日誌與決策記錄 |
| [ROADMAP.md](./ROADMAP.md) | 功能路線圖 |

---

## 🛠️ 技術棧

| 層次 | 技術 |
|------|------|
| 前端 | React 18, TypeScript, Vite, Socket.IO Client, Vitest |
| 桌面 | Electron 41, electron-builder |
| 後端 | Node.js, Express, Socket.IO, TypeScript |
| 即時 ASR | OpenAI Realtime API / Gemini Live API (WebSocket) |
| 翻譯 | GPT-4o-mini (full), Gemini Live (streaming) |
| RAG | OpenAI text-embedding-3-small (256d), 本地 JSON 向量庫 |
| 摘要 | Gemini REST API (generateContent) |
| 音訊 | ffmpeg, WebM/Opus → PCM16 轉換 |

---

## 📄 授權

MIT License

---

*即時語音翻譯 × 多領域會議助手 × Electron 桌面應用*
