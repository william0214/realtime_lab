# 語音翻譯系統 — API 遷移評估報告索引

本目錄收錄護理推車即時雙向翻譯系統的各項 API 遷移評估報告。

## 報告清單

| 報告 | 評估對象 | 評估日期 | 結論 |
|---|---|---|---|
| [gpt-realtime-translate-evaluation.md](./gpt-realtime-translate-evaluation.md) | OpenAI gpt-realtime-translate | 2026-05 | ❌ 不建議遷移（繁體中文無法保證） |
| [gpt-realtime-whisper-asr-evaluation.md](./gpt-realtime-whisper-asr-evaluation.md) | OpenAI gpt-realtime-whisper 取代 ASR | 2026-05 | ✅ 建議混合策略（取代 Partial ASR） |
| [gemini-31-flash-live-evaluation.md](./gemini-31-flash-live-evaluation.md) | Google Gemini 3.1 Flash Live 完整遷移 | 2026-05 | ⚠️ 需先在 realtime_lab 驗證後決定 |

## 驗證平台

評估驗證使用 [realtime_lab](https://github.com/william0214/realtime_lab) 三模型並排比較平台進行。

## 現有架構

```
音訊輸入（AudioWorklet + WebM Muxer + VAD）
    ↓
ASR：OpenAI gpt-4o-mini-transcribe（可切換）
    ↓
翻譯：gpt-4.1-mini（可插拔 Provider）
    ↓
TTS：OpenAI tts-1
```
