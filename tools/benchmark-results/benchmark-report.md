# Realtime API 自動化測試報告

**產生時間**：2026-05-27T02:44:07.586Z
**來源語言**：zh → **目標語言**：en
**測試句子數**：5 個 Provider × 每句 1 次

## 整體比較

| Provider | 首字延遲 | Final 延遲 | 翻譯延遲 | CER (↓) | 翻譯分 | 繁中比例 | 成功率 |
|---|---|---|---|---|---|---|---|
| **OpenAI Whisper Batch (Baseline)** | N/A | 1099ms | 2068ms | 0.0% | 80/100 | 100% | 100% |
| **gpt-realtime-whisper** | 688ms | 1612ms | N/A | 40.1% | 0/100 | 0% | 100% |
| **gpt-realtime-translate** | 665ms | N/A | N/A | 100.0% | 80/100 | 100% | 100% |
| **Deepgram Nova-3** | 1854ms | 4141ms | N/A | 14.3% | 0/100 | 0% | 100% |
| **Gladia Solaria-1** | N/A | 4902ms | N/A | 56.6% | 0/100 | 0% | 100% |

## 各指標排名

| 排名 | 首字延遲 | Final 延遲 | 準確度 (CER) | 翻譯品質 | 繁體中文 | 成功率 |
|---|---|---|---|---|---|---|
| 🥇 | gpt-realtime-translate | OpenAI Whisper Batch | OpenAI Whisper Batch | OpenAI Whisper Batch | OpenAI Whisper Batch | OpenAI Whisper Batch |
| 🥈 | gpt-realtime-whisper | gpt-realtime-whisper | Deepgram Nova-3 | gpt-realtime-translate | gpt-realtime-translate | gpt-realtime-whisper |
| 🥉 | Deepgram Nova-3 | Deepgram Nova-3 | gpt-realtime-whisper | gpt-realtime-whisper | gpt-realtime-whisper | gpt-realtime-translate |
| 4 | OpenAI Whisper Batch | Gladia Solaria-1 | Gladia Solaria-1 | Deepgram Nova-3 | Deepgram Nova-3 | Deepgram Nova-3 |
| 5 | Gladia Solaria-1 | gpt-realtime-translate | gpt-realtime-translate | Gladia Solaria-1 | Gladia Solaria-1 | Gladia Solaria-1 |

## 護理場景建議

```
綜合評分權重：延遲 30% + 準確度 40% + 繁體中文 30%
最佳延遲：OpenAI Whisper Batch (Baseline)
最佳準確度：OpenAI Whisper Batch (Baseline)
最佳繁體中文：OpenAI Whisper Batch (Baseline)
護理場景綜合最佳：OpenAI Whisper Batch (Baseline)
```

## 各語言詳細結果

### zh

| Provider | 成功率 | CER | Final 延遲 |
|---|---|---|---|
| OpenAI Whisper Batch | 100% | 0.0% | 1099ms |
| gpt-realtime-whisper | 100% | 40.1% | 1612ms |
| gpt-realtime-translate | 100% | 100.0% | 0ms |
| Deepgram Nova-3 | 100% | 14.3% | 4141ms |
| Gladia Solaria-1 | 100% | 56.6% | 4902ms |

## 繁體中文輸出分析

> 此項目為護理翻譯系統的關鍵需求：翻譯輸出必須為繁體中文，不得出現簡體字。

- **OpenAI Whisper Batch (Baseline)**：100% ✅ 優秀
- **gpt-realtime-whisper**：0% ❌ 不合格
- **gpt-realtime-translate**：100% ✅ 優秀
- **Deepgram Nova-3**：0% ❌ 不合格
- **Gladia Solaria-1**：0% ❌ 不合格
