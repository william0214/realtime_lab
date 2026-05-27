/**
 * 對照測試：Gemini Live 離線模式 vs 串流模式
 *
 * 目的：精確量測串流輸入（邊說邊傳 + VAD）對首字延遲的改善效果
 *
 * 計時說明：
 *   - 離線模式：startTime = WebSocket 建立時（含 setup 時間）
 *   - 串流模式：startTime = 第一個音訊塊送出時（不含 setup，模擬預建連線）
 *
 * 執行：
 *   cd tools && GEMINI_API_KEY=xxx npx tsx test-streaming-vs-offline.ts
 */

import "dotenv/config";
import * as path from "path";
import { fileURLToPath } from "url";
import { runGeminiLive } from "./benchmark/runners/gemini-live.js";
import { runGeminiLiveStreaming } from "./benchmark/runners/gemini-live-streaming.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY 未設定");
  process.exit(1);
}

const AUDIO_DIR = path.join(__dirname, "audio");
const TEST_SENTENCES = ["zh-01", "zh-02", "zh-03", "zh-06", "zh-08"];
const TIMEOUT_MS = 30000;

// 測試句子資訊
const SENTENCE_INFO: Record<string, string> = {
  "zh-01": "請問您今天哪裡不舒服？",
  "zh-02": "我頭痛已經三天了，而且有點發燒。",
  "zh-03": "請問您對什麼藥物過敏嗎？",
  "zh-06": "請問掛號要怎麼辦理？",
  "zh-08": "我的肚子很痛，痛了一整個晚上。",
};

interface CompareResult {
  sentenceId: string;
  text: string;
  offline: { firstMs: number | null; finalMs: number | null; translation: string; success: boolean };
  streaming: { firstMs: number | null; finalMs: number | null; translation: string; success: boolean };
  improvement: number | null; // ms，正值表示串流更快
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Gemini Live：離線模式 vs 串流模式 對照測試              ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("📋 測試設定：");
  console.log(`   測試句子: ${TEST_SENTENCES.join(", ")}`);
  console.log(`   VAD 閾值: ${0.015}，靜音判定: 300ms`);
  console.log(`   串流塊大小: 100ms`);
  console.log("");

  const results: CompareResult[] = [];

  for (const sentenceId of TEST_SENTENCES) {
    const audioPath = path.join(AUDIO_DIR, `${sentenceId}.mp3`);
    const text = SENTENCE_INFO[sentenceId] || sentenceId;
    const fakeSentence = { id: sentenceId, text, lang: "zh", expectedTranslation: "" };

    console.log(`════════════════════════════════════════════════════════════`);
    console.log(`📝 ${sentenceId}: "${text}"`);

    // --- 離線模式 ---
    console.log(`\n  [離線模式] 開始測試...`);
    const offlineResult = await runGeminiLive(
      fakeSentence, audioPath, "zh", "en",
      GEMINI_API_KEY, TIMEOUT_MS, true
    );
    console.log(`  [離線模式] 首字: ${offlineResult.firstPartialMs}ms | Final: ${offlineResult.finalTranscriptMs}ms`);
    console.log(`  [離線模式] 翻譯: "${offlineResult.translatedText?.slice(0, 60)}"`);

    await sleep(1500); // 避免 API 速率限制

    // --- 串流模式 ---
    console.log(`\n  [串流模式] 開始測試...`);
    const streamResult = await runGeminiLiveStreaming(
      fakeSentence, audioPath, "zh", "en",
      GEMINI_API_KEY, TIMEOUT_MS, true
    );
    console.log(`  [串流模式] 首字: ${streamResult.firstPartialMs}ms | Final: ${streamResult.finalTranscriptMs}ms`);
    console.log(`  [串流模式] 翻譯: "${streamResult.translatedText?.slice(0, 60)}"`);

    // 計算改善幅度
    let improvement: number | null = null;
    if (offlineResult.finalTranscriptMs !== null && streamResult.finalTranscriptMs !== null) {
      improvement = offlineResult.finalTranscriptMs - streamResult.finalTranscriptMs;
    }

    if (improvement !== null) {
      const sign = improvement > 0 ? "↓" : "↑";
      const abs = Math.abs(improvement);
      console.log(`\n  📊 改善: ${sign} ${abs}ms (${improvement > 0 ? "串流更快" : "離線更快"})`);
    }

    results.push({
      sentenceId,
      text,
      offline: {
        firstMs: offlineResult.firstPartialMs,
        finalMs: offlineResult.finalTranscriptMs,
        translation: offlineResult.translatedText || "",
        success: offlineResult.success,
      },
      streaming: {
        firstMs: streamResult.firstPartialMs,
        finalMs: streamResult.finalTranscriptMs,
        translation: streamResult.translatedText || "",
        success: streamResult.success,
      },
      improvement,
    });

    await sleep(2000); // 句子間間隔
  }

  // ============================================================
  // 彙總報告
  // ============================================================
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                    📊 對照測試彙總                       ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");

  const header = "| 句子 | 離線首字 | 串流首字 | 改善 | 離線翻譯（前30字）|";
  const sep    = "|------|----------|----------|------|-------------------|";
  console.log(header);
  console.log(sep);

  let totalImprovement = 0;
  let validCount = 0;

  for (const r of results) {
    const offMs = r.offline.finalMs !== null ? `${r.offline.finalMs}ms` : "失敗";
    const strMs = r.streaming.finalMs !== null ? `${r.streaming.finalMs}ms` : "失敗";
    const impStr = r.improvement !== null
      ? (r.improvement > 0 ? `↓${r.improvement}ms` : `↑${Math.abs(r.improvement)}ms`)
      : "N/A";
    const trans = r.offline.translation.slice(0, 30);
    console.log(`| ${r.sentenceId} | ${offMs} | ${strMs} | ${impStr} | ${trans}... |`);

    if (r.improvement !== null) {
      totalImprovement += r.improvement;
      validCount++;
    }
  }

  if (validCount > 0) {
    const avg = Math.round(totalImprovement / validCount);
    console.log(`\n📈 平均改善：${avg > 0 ? "↓" : "↑"}${Math.abs(avg)}ms（${avg > 0 ? "串流更快" : "離線更快"}）`);
    console.log(`   離線平均 Final：${Math.round(results.reduce((s, r) => s + (r.offline.finalMs || 0), 0) / validCount)}ms`);
    console.log(`   串流平均 Final：${Math.round(results.reduce((s, r) => s + (r.streaming.finalMs || 0), 0) / validCount)}ms`);
  }

  console.log("\n✅ 對照測試完成");
}

main().catch(console.error);
