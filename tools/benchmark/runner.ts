/**
 * Realtime API 自動化測試執行器
 *
 * 使用方式：
 *   cd tools && npx tsx benchmark/runner.ts [options]
 *
 * 選項：
 *   --providers=openai-whisper-batch,openai-realtime-whisper,gladia,deepgram
 *   --source=zh          來源語言（預設 zh）
 *   --target=en          目標語言（預設 en）
 *   --sentences=zh-01,zh-02   指定測試句子 ID（預設全部）
 *   --lang=zh            只測試指定語言的句子
 *   --repeat=3           每句重複次數（預設 1）
 *   --timeout=30000      每次測試超時 ms（預設 30000）
 *   --output=./results   輸出目錄（預設 ./benchmark-results）
 *   --verbose            顯示詳細日誌
 *   --dry-run            只顯示設定，不執行測試
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  TestConfig,
  TestSentence,
  ProviderResult,
  SentenceResult,
  SingleRunResult,
  ProviderName,
  BenchmarkReport,
} from "./types";
import { calcAccuracy, calcTradChineseRatio, calcTranslationScore } from "./evaluators/accuracy";
import { buildComparison, saveReport } from "./reporter";
import { runOpenAIWhisperBatch } from "./runners/openai-whisper-batch";
import { runOpenAIRealtimeWhisper } from "./runners/openai-realtime-whisper";
import { runOpenAIRealtimeTranslate } from "./runners/openai-realtime-translate";
import { runOpenAIRealtime2 } from "./runners/openai-realtime2";
import { runGladia } from "./runners/gladia";
import { runDeeepgram } from "./runners/deepgram";
import { runGeminiLive } from "./runners/gemini-live";

// ============================================================
// CLI 參數解析
// ============================================================
const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string): string {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split("=").slice(1).join("=") : defaultVal;
}
function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const ALL_PROVIDERS: ProviderName[] = [
  "openai-whisper-batch",
  "openai-realtime-whisper",
  "openai-translate",
  "gladia",
  "deepgram",
  "gemini-live",
];

const providersArg = getArg("providers", "");
const selectedProviders: ProviderName[] = providersArg
  ? (providersArg.split(",") as ProviderName[])
  : ALL_PROVIDERS;

const config: TestConfig = {
  providers: selectedProviders,
  sourceLang: getArg("source", "zh"),
  targetLang: getArg("target", "en"),
  audioDir: path.join(__dirname, "../audio"),
  outputDir: getArg("output", path.join(__dirname, "../benchmark-results")),
  timeoutMs: parseInt(getArg("timeout", "30000"), 10),
  repeatCount: parseInt(getArg("repeat", "1"), 10),
  verbose: hasFlag("verbose"),
};

const sentenceFilter = getArg("sentences", "");
const langFilter = getArg("lang", "");
const isDryRun = hasFlag("dry-run");

// ============================================================
// API Key 設定
// ============================================================
const API_KEYS: Partial<Record<ProviderName, string>> = {
  "openai-whisper-batch": process.env.OPENAI_API_KEY,
  "openai-realtime-whisper": process.env.OPENAI_API_KEY,
  "openai-translate": process.env.OPENAI_API_KEY,
  "openai-realtime2": process.env.OPENAI_API_KEY,
  gladia: process.env.GLADIA_API_KEY,
  deepgram: process.env.DEEPGRAM_API_KEY,
  soniox: process.env.SONIOX_API_KEY,
  "gemini-live": process.env.GEMINI_API_KEY,
};

// ============================================================
// 測試句子載入
// ============================================================
function loadSentences(): TestSentence[] {
  const dataPath = path.join(__dirname, "../test-sentences.json");
  if (!fs.existsSync(dataPath)) {
    throw new Error(`找不到測試句子檔案: ${dataPath}`);
  }
  const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  let sentences: TestSentence[] = data.sentences;

  if (sentenceFilter) {
    const ids = sentenceFilter.split(",");
    sentences = sentences.filter((s) => ids.includes(s.id));
  }
  if (langFilter) {
    sentences = sentences.filter((s) => s.lang === langFilter);
  }
  return sentences;
}

// ============================================================
// 執行單一 Provider 的測試
// ============================================================
async function runProvider(
  provider: ProviderName,
  sentences: TestSentence[]
): Promise<ProviderResult> {
  const apiKey = API_KEYS[provider];
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  const providerLabels: Record<ProviderName, string> = {
    "openai-whisper-batch": "OpenAI Whisper Batch (Baseline)",
    "openai-realtime-whisper": "gpt-realtime-whisper",
    "openai-translate": "gpt-realtime-translate",
    "openai-realtime2": "gpt-realtime-2",
    gladia: "Gladia Solaria-1",
    deepgram: "Deepgram Nova-3",
    soniox: "Soniox",
    "gemini-live": "Gemini 3.1 Flash Live",
  };

  if (!apiKey) {
    console.log(`\n⏭️  跳過 ${providerLabels[provider]}（未設定 API Key）`);
    return {
      provider,
      providerLabel: providerLabels[provider],
      startedAt,
      finishedAt: new Date().toISOString(),
      totalDurationMs: 0,
      sentences: [],
      summary: {
        avgFirstPartialMs: 0,
        avgFinalMs: 0,
        avgTranslationMs: 0,
        avgCer: 0,
        avgTranslationScore: 0,
        avgTradChineseRatio: 0,
        successRate: 0,
        totalSentences: 0,
        successCount: 0,
        failCount: 0,
        byLang: {},
      },
      apiKeyAvailable: false,
      skipped: true,
      skipReason: `未設定 ${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`,
    };
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🚀 測試 Provider: ${providerLabels[provider]}`);
  console.log(`${"═".repeat(60)}`);

  const sentenceResults: SentenceResult[] = [];

  for (const sentence of sentences) {
    const audioPath = path.join(config.audioDir, `${sentence.id}.mp3`);

    if (!fs.existsSync(audioPath)) {
      console.log(`  ⚠️  跳過 ${sentence.id}（音訊檔案不存在，請先執行 TTS 產生器）`);
      continue;
    }

    console.log(`\n  📝 測試: ${sentence.id} (${sentence.langName})`);
    console.log(`     "${sentence.text.slice(0, 50)}${sentence.text.length > 50 ? "..." : ""}"`);

    const runs: SingleRunResult[] = [];

    for (let i = 0; i < config.repeatCount; i++) {
      if (config.repeatCount > 1) {
        process.stdout.write(`     第 ${i + 1}/${config.repeatCount} 次... `);
      }

      let result: SingleRunResult;

      switch (provider) {
        case "openai-whisper-batch":
          result = await runOpenAIWhisperBatch(sentence, audioPath, apiKey, config.targetLang);
          break;
        case "openai-realtime-whisper":
          result = await runOpenAIRealtimeWhisper(sentence, audioPath, apiKey, config.targetLang, config.timeoutMs);
          break;
        case "openai-translate":
          result = await runOpenAIRealtimeTranslate(sentence, audioPath, apiKey, config.targetLang, config.timeoutMs);
          break;
        case "openai-realtime2":
          result = await runOpenAIRealtime2(sentence, audioPath, apiKey, config.targetLang, config.timeoutMs);
          break;
        case "gladia":
          result = await runGladia(sentence, audioPath, apiKey, config.targetLang, config.timeoutMs);
          break;
        case "deepgram":
          result = await runDeeepgram(sentence, audioPath, apiKey, config.targetLang, config.timeoutMs);
          break;
        case "gemini-live":
          result = await runGeminiLive(sentence, audioPath, config.sourceLang, config.targetLang, apiKey, config.timeoutMs, config.verbose);
          break;
        default:
          result = {
            firstPartialMs: null,
            finalTranscriptMs: null,
            translationMs: null,
            transcribedText: "",
            translatedText: "",
            success: false,
            error: `Provider ${provider} 尚未實作`,
          };
      }

      runs.push(result);

      if (config.repeatCount > 1) {
        console.log(result.success ? "✅" : `❌ ${result.error}`);
      }

      if (config.verbose) {
        console.log(`     轉錄: "${result.transcribedText.slice(0, 60)}"`);
        if (result.translatedText) {
          console.log(`     翻譯: "${result.translatedText.slice(0, 60)}"`);
        }
        console.log(
          `     延遲: 首字=${result.firstPartialMs ?? "N/A"}ms, Final=${result.finalTranscriptMs ?? "N/A"}ms`
        );
      }

      // 避免 API 限速
      if (i < config.repeatCount - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // 計算此句子的統計
    const successRuns = runs.filter((r) => r.success);
    const avgFirstPartialMs = avg(
      successRuns.map((r) => r.firstPartialMs).filter((v): v is number => v !== null)
    );
    const avgFinalMs = avg(
      successRuns.map((r) => r.finalTranscriptMs).filter((v): v is number => v !== null)
    );
    const avgTranslationMs = avg(
      successRuns.map((r) => r.translationMs).filter((v): v is number => v !== null)
    );

    // 取最後一次成功的轉錄文字計算 CER
    const lastSuccess = successRuns[successRuns.length - 1];
    const cer = lastSuccess
      ? 100 - calcAccuracy(sentence.text, lastSuccess.transcribedText, sentence.lang)
      : 100;

    const tradChineseRatio = lastSuccess?.translatedText
      ? calcTradChineseRatio(lastSuccess.translatedText)
      : 0;

    const translationScore = lastSuccess?.translatedText
      ? calcTranslationScore(lastSuccess.translatedText, config.targetLang, sentence.lang)
      : 0;

    const successRate = (successRuns.length / runs.length) * 100;

    const icon = successRate >= 80 ? "✅" : successRate >= 50 ? "⚠️" : "❌";
    console.log(
      `  ${icon} ${sentence.id}: CER=${cer.toFixed(1)}%, Final=${avgFinalMs.toFixed(0)}ms, 成功率=${successRate.toFixed(0)}%`
    );

    sentenceResults.push({
      sentenceId: sentence.id,
      lang: sentence.lang,
      expectedText: sentence.text,
      runs,
      avgFirstPartialMs,
      avgFinalMs,
      avgTranslationMs,
      cer,
      translationScore,
      tradChineseRatio,
      successRate,
    });
  }

  // 計算 Provider 整體統計
  const byLang: ProviderResult["summary"]["byLang"] = {};
  for (const sr of sentenceResults) {
    if (!byLang[sr.lang]) {
      byLang[sr.lang] = { successRate: 0, avgCer: 0, avgFinalMs: 0 };
    }
  }
  for (const lang of Object.keys(byLang)) {
    const langResults = sentenceResults.filter((r) => r.lang === lang);
    byLang[lang] = {
      successRate: avg(langResults.map((r) => r.successRate)),
      avgCer: avg(langResults.map((r) => r.cer)),
      avgFinalMs: avg(langResults.map((r) => r.avgFinalMs)),
    };
  }

  const successCount = sentenceResults.filter((r) => r.successRate > 0).length;
  const summary = {
    avgFirstPartialMs: avg(sentenceResults.map((r) => r.avgFirstPartialMs).filter((v) => v > 0)),
    avgFinalMs: avg(sentenceResults.map((r) => r.avgFinalMs).filter((v) => v > 0)),
    avgTranslationMs: avg(sentenceResults.map((r) => r.avgTranslationMs).filter((v) => v > 0)),
    avgCer: avg(sentenceResults.map((r) => r.cer)),
    avgTranslationScore: avg(sentenceResults.map((r) => r.translationScore)),
    avgTradChineseRatio: avg(sentenceResults.map((r) => r.tradChineseRatio)),
    successRate: avg(sentenceResults.map((r) => r.successRate)),
    totalSentences: sentenceResults.length,
    successCount,
    failCount: sentenceResults.length - successCount,
    byLang,
  };

  const finishedAt = new Date().toISOString();
  const totalDurationMs = Date.now() - startTime;

  console.log(`\n  📊 ${providerLabels[provider]} 完成`);
  console.log(`     成功率: ${summary.successRate.toFixed(0)}% | CER: ${summary.avgCer.toFixed(1)}% | Final: ${summary.avgFinalMs.toFixed(0)}ms`);

  return {
    provider,
    providerLabel: providerLabels[provider],
    startedAt,
    finishedAt,
    totalDurationMs,
    sentences: sentenceResults,
    summary,
    apiKeyAvailable: true,
    skipped: false,
  };
}

function avg(nums: number[]): number {
  const valid = nums.filter((n) => n !== null && !isNaN(n) && n > 0);
  if (valid.length === 0) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

// ============================================================
// 主程式
// ============================================================
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║      Realtime API 自動化測試工具 v1.0                    ║");
  console.log("║      護理翻譯系統 - API 方案驗證平台                     ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");

  // 載入測試句子
  let sentences: TestSentence[];
  try {
    sentences = loadSentences();
  } catch (err) {
    console.error(`❌ 載入測試句子失敗: ${err}`);
    process.exit(1);
  }

  console.log("📋 測試設定：");
  console.log(`   Providers: ${config.providers.join(", ")}`);
  console.log(`   語言: ${config.sourceLang} → ${config.targetLang}`);
  console.log(`   測試句子: ${sentences.length} 句`);
  console.log(`   每句重複: ${config.repeatCount} 次`);
  console.log(`   超時: ${config.timeoutMs}ms`);
  console.log(`   輸出目錄: ${config.outputDir}`);
  console.log("");

  // 顯示 API Key 狀態
  console.log("🔑 API Key 狀態：");
  const keyStatus: Record<string, boolean> = {
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    GLADIA_API_KEY: !!process.env.GLADIA_API_KEY,
    DEEPGRAM_API_KEY: !!process.env.DEEPGRAM_API_KEY,
    SONIOX_API_KEY: !!process.env.SONIOX_API_KEY,
  };
  for (const [key, exists] of Object.entries(keyStatus)) {
    console.log(`   ${exists ? "✅" : "❌"} ${key}`);
  }
  console.log("");

  // 檢查音訊檔案
  const audioFiles = sentences.filter((s) =>
    fs.existsSync(path.join(config.audioDir, `${s.id}.mp3`))
  );
  if (audioFiles.length === 0) {
    console.error("❌ 找不到任何音訊檔案！");
    console.error(`   請先執行 TTS 產生器：`);
    console.error(`   cd tools && npx tsx tts-generator.ts`);
    process.exit(1);
  }
  if (audioFiles.length < sentences.length) {
    console.warn(
      `⚠️  只找到 ${audioFiles.length}/${sentences.length} 個音訊檔案`
    );
    console.warn(`   執行 TTS 產生器補齊：cd tools && npx tsx tts-generator.ts`);
  }

  if (isDryRun) {
    console.log("🔍 Dry-run 模式，不執行實際測試");
    return;
  }

  // 執行測試
  const results: ProviderResult[] = [];
  for (const provider of config.providers) {
    const result = await runProvider(provider, sentences);
    results.push(result);
    // 避免 API 限速
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 產生報告
  const comparison = buildComparison(results);
  const report: BenchmarkReport = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    config,
    results,
    comparison,
  };

  saveReport(report, config.outputDir);

  // 終端摘要
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║                    📊 測試完成摘要                       ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("🏆 護理場景綜合建議：");
  console.log(`   最佳延遲：${comparison.nursingRecommendation.bestForLatency}`);
  console.log(`   最佳準確度：${comparison.nursingRecommendation.bestForAccuracy}`);
  console.log(`   最佳繁體中文：${comparison.nursingRecommendation.bestForTradChinese}`);
  console.log(`   綜合最佳：${comparison.nursingRecommendation.bestOverall}`);
  console.log("");
  console.log(`📁 完整報告：${config.outputDir}/benchmark-report.md`);
}

main().catch((err) => {
  console.error("❌ 測試執行失敗:", err);
  process.exit(1);
});
