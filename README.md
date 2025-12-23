# 🎙️ Realtime Lab - 即時語音翻譯實驗室

即時語音翻譯系統，支援 OpenAI Realtime API 與 Google Gemini Multimodal Live API 雙提供者架構，專為醫療場景設計。

[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18+-61DAFB.svg)](https://reactjs.org/)

---

## ✨ 功能特色

- 🎤 **即時語音辨識** - 使用 WebSocket 串流傳輸，低延遲轉錄
- 🌐 **雙語翻譯** - 支援中英雙向即時翻譯
- 🔄 **雙提供者支援** - OpenAI 與 Gemini 可切換
- 🏥 **醫療場景優化** - 針對醫療術語進行優化
- 📝 **打字機效果** - 翻譯結果逐字顯示
- 🔊 **VAD 語音偵測** - 自動偵測語音開始/結束

---

## 🏗️ 專案架構

```
realtime_lab/
├── client/                    # React 前端應用
│   ├── src/
│   │   ├── components/        # UI 元件
│   │   │   └── TranslationBubble.tsx
│   │   ├── hooks/             # React Hooks
│   │   │   ├── useContinuousRecorder.ts
│   │   │   ├── useSocket.ts
│   │   │   └── useTypewriter.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── package.json
│
├── server/                    # Node.js 後端服務
│   ├── src/
│   │   ├── realtime/          # 即時 API 客戶端
│   │   │   ├── openaiRealtimeClient.ts
│   │   │   ├── geminiRealtimeClient.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts       # 工廠模式入口
│   │   ├── services/          # 服務層
│   │   │   ├── translationService.ts
│   │   │   ├── translationCache.ts
│   │   │   ├── vadService.ts
│   │   │   └── whisperService.ts
│   │   ├── utils/
│   │   │   └── audioConverter.ts
│   │   └── index.ts
│   └── package.json
│
├── tools/                     # 測試工具
│   ├── audio/                 # 測試音檔
│   ├── tts-generator.ts       # TTS 音檔生成器
│   └── audio-player.html      # 音檔播放器
│
├── COMPARISON_TEST_REPORT.md  # API 比較測試報告
├── DEMO_GUIDE.md              # Demo 操作指南
├── DEVLOG.md                  # 開發日誌
└── start-demo.sh              # 一鍵啟動腳本
```

---

## 🚀 快速開始

### 環境需求

- Node.js 20+
- npm 或 yarn
- OpenAI API Key（用於 OpenAI 提供者）
- Google API Key（用於 Gemini 提供者）

### 1. 安裝依賴

```bash
# 安裝 Server 依賴
cd server
npm install

# 安裝 Client 依賴
cd ../client
npm install
```

### 2. 設定環境變數

在 `server/` 目錄下建立 `.env` 檔案：

```bash
# .env
OPENAI_API_KEY=sk-your-openai-api-key
GOOGLE_API_KEY=AIza-your-google-api-key
REALTIME_PROVIDER=gemini  # 或 openai
PORT=3001

# Gemini 模型配置（可選）
GEMINI_LIVE_MODEL=gemini-3-flash-preview  # 預設值
# 支援的模型：gemini-3-flash-preview, gemini-2.0-flash-exp
# 若模型不支援，會自動 fallback 到 gemini-2.0-flash-exp

# Gemini 語音配置（可選）
GEMINI_VOICE=Kore  # Puck, Charon, Kore, Fenrir, Aoede
```

### 3. 啟動服務

**方法一：使用啟動腳本（推薦）**

```bash
./start-demo.sh
```

**方法二：手動啟動**

```bash
# Terminal 1 - 啟動後端
cd server
npm run dev

# Terminal 2 - 啟動前端
cd client
npm run dev
```

### 4. 開啟瀏覽器

前往 <http://localhost:5173> 開始使用

---

## ⚙️ 提供者比較

| 功能 | OpenAI | Gemini |
|------|--------|--------|
| 連線速度 | ~730ms | ~170ms |
| 音訊格式 | PCM16 24kHz | PCM16 16kHz |
| 自動語言偵測 | ❌ | ✅ |
| VAD 事件 | ✅ 詳細 | ⚠️ 基本 |
| 字面準確度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 翻譯自然度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

> 詳細比較請參閱 [COMPARISON_TEST_REPORT.md](./COMPARISON_TEST_REPORT.md)

---

## 🔧 API 端點

### REST API

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/provider` | 取得當前提供者 |
| POST | `/api/provider` | 切換提供者 |
| GET | `/api/health` | 健康檢查 |

### WebSocket 事件

**Client → Server**

| 事件 | 說明 |
|------|------|
| `audio` | 傳送音訊資料 (Base64) |
| `start-recording` | 開始錄音 |
| `stop-recording` | 停止錄音 |

**Server → Client**

| 事件 | 說明 |
|------|------|
| `transcription` | 轉錄結果 |
| `translation` | 翻譯結果 |
| `speech-started` | 語音開始偵測 |
| `speech-stopped` | 語音結束偵測 |
| `error` | 錯誤訊息 |

---

## 🧪 測試

### 執行單元測試

```bash
# Server 測試
cd server
npm test

# Client 測試
cd client
npm test
```

### 執行診斷測試

```bash
cd server

# OpenAI 語音診斷
npx tsx src/realtime/voice-diagnostic-test.ts

# Gemini 語音診斷
npx tsx src/realtime/gemini-voice-diagnostic-test.ts

# 多語言辨識測試
npx tsx src/realtime/language-detection-test.ts
```

---

## 📁 測試音檔

測試音檔位於 `tools/audio/` 目錄：

| 檔案 | 語言 | 內容 |
|------|------|------|
| `zh-01.mp3` | 中文 | 請問你今天哪裡不舒服？ |
| `en-medical-1.wav` | 英文 | 醫療對話 |
| `ja-greeting.wav` | 日文 | 一般問候 |

### 生成新測試音檔

```bash
cd tools
npx tsx tts-generator.ts
```

---

## 🔍 故障排除

### 常見問題

**1. WebSocket 連線失敗**

```bash
# 檢查後端是否運行
curl http://localhost:3001/api/health
```

**2. 無轉錄結果**

- 確認麥克風權限已開啟
- 檢查音訊格式是否正確（PCM16）
- 查看 Server 端 console 的 VAD 事件

**3. 1005 斷線**

- 通常為網路問題或長時間無音訊
- 系統會自動重連（指數退避）

> 更多診斷資訊請參閱 [COMPARISON_TEST_REPORT.md](./COMPARISON_TEST_REPORT.md) 的 Debug Checklist

---

## 📚 相關文件

| 文件 | 說明 |
|------|------|
| [COMPARISON_TEST_REPORT.md](./COMPARISON_TEST_REPORT.md) | OpenAI vs Gemini 完整測試報告 |
| [DEMO_GUIDE.md](./DEMO_GUIDE.md) | Demo 展示操作指南 |
| [DEVLOG.md](./DEVLOG.md) | 開發日誌與決策記錄 |
| [ROADMAP.md](./ROADMAP.md) | 功能路線圖 |
| [FEATURES_AND_TESTS.md](./FEATURES_AND_TESTS.md) | 功能與測試清單 |

---

## 🛠️ 技術棧

### 前端

- React 18
- TypeScript
- Vite
- Socket.IO Client
- Vitest

### 後端

- Node.js
- TypeScript
- Express
- Socket.IO
- WebSocket (ws)

### AI 服務

- OpenAI Realtime API (`gpt-4o-realtime-preview`)
- OpenAI Transcription (`gpt-4o-mini-transcribe`)
- Google Gemini Multimodal Live API (`gemini-2.0-flash-exp`)

---

## 📄 授權

MIT License

---

## 🤝 貢獻

歡迎提交 Issue 或 Pull Request！

---

*Made with ❤️ for healthcare translation*
