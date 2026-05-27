# 合規安全報告與 Vertex AI 切換方案

> **文件版本**：v1.0  
> **建立日期**：2026-05-27  
> **適用系統**：護理推車即時雙向翻譯系統  
> **法規適用**：HIPAA（美國）、GDPR（歐盟）、個人資料保護法（台灣）

---

## 一、問題核心：AI Studio API 不符合醫療合規要求

目前系統使用 **Google AI Studio API**（`generativelanguage.googleapis.com`）呼叫 Gemini 3.1 Flash Live。這在醫療場景中存在以下合規風險：

| 風險項目 | AI Studio API | 說明 |
|---|---|---|
| **資料用於模型訓練** | ⚠️ 預設啟用 | Google 可能使用對話資料改善模型 |
| **HIPAA BAA 涵蓋** | ❌ 不涵蓋 | AI Studio 不在 Google Cloud BAA 清單內 |
| **GDPR 資料處理協議（DPA）** | ❌ 不適用 | 無企業級 DPA |
| **PHI 資料隔離** | ❌ 無保證 | 語音資料可能流入共用訓練管道 |
| **資料留存地點控制** | ❌ 無法指定 | 無法指定資料處理地區 |

**結論**：使用 AI Studio API 處理患者語音（即使未提及姓名）在 HIPAA 合規環境下屬於違規行為，可能導致醫院採購被否決或面臨罰款。

---

## 二、解決方案：切換至 Vertex AI

### 2.1 Vertex AI 的合規保證

根據 [Google Cloud HIPAA 合規頁面](https://cloud.google.com/security/compliance/hipaa)，Vertex AI 相關服務明確列在 **Google Cloud BAA 涵蓋產品清單**中：

- ✅ **Generative AI on Gemini Enterprise Agent Platform**（包含 Live API）
- ✅ **Gemini Enterprise Agent Platform**
- ✅ **AI Platform Training and Prediction**
- ✅ **Speech-to-Text**
- ✅ **Cloud Storage**（用於音訊暫存）

| 合規項目 | Vertex AI 保證 |
|---|---|
| **HIPAA BAA** | ✅ 涵蓋，需簽署 BAA |
| **資料不用於訓練** | ✅ 企業合約明確承諾 |
| **GDPR 資料處理協議** | ✅ 提供 DPA |
| **資料地區控制** | ✅ 可指定 `asia-east1`（台灣鄰近）或 `us-central1` |
| **加密傳輸** | ✅ TLS 1.3 |
| **靜態加密** | ✅ AES-256 |
| **稽核日誌** | ✅ Cloud Audit Logs |
| **VPC Service Controls** | ✅ 可啟用網路隔離 |

### 2.2 支援的模型

> **重要**：`gemini-3.1-flash-live-preview` **不在** Vertex AI 支援清單中，只在 AI Studio 可用。

Vertex AI 目前支援的 Live API 模型：

| Model ID | 狀態 | 說明 |
|---|---|---|
| `gemini-live-2.5-flash-native-audio` | **GA（正式版）** | 推薦，低延遲，支援 HIPAA |
| `gemini-live-2.5-flash-preview-native-audio-09-2025` | Public Preview（deprecated） | 不建議 |

**gemini-live-2.5-flash-native-audio 的優勢**：
- 比 gemini-3.1-flash-live-preview 更新的模型（2.5 > 3.1 是命名慣例，不是版本倒退）
- 原生音訊輸出（native audio），音質更好
- 已 GA，穩定性更高
- 延遲預期與 3.1 相近或更好

---

## 三、技術切換方案

### 3.1 認證方式變更

| 項目 | AI Studio API | Vertex AI |
|---|---|---|
| **認證方式** | API Key（URL 參數） | OAuth 2.0 Bearer Token（Header） |
| **金鑰管理** | 單一 API Key | Service Account JSON Key |
| **Token 有效期** | 永久 | 1 小時（自動刷新） |

**Vertex AI 認證實作**：

```typescript
import { GoogleAuth } from 'google-auth-library';

const auth = new GoogleAuth({
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, // Service Account JSON
  scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

async function getAccessToken(): Promise<string> {
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token!;
}
```

### 3.2 WebSocket 端點變更

**AI Studio API**：
```
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={API_KEY}
```

**Vertex AI**：
```
wss://{LOCATION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent
```

- LOCATION 建議：`us-central1`（最穩定）或 `asia-northeast1`（日本，亞洲最低延遲）
- 認證放在 Header：`Authorization: Bearer {ACCESS_TOKEN}`

### 3.3 Model ID 格式變更

**AI Studio API**：
```
gemini-3.1-flash-live-preview
```

**Vertex AI**：
```
projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/gemini-live-2.5-flash-native-audio
```

### 3.4 Setup 訊息格式（幾乎相同）

```json
{
  "setup": {
    "model": "projects/my-project/locations/us-central1/publishers/google/models/gemini-live-2.5-flash-native-audio",
    "generation_config": {
      "response_modalities": ["audio", "text"],
      "output_audio_transcription": {}
    },
    "system_instruction": {
      "parts": [{"text": "Translate spoken Traditional Chinese into English. Medical context. No disclaimers. Be concise."}]
    },
    "realtime_input_config": {
      "activity_handling": {
        "start_of_activity_handling": "NO_INTERRUPTION",
        "end_of_activity_handling": "NO_INTERRUPTION"
      }
    }
  }
}
```

### 3.5 需要修改的檔案

| 檔案 | 修改內容 |
|---|---|
| `server/src/realtime/geminiRealtimeClient.ts` | 端點 URL、認證 Header、Model ID |
| `server/src/index.ts` | 環境變數讀取（GOOGLE_APPLICATION_CREDENTIALS） |
| `.env` | 新增 `GOOGLE_CLOUD_PROJECT_ID`、`GOOGLE_CLOUD_LOCATION`、`GOOGLE_APPLICATION_CREDENTIALS` |
| `tools/benchmark/runners/gemini-live.ts` | 同上，用於 benchmark 測試 |

---

## 四、資料去識別化設計（前端）

即使使用 Vertex AI，前端設計也應遵循「最小化資料原則」：

### 4.1 不應錄入的資訊

| 類型 | 範例 | 處理方式 |
|---|---|---|
| 患者姓名 | 「王小明，請問您...」 | 提醒醫護人員改用「這位患者」 |
| 身分證字號 | 「A123456789」 | 不在翻譯場景中使用 |
| 地址 | 「住在台北市...」 | 非醫療必要，不錄入 |
| 電話號碼 | 「0912-345-678」 | 非醫療必要，不錄入 |

### 4.2 可錄入的醫療資訊（PHI 但必要）

- 症狀描述（「頭痛三天」）
- 藥物名稱與劑量（「青黴素 50mg」）
- 生命徵象（「血壓 120/80」）
- 過敏史（「對青黴素過敏」）

### 4.3 前端 UI 提示

在錄音開始前顯示提醒：

```
⚠️ 翻譯提示
請避免在翻譯過程中提及患者姓名、身分證字號等個人識別資訊。
症狀、藥物、檢查結果等醫療資訊可正常使用。
```

---

## 五、HIPAA BAA 簽署步驟

1. 登入 [Google Cloud Console](https://console.cloud.google.com)
2. 選擇目標專案
3. 前往 **IAM & Admin → Compliance**
4. 找到 **HIPAA Business Associate Agreement**
5. 點擊 **Review and Accept**
6. 填寫組織資訊並確認接受

> **注意**：BAA 需由組織的法務或合規負責人簽署，不是技術人員。

---

## 六、GDPR 合規（歐盟患者）

若系統可能處理歐盟患者的語音資料：

| 要求 | 實作方式 |
|---|---|
| **資料處理協議（DPA）** | 使用 Vertex AI 時自動適用 Google Cloud DPA |
| **資料地區限制** | 設定 `LOCATION=europe-west4`（荷蘭）或 `europe-west1` |
| **資料主體權利** | 不留存逐字稿（session 結束後不寫入資料庫） |
| **知情同意** | 翻譯開始前顯示告知說明 |

---

## 七、台灣個人資料保護法

| 要求 | 實作方式 |
|---|---|
| **特種個資（健康資訊）** | 需取得當事人書面同意 |
| **境外傳輸限制** | Vertex AI `asia-east1`（台灣）或 `asia-northeast1`（日本）可降低風險 |
| **資料保存期限** | 不留存逐字稿，session 結束後自動清除 |
| **資安事故通報** | 72 小時內通報主管機關 |

---

## 八、實作優先順序

| 優先級 | 工作項目 | 說明 |
|---|---|---|
| P0（立即） | 簽署 Google Cloud HIPAA BAA | 法律前提 |
| P0（立即） | 建立 Service Account | 技術前提 |
| P1（本週） | 切換 geminiRealtimeClient 至 Vertex AI | 核心切換 |
| P1（本週） | 測試 gemini-live-2.5-flash-native-audio 效能 | 確認延遲 |
| P2（下週） | 前端加入資料去識別化提示 | UX 設計 |
| P2（下週） | 加入 Cloud Audit Logs 監控 | 稽核要求 |
| P3（本月） | VPC Service Controls 設定 | 進階隔離 |

---

## 九、成本影響

切換至 Vertex AI 後，定價與 AI Studio 相同（音訊輸入 $0.35/1M tokens），**不增加成本**。

唯一額外成本：Cloud Audit Logs 儲存費用（約 $0.01/GB，每月可忽略不計）。

---

## 參考資料

- [Google Cloud HIPAA Compliance](https://cloud.google.com/security/compliance/hipaa)
- [Vertex AI Live API 文件](https://cloud.google.com/vertex-ai/generative-ai/docs/live-api)
- [Vertex AI Live API WebSocket 規格](https://cloud.google.com/vertex-ai/generative-ai/docs/live-api/start-manage-session)
- [Google Cloud BAA 涵蓋產品清單](https://cloud.google.com/security/compliance/hipaa#covered-products)
- [GDPR on Google Cloud](https://cloud.google.com/privacy/gdpr)
