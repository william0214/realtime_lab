# Realtime Lab - 三模型並排比較平台 TODO

## 後端
- [ ] 新增 Ephemeral Token API（/api/session/token）支援三種 session type
- [ ] 建立 tripleCompare 路由，同時管理三個 WebSocket 連線
- [ ] gpt-realtime-2 WebSocket 連線管理（/v1/realtime）
- [ ] gpt-realtime-translate WebSocket 連線管理（/v1/realtime/translations）
- [ ] gpt-realtime-whisper WebSocket 連線管理（/v1/realtime/transcription_sessions）
- [ ] 音訊廣播機制：同一份 PCM16 音訊同時送進三個模型
- [ ] 延遲計時器：記錄每個模型的首字延遲（TTFT）與完整回應延遲
- [ ] Socket.IO 事件：將三模型結果分別推送給前端

## 前端
- [ ] 三欄並排 UI 主框架（深色主題）
- [ ] 麥克風錄音 + PCM16 轉換（AudioWorklet）
- [ ] 語言選擇器（來源語言 + 目標語言）
- [ ] 欄位一：gpt-realtime-2（即時字幕 + 翻譯回應 + 延遲顯示）
- [ ] 欄位二：gpt-realtime-translate（即時字幕 + 翻譯音訊 + 延遲顯示）
- [ ] 欄位三：gpt-realtime-whisper（即時字幕 + 延遲顯示）
- [ ] 即時延遲數據儀表板（TTFT、完整延遲、字元數）
- [ ] 評分功能（每段翻譯可打 1-5 星）
- [ ] 會話記錄（可下載 JSON）
- [ ] 設定頁面（VAD 閾值、靜音時間、語言提示）

## 文件
- [ ] 更新 README.md 說明三模型比較平台
- [ ] 撰寫 COMPARISON_GUIDE.md 使用說明

## 部署
- [ ] 安裝依賴（server + client）
- [ ] 啟動測試驗證
- [ ] 推送至 GitHub william0214/realtime_lab
