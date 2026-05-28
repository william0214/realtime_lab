/**
 * Realtime API 自動化測試框架 - 共用型別定義
 */

export type ProviderName =
  | "openai-realtime-whisper" // gpt-realtime-whisper (串流 ASR)
  | "openai-translate"     // gpt-realtime-translate (一體化翻譯)
  | "openai-realtime2"     // gpt-realtime-2 (語音 AI 助理)
  | "openai-whisper-batch" // gpt-4o-transcribe (現有系統 baseline)
  | "gladia"               // Gladia Solaria-1
  | "deepgram"             // Deepgram Nova-3
  | "soniox"              // Soniox
  | "gemini-live"          // Gemini 3.1 Flash Live (Google AI Studio)
  | "gemini-live-vertex";   // Gemini Live 2.5 Flash (Vertex AI, HIPAA compliant)

export interface TestSentence {
  id: string;
  lang: string;
  langName: string;
  text: string;
  chinese?: string;
  context: string;
  expectedTranslation?: string; // 預期翻譯（用於評分）
}

export interface TestConfig {
  providers: ProviderName[];
  sourceLang: string;
  targetLang: string;
  audioDir: string;
  outputDir: string;
  timeoutMs: number;
  repeatCount: number; // 每句重複測試次數（取平均）
  verbose: boolean;
}

export interface SingleRunResult {
  /** 首個 Partial transcript 抵達時間（ms，從音訊開始播放計算） */
  firstPartialMs: number | null;
  /** Final transcript 抵達時間（ms） */
  finalTranscriptMs: number | null;
  /** 翻譯結果抵達時間（ms，若 provider 支援） */
  translationMs: number | null;
  /** 轉錄文字 */
  transcribedText: string;
  /** 翻譯文字（若 provider 支援） */
  translatedText: string;
  /** 是否成功完成 */
  success: boolean;
  /** 錯誤訊息 */
  error?: string;
}

export interface SentenceResult {
  sentenceId: string;
  lang: string;
  expectedText: string;
  runs: SingleRunResult[];
  /** 平均首字延遲 (ms) */
  avgFirstPartialMs: number;
  /** 平均 Final 延遲 (ms) */
  avgFinalMs: number;
  /** 平均翻譯延遲 (ms) */
  avgTranslationMs: number;
  /** 字符錯誤率 CER (0-100) */
  cer: number;
  /** 翻譯品質分數 (0-100, 若可評估) */
  translationScore: number;
  /** 繁體中文比例 (0-100, 僅翻譯目標為中文時) */
  tradChineseRatio: number;
  /** 成功率 (0-100) */
  successRate: number;
}

export interface ProviderResult {
  provider: ProviderName;
  providerLabel: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  sentences: SentenceResult[];
  /** 整體統計 */
  summary: ProviderSummary;
  /** API key 是否存在 */
  apiKeyAvailable: boolean;
  /** 是否跳過（API key 不存在） */
  skipped: boolean;
  skipReason?: string;
}

export interface ProviderSummary {
  avgFirstPartialMs: number;
  avgFinalMs: number;
  avgTranslationMs: number;
  avgCer: number;
  avgTranslationScore: number;
  avgTradChineseRatio: number;
  successRate: number;
  totalSentences: number;
  successCount: number;
  failCount: number;
  /** 每語言的成功率 */
  byLang: Record<string, { successRate: number; avgCer: number; avgFinalMs: number }>;
}

export interface BenchmarkReport {
  version: "1.0";
  generatedAt: string;
  config: TestConfig;
  results: ProviderResult[];
  /** 跨 provider 比較 */
  comparison: ComparisonTable;
}

export interface ComparisonTable {
  /** 按首字延遲排名 */
  rankByFirstPartial: ProviderName[];
  /** 按 Final 延遲排名 */
  rankByFinalLatency: ProviderName[];
  /** 按 CER 準確度排名（越低越好） */
  rankByCer: ProviderName[];
  /** 按翻譯品質排名 */
  rankByTranslationScore: ProviderName[];
  /** 繁體中文輸出比例排名 */
  rankByTradChinese: ProviderName[];
  /** 成功率排名 */
  rankBySuccessRate: ProviderName[];
  /** 護理場景綜合推薦 */
  nursingRecommendation: {
    bestForLatency: ProviderName;
    bestForAccuracy: ProviderName;
    bestForTradChinese: ProviderName;
    bestOverall: ProviderName;
    notes: string;
  };
}
