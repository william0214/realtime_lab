/**
 * Manual VAD vs Automatic VAD 精確對照測試
 * 執行方式：
 *   GEMINI_API_KEY=xxx npx tsx test-autovad-vs-manual.ts
 *
 * 測試假設：Automatic VAD（silenceDurationMs=500ms）可能比
 * Manual VAD（activityEnd 在音訊送完後 50ms）更快，
 * 因為伺服器端 VAD 與音訊接收並行執行。
 *
 * 執行方式：
 *   GEMINI_API_KEY=xxx npx tsx test-autovad-vs-manual.ts
 */

import "dotenv/config";
import * as path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { runGeminiLive } from "./benchmark/runners/gemini-live.js";
import { runGeminiLiveAutoVad } from "./benchmark/runners/gemini-live-autovad.js";

const API_KEY = process.env.GEMINI_API_KEY || "";
if (!API_KEY) {
  console.error("❌ 請設定 GEMINI_API_KEY 環境變數");
  process.exit(1);
}

const AUDIO_DIR = path.join(__dirname, "audio");
const TEST_SENTENCES = [
  { id: "zh-01", text: "請問您今天哪裡不舒服？", audioFile: "zh-01.mp3" },
  { id: "zh-02", text: "我頭痛已經三天了，而且有點發燒。", audioFile: "zh-02.mp3" },
  { id: "zh-03", text: "請問您對哪些藥物過敏？", audioFile: "zh-03.mp3" },
  { id: "zh-06", text: "請問您有在服用任何藥物嗎？", audioFile: "zh-06.mp3" },
  { id: "zh-08", text: "我的肚子很痛，痛了一整個晚上。", audioFile: "zh-08.mp3" },
];

const TIMEOUT_MS = 30000;
const VERBOSE = process.argv.includes("--verbose");

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log("🧪 Manual VAD vs Automatic VAD 對比測試");
  console.log("=".repeat(60));
  console.log(`測試句數：${TEST_SENTENCES.length}`);
  console.log(`Automatic VAD 設定：silenceDurationMs=500ms, prefixPaddingMs=200ms`);
  console.log(`Manual VAD 設定：activityEnd 在音訊送完後 50ms`);
  console.log("=".repeat(60));

  const results: Array<{
    id: string;
    text: string;
    manualFirstMs: number | null;
    manualFinalMs: number | null;
    manualTranslation: string;
    autoFirstMs: number | null;
    autoFinalMs: number | null;
    autoTranslation: string;
  }> = [];

  for (const sentence of TEST_SENTENCES) {
    const audioPath = path.join(AUDIO_DIR, sentence.audioFile);
    console.log(`\n📝 ${sentence.id}: "${sentence.text}"`);

    // --- Manual VAD ---
    console.log(`  [Manual VAD] 測試中...`);
    const manualResult = await runGeminiLive(
      { id: sentence.id, text: sentence.text, audioFile: sentence.audioFile },
      audioPath,
      "zh",
      "en",
      API_KEY,
      TIMEOUT_MS,
      VERBOSE
    );
    console.log(`  [Manual VAD] 首字: ${manualResult.firstPartialMs}ms | Final: ${manualResult.finalTranscriptMs}ms`);
    if (manualResult.translatedText) {
      console.log(`  [Manual VAD] 翻譯: "${manualResult.translatedText.substring(0, 60)}"`);
    }
    if (manualResult.error) {
      console.log(`  [Manual VAD] ❌ 錯誤: ${manualResult.error}`);
    }

    await sleep(2000); // 避免速率限制

    // --- Automatic VAD ---
    console.log(`  [Auto VAD]   測試中...`);
    const autoResult = await runGeminiLiveAutoVad(
      { id: sentence.id, text: sentence.text, audioFile: sentence.audioFile },
      audioPath,
      "zh",
      "en",
      API_KEY,
      TIMEOUT_MS,
      VERBOSE
    );
    console.log(`  [Auto VAD]   首字: ${autoResult.firstPartialMs}ms | Final: ${autoResult.finalTranscriptMs}ms`);
    if (autoResult.translatedText) {
      console.log(`  [Auto VAD]   翻譯: "${autoResult.translatedText.substring(0, 60)}"`);
    }
    if (autoResult.error) {
      console.log(`  [Auto VAD]   ❌ 錯誤: ${autoResult.error}`);
    }

    results.push({
      id: sentence.id,
      text: sentence.text,
      manualFirstMs: manualResult.firstPartialMs,
      manualFinalMs: manualResult.finalTranscriptMs,
      manualTranslation: manualResult.translatedText || "",
      autoFirstMs: autoResult.firstPartialMs,
      autoFinalMs: autoResult.finalTranscriptMs,
      autoTranslation: autoResult.translatedText || "",
    });

    await sleep(3000); // 句子間間隔
  }

  // 統計摘要
  console.log("\n" + "=".repeat(60));
  console.log("📊 對比結果摘要");
  console.log("=".repeat(60));
  console.log(`${"句子".padEnd(8)} ${"Manual首字".padStart(10)} ${"Auto首字".padStart(10)} ${"差異".padStart(8)} ${"Manual Final".padStart(14)} ${"Auto Final".padStart(12)} ${"差異".padStart(8)}`);
  console.log("-".repeat(75));

  let manualFirstSum = 0, autoFirstSum = 0;
  let manualFinalSum = 0, autoFinalSum = 0;
  let validCount = 0;

  for (const r of results) {
    const mFirst = r.manualFirstMs ?? 0;
    const aFirst = r.autoFirstMs ?? 0;
    const mFinal = r.manualFinalMs ?? 0;
    const aFinal = r.autoFinalMs ?? 0;
    const firstDiff = aFirst - mFirst;
    const finalDiff = aFinal - mFinal;

    const firstDiffStr = firstDiff > 0 ? `+${firstDiff}ms` : `${firstDiff}ms`;
    const finalDiffStr = finalDiff > 0 ? `+${finalDiff}ms` : `${finalDiff}ms`;

    console.log(`${r.id.padEnd(8)} ${String(mFirst + "ms").padStart(10)} ${String(aFirst + "ms").padStart(10)} ${firstDiffStr.padStart(8)} ${String(mFinal + "ms").padStart(14)} ${String(aFinal + "ms").padStart(12)} ${finalDiffStr.padStart(8)}`);

    if (r.manualFirstMs && r.autoFirstMs) {
      manualFirstSum += mFirst;
      autoFirstSum += aFirst;
      manualFinalSum += mFinal;
      autoFinalSum += aFinal;
      validCount++;
    }
  }

  if (validCount > 0) {
    console.log("-".repeat(75));
    const avgManualFirst = Math.round(manualFirstSum / validCount);
    const avgAutoFirst = Math.round(autoFirstSum / validCount);
    const avgManualFinal = Math.round(manualFinalSum / validCount);
    const avgAutoFinal = Math.round(autoFinalSum / validCount);
    const avgFirstDiff = avgAutoFirst - avgManualFirst;
    const avgFinalDiff = avgAutoFinal - avgManualFinal;

    console.log(`${"平均".padEnd(8)} ${String(avgManualFirst + "ms").padStart(10)} ${String(avgAutoFirst + "ms").padStart(10)} ${(avgFirstDiff > 0 ? "+" + avgFirstDiff : avgFirstDiff) + "ms".padStart(8)} ${String(avgManualFinal + "ms").padStart(14)} ${String(avgAutoFinal + "ms").padStart(12)} ${(avgFinalDiff > 0 ? "+" + avgFinalDiff : avgFinalDiff) + "ms".padStart(8)}`);

    console.log("\n📋 結論：");
    if (avgFinalDiff < -100) {
      console.log(`  ✅ Automatic VAD 更快 ${Math.abs(avgFinalDiff)}ms（Final 延遲）`);
    } else if (avgFinalDiff > 100) {
      console.log(`  ❌ Automatic VAD 更慢 ${avgFinalDiff}ms（Final 延遲）`);
    } else {
      console.log(`  ➡️  兩者相當（差異 ${avgFinalDiff}ms，在誤差範圍內）`);
    }
  }
}

main().catch(console.error);
