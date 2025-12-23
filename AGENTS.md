1. 專案目的與範圍

本專案為「即時語音翻譯實驗室」，目標是提供 雙向即時語音 → 轉錄（ASR）→ 翻譯（MT/LLM）→ 前端顯示 的 PoC / MVP，支援多個 Provider（OpenAI、Google Gemini），並可量測延遲、穩定性與翻譯品質。

非目標（務必遵守）

不做醫療診斷、用藥建議或處方建議。

不將 API Key、個資、原始音訊等敏感資料寫入 repo。

不在未更新文件與測試下，改動「前後端事件契約」或輸出格式。

2. Repo 結構與責任邊界（概覽）

client/：前端 UI（React/Vite/TS），負責錄音、顯示轉錄與翻譯、操作 Provider/模型切換（若有）

server/：後端（Node/TS），負責：

與 Provider Realtime API 連線（WebSocket / WebRTC 或 SDK）

音訊格式轉換（例如 PCM16 24k）

事件流處理（VAD/commit/transcription/translation）

統計與日誌（latency、成功率、錯誤碼、session logs）

回歸測試 runner 與報告輸出（JSONL/CSV）

重要：任何與 Provider 連線/事件處理的修改，應集中在 server/src/realtime/*；翻譯流程協調集中在 server/src/services/*。

3. 變更規範（可改 / 禁區 / 必須同步更新）
3.1 可改動範圍（建議）

server/src/realtime/：Provider client、事件解析、重連與診斷 logging

server/src/services/：翻譯流程 orchestrator、provider 抽象層

server/src/utils/：音訊轉換、格式檢查、共用工具

server/src/tests/、server/tests/：回歸測試、golden set、規則檢查

docs/ 或 README*.md：文件補強

3.2 禁止事項（必遵）

禁止將任何金鑰寫入程式碼（API key 必須走環境變數）。

禁止提交真實病歷、個資、原始音檔（除非已匿名化且取得授權；原則上不要放 repo）。

禁止「默默改變」前後端事件 payload 結構；若必須改：

更新 API.md / PROTOCOL.md（若有）

更新 TESTING.md

提供兼容策略或版本號（v1/v2）

3.3 必須同步更新的文件

若做以下變更，必須同步更新對應文件：

音訊格式 / VAD / commit 行為變更 → ARCHITECTURE.md + TROUBLESHOOTING.md

Provider/模型新增或變更 → README.md + CHANGELOG.md

測試/報表欄位變更 → TESTING.md + README_TESTING.md（若存在）

4. Provider 音訊與事件流硬規格（高風險區）
4.1 音訊格式（必檢）

OpenAI Realtime：PCM16、24kHz、mono（little-endian） 為基準（若專案另有規格，以專案為準）

Gemini Live/Realtime：依目前實作（可能 16kHz），需明確記錄於 ARCHITECTURE.md

任何新增/修改音訊 pipeline 時，必須提供：

格式檢查（取樣率、聲道、bit depth）

錯誤訊息能定位到「格式不符」或「近似靜音」

4.2 事件流（必需可診斷）

對 OpenAI / Gemini 的事件處理，必須至少能判斷以下狀態：

是否偵測到語音開始/結束（speech started/stopped 或等價事件）

是否已 commit（server VAD 自動 commit 或手動 commit）

是否完成轉錄（transcription completed / final transcript）

是否完成翻譯（translation completed / final translation）

若出現下列症狀（高優先排障）：

transcription_time = 0ms、transcript = "..."、準確度 0%

WS close code 1005

必須能透過 session event logs 明確指出原因分類：

A：未收到語音/未觸發 VAD（音量/格式）

B：有 append 無 commit（turn detection/commit 路徑）

C：有 commit 無 transcription completed（事件訂閱/解析/超時）

D：上游連線中斷/timeout（1005）

5. 日誌與可觀測性（必做）
5.1 Session event logs

所有 Provider client 必須能將 server events 以 JSONL 方式落地（可透過 config 開關）：

位置：server/logs/session_<sessionId>.jsonl

最少欄位：

ts

provider

model

event_type

trace_id/session_id

key_fields（例如：commit id、audio buffer size、error code/message）

5.2 統計指標（至少）

成功率（成功完成轉錄 + 翻譯）

延遲：ASR latency、Translation latency、End-to-end latency（P50/P95）

錯誤碼分布（含 1005）

“空白轉錄率”（transcript 空/占位符）

6. 測試策略與驗收門檻（最小可行）
6.1 翻譯品質回歸（Text→Text）

golden set：server/tests/golden.zh-en.jsonl

每次跑測試輸出：server/runs/translation_regression_<YYYYMMDD_HHMM>.jsonl

建議欄位：

run_id, provider, model, src_zh, translation_en, latency_ms

number_preserved（bool）

glossary_hit_rate（0~1）

safety_flags[]

6.2 端到端穩定性（Speech→ASR→Translate）

至少 100 次短句或固定音檔重放

產出報表：成功率、P95、錯誤碼

6.3 醫療安全規則檢查（必須）

任何輸出若觸發以下任一條，需標記 safety_flags：

自行診斷（例如斷言 “You have …”）

用藥/劑量/處方指示

數字/單位改寫（例如 3 天→2 天、38.5→39）

明顯捏造（Hallucination）或未回問關鍵缺漏資訊

最低驗收建議：number_preserved 必須 100%（0 次錯誤）；其餘採人工審核 + 分數門檻。

7. 交付物格式（對 AI/協作者的要求）

所有修改請以以下格式交付：

Patch/diff（優先）或逐檔完整內容

更新後的執行指令（例如 npm run test:regression）

最小驗證步驟（含預期輸出）

若改動契約/格式：同步更新對應 MD 文件

8. 常見任務 Playbook（快速指引）
8.1 新增/切換 Gemini 模型（例如 gemini-3-flash-preview）

模型名稱必須走 .env 可配置（如 GEMINI_LIVE_MODEL）

log 需印出最終使用 model（含 fallback）

必須跑一次 regression，產出 run 檔並更新 CHANGELOG.md

8.2 修正 1005 / 轉錄為 “…” / 0ms

先打開 session event logs

判斷缺哪個事件（speech_started / committed / transcription.completed）

若屬 VAD/commit：提供手動 commit 除錯模式

1005：視為 abnormal close，必須有重連策略（指數退避）與明確告警

9. 安全與隱私

API keys 僅能由環境變數讀取；.env 只提供 .env.example

日誌不得落地敏感內容（若需要除錯，必須遮罩/匿名化）

不保存音訊/轉錄除非明確開啟 debug 且具保存期限/清理機制