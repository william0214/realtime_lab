# TTS 測試工具設定指引

本指引說明如何設定 TTS 測試工具，用於測試即時翻譯系統。

---

## 📋 快速開始

### 1. 安裝依賴

```bash
cd tools
npm install
```

### 2. 產生測試語音

```bash
# 標準品質 (較快)
npm run generate

# 高品質 (較慢，適合 Demo)
npm run generate:hd

# 只產生特定語言
npx tsx tts-generator.ts --lang=zh
npx tsx tts-generator.ts --lang=en
npx tsx tts-generator.ts --lang=vi

# 只產生特定句子
npx tsx tts-generator.ts --id=zh-01

# 強制重新產生 (覆蓋現有檔案)
npx tsx tts-generator.ts --force
```

### 3. 開啟播放介面

```bash
npm run serve
```

然後開啟瀏覽器訪問: <http://localhost:3002/audio-player.html>

---

## 🎧 測試方式

### 方法 1：手機播放測試（推薦）

使用 WiFi 連線讓手機播放 TTS 音訊，Mac 麥克風接收：

1. 確保手機和 Mac 連接同一 WiFi 網路
2. 在手機瀏覽器開啟 `http://<Mac-IP>:3002/audio-player.html`
3. 在 Mac 開啟翻譯系統 `http://localhost:5173`
4. 翻譯系統點擊「開始錄音」
5. 手機播放測試語音，Mac 麥克風接收

### 方法 2：外放喇叭測試

1. 在 Mac 開啟 TTS 播放器 `http://localhost:3002/audio-player.html`
2. 在另一台設備或手機開啟翻譯系統
3. Mac 播放 TTS 語音，另一台設備麥克風接收

### 驗證流程

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────┐
│ TTS 播放器  │ → │ 喇叭/手機播放     │ → │ 麥克風接收   │
│ (手機/Mac)  │    │                  │    │ (翻譯系統)  │
└─────────────┘    └──────────────────┘    └─────────────┘
```

---

## 📁 檔案結構

```
tools/
├── package.json           # 依賴設定
├── tts-generator.ts       # TTS 產生腳本
├── test-sentences.json    # 測試句庫 (60 句)
├── audio-player.html      # 瀏覽器播放介面
├── SETUP.md               # 本說明文件
└── audio/                 # 產生的音檔
    ├── manifest.json      # 音檔清單
    ├── zh-01.mp3         # 中文句子 1
    ├── en-01.mp3         # 英文句子 1
    ├── vi-01.mp3         # 越南文句子 1
    ├── id-01.mp3         # 印尼文句子 1
    ├── th-01.mp3         # 泰文句子 1
    ├── ja-01.mp3         # 日文句子 1
    └── ...
```

---

## 🎙️ 語音設定

### 預設語音配置

| 語言 | 語音 | 描述 |
|------|------|------|
| 中文 (zh) | nova | 女性、友善 |
| 英文 (en) | alloy | 中性、平衡 |
| 越南文 (vi) | shimmer | 女性、清晰 |
| 印尼文 (id) | echo | 男性、溫暖 |
| 泰文 (th) | fable | 英式、敘事 |
| 日文 (ja) | nova | 女性、友善 |

### 可用語音選項

| 語音 ID | 描述 |
|---------|------|
| alloy | 中性、平衡 |
| echo | 男性、溫暖 |
| fable | 英式、敘事 |
| onyx | 男性、深沉 |
| nova | 女性、友善 |
| shimmer | 女性、清晰 |

要修改語音，編輯 `test-sentences.json` 中的 `voices` 區塊。

---

## 🐛 常見問題

### Q: 產生語音時出現 API 錯誤

確認 `server/.env` 中有設定正確的 `OPENAI_API_KEY`。

### Q: 播放聲音但翻譯系統沒有反應

1. 確認翻譯系統已開始錄音
2. 確認麥克風有接收到聲音
3. 檢查音量是否足夠
4. 確認 Server 已連接 OpenAI Realtime API

### Q: 手機無法連線到播放器

1. 確認手機和 Mac 在同一 WiFi 網路
2. 使用 `ifconfig | grep inet` 查看 Mac IP 地址
3. 確認防火牆沒有阻擋 port 3002

---

## 📝 測試句子內容

目前包含 60 句醫療情境對話：

- **中文 (zh-01 ~ zh-10)**: 醫生問診、病人描述症狀、開藥說明
- **英文 (en-01 ~ en-10)**: 同上英文版本
- **越南文 (vi-01 ~ vi-10)**: 同上越南文版本
- **印尼文 (id-01 ~ id-10)**: 同上印尼文版本
- **泰文 (th-01 ~ th-10)**: 同上泰文版本
- **日文 (ja-01 ~ ja-10)**: 同上日文版本

每句都有對應的中文對照，方便測試驗證翻譯結果。

- **越南文 (vi-01 ~ vi-10)**: 同上越南文版本

如需新增句子，編輯 `test-sentences.json` 後重新執行 `npm run generate`。

---

**最後更新**: 2025-12-14
