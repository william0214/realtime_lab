# 🚀 Demo 快速啟動指南

> 一鍵執行 Demo 測試的完整步驟

---

## ⚡ 快速啟動

### 方法 1：一鍵腳本（推薦）

```bash
cd /Users/huangweiyuan/Desktop/program/realtime_lab
./start-demo.sh
```

### 方法 2：手動啟動（3 個終端機）

**終端 1 - Server：**

```bash
cd /Users/huangweiyuan/Desktop/program/realtime_lab/server
npm run dev
```

**終端 2 - Client：**

```bash
cd /Users/huangweiyuan/Desktop/program/realtime_lab/client
npm run dev
```

**終端 3 - TTS 播放器：**

```bash
cd /Users/huangweiyuan/Desktop/program/realtime_lab/tools
npx serve -p 3002
```

---

## 🌐 網址一覽

| 服務 | 網址 | 說明 |
|------|------|------|
| 翻譯系統 | <http://localhost:5173> | 主要 Demo 畫面 |
| TTS 播放器 | <http://localhost:3002/audio-player.html> | 測試語音播放 |
| Server API | <http://localhost:3001> | 後端服務 |

---

## 🎧 測試方式

推薦使用 WiFi 手機播放測試：

1. 手機和 Mac 連接同一 WiFi
2. 手機開啟 TTS 播放器 `http://<Mac-IP>:3002/audio-player.html`
3. Mac 開啟翻譯系統 `http://localhost:5173`
4. 翻譯系統點擊「開始錄音」
5. 手機播放測試語音，Mac 麥克風接收

---

## 🧪 測試流程

### 1️⃣ 啟動所有服務

執行上方快速啟動指令

### 2️⃣ 開啟瀏覽器分頁

- **分頁 1**：<http://localhost:5173> （翻譯系統）
- **分頁 2**：<http://localhost:3002/audio-player.html> （TTS 播放器）

### 3️⃣ 執行測試

1. 在翻譯系統點擊「**開始錄音**」
2. 切換到 TTS 播放器
3. 選擇語言（中文/英文/越南文）
4. 點擊播放按鈕
5. 觀察翻譯系統是否顯示翻譯結果

### 4️⃣ 預期結果

| 播放語言 | 翻譯結果 |
|----------|----------|
| 中文 | 顯示英文翻譯 |
| 英文 | 顯示中文翻譯 |
| 越南文 | 顯示中文翻譯 |

---

## 📋 Demo 情境腳本

### 情境 1：中文 → 英文（醫生問診）

播放順序：

1. `zh-01` - 「請問您今天哪裡不舒服？」
2. `zh-03` - 「請問您對什麼藥物過敏嗎？」
3. `zh-05` - 「這個藥一天吃三次，每次一顆，飯後服用。」

### 情境 2：英文 → 中文（病人回答）

播放順序：

1. `en-02` - "I've had a headache for three days..."
2. `en-04` - "I'm allergic to penicillin..."
3. `en-08` - "I have severe stomach pain..."

### 情境 3：越南文 → 中文

播放順序：

1. `vi-02` - "Tôi bị đau đầu ba ngày rồi..."
2. `vi-08` - "Tôi bị đau bụng rất dữ..."

---

## 🛠️ 故障排除

### 問題：翻譯系統沒有反應

1. 確認 Server 已啟動（終端顯示 `✅ Connected to OpenAI Realtime API`）
2. 確認翻譯系統已點擊「開始錄音」
3. 確認麥克風有接收到聲音

### 問題：Port 衝突

```bash
# 終止佔用的程序
lsof -ti:3001 | xargs kill -9  # Server port
lsof -ti:3002 | xargs kill -9  # TTS 播放器 port
lsof -ti:5173 | xargs kill -9  # Client port
```

### 問題：手機無法連線到播放器

1. 確認手機和 Mac 在同一 WiFi 網路
2. 使用 `ifconfig | grep inet` 查看 Mac IP 地址
3. 確認防火牆沒有阻擋 port 3002

---

## 🔄 重新產生測試語音

如需更新測試句子：

```bash
cd /Users/huangweiyuan/Desktop/program/realtime_lab/tools

# 編輯 test-sentences.json 後執行
npm run generate

# 高品質版本（Demo 用）
npm run generate:hd

# 強制重新產生
npx tsx tts-generator.ts --force
```

---

## 🛑 停止所有服務

```bash
# 停止所有 Demo 相關程序
lsof -ti:3001,3002,5173 | xargs kill -9
```

---

## 📁 相關檔案

| 檔案 | 說明 |
|------|------|
| [tools/test-sentences.json](tools/test-sentences.json) | 測試句子庫 (60 句/6 語言) |
| [tools/audio/](tools/audio/) | 產生的 MP3 檔案 |
| [tools/SETUP.md](tools/SETUP.md) | TTS 工具設定指引 |
| [DEVLOG.md](DEVLOG.md) | 開發日誌 |
| [ROADMAP.md](ROADMAP.md) | 產品發表進度 |

---

**最後更新**：2025-12-14
