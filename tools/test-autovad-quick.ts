/**
 * 快速驗證 Automatic VAD runner（單句）
 */
import "dotenv/config";
import * as path from "path";
import { runGeminiLiveAutoVad } from "./benchmark/runners/gemini-live-autovad.js";

const API_KEY = process.env.GEMINI_API_KEY || "";
if (!API_KEY) {
  console.error("❌ 請設定 GEMINI_API_KEY");
  process.exit(1);
}

const audioPath = path.join(process.cwd(), "audio/zh-01.mp3");
const verbose = true;

console.log("🧪 Automatic VAD 快速驗證（zh-01）");
console.log("設定：silenceDurationMs=500ms, prefixPaddingMs=200ms");
console.log("-".repeat(50));

const result = await runGeminiLiveAutoVad(
  { id: "zh-01", text: "請問您今天哪裡不舒服？", audioFile: "zh-01.mp3" },
  audioPath,
  "zh",
  "en",
  API_KEY,
  30000,
  verbose
);

console.log("\n📊 結果：");
console.log(`  首字延遲：${result.firstPartialMs}ms`);
console.log(`  Final 延遲：${result.finalTranscriptMs}ms`);
console.log(`  翻譯：${result.translatedText}`);
console.log(`  成功：${result.success}`);
if (result.error) console.log(`  錯誤：${result.error}`);
