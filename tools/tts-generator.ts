/**
 * TTS Generator - 使用 OpenAI TTS API 批次產生測試語音
 *
 * 使用方式:
 *   npx tsx tts-generator.ts          # 使用 tts-1 模型
 *   npx tsx tts-generator.ts --hd     # 使用 tts-1-hd 高品質模型
 *   npx tsx tts-generator.ts --lang zh # 只產生中文
 *   npx tsx tts-generator.ts --id zh-01 # 只產生特定句子
 */

import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ES Module 取得 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 載入環境變數 (從 server/.env)
const envPath = path.join(__dirname, "..", "server", ".env");
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    envContent.split("\n").forEach((line) => {
        const [key, ...valueParts] = line.split("=");
        if (key && valueParts.length > 0) {
            process.env[key.trim()] = valueParts.join("=").trim();
        }
    });
}

// 型別定義
interface Sentence {
    id: string;
    lang: string;
    langName: string;
    text: string;
    chinese?: string;
    context: string;
}

interface TestData {
    sentences: Sentence[];
    voices: Record<string, string>;
}

// 解析命令列參數
const args = process.argv.slice(2);
const useHD = args.includes("--hd");
const langFilter = args.find((a) => a.startsWith("--lang="))?.split("=")[1];
const idFilter = args.find((a) => a.startsWith("--id="))?.split("=")[1];

// 初始化 OpenAI 客戶端
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// 載入測試句子
const dataPath = path.join(__dirname, "test-sentences.json");
const testData: TestData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

// 確保 audio 資料夾存在
const audioDir = path.join(__dirname, "audio");
if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
}

// 產生單一語音檔
async function generateSpeech(sentence: Sentence, voice: string): Promise<void> {
    const model = useHD ? "tts-1-hd" : "tts-1";
    const outputPath = path.join(audioDir, `${sentence.id}.mp3`);

    // 檢查是否已存在
    if (fs.existsSync(outputPath) && !args.includes("--force")) {
        console.log(`⏭️  跳過 ${sentence.id} (已存在，使用 --force 強制重新產生)`);
        return;
    }

    console.log(`🎙️  產生中: ${sentence.id} (${sentence.langName})`);
    console.log(`   📝 "${sentence.text}"`);
    console.log(`   🔊 語音: ${voice}, 模型: ${model}`);

    try {
        const response = await openai.audio.speech.create({
            model,
            voice: voice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
            input: sentence.text,
            response_format: "mp3",
        });

        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(outputPath, buffer);

        const fileSizeKB = (buffer.length / 1024).toFixed(1);
        console.log(`   ✅ 完成: ${outputPath} (${fileSizeKB} KB)\n`);
    } catch (error) {
        console.error(`   ❌ 錯誤: ${sentence.id}`, error);
        throw error;
    }
}

// 主函數
async function main() {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║        TTS Generator - OpenAI Text-to-Speech               ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    // 檢查 API Key
    if (!process.env.OPENAI_API_KEY) {
        console.error("❌ 錯誤: 未找到 OPENAI_API_KEY");
        console.error("   請確認 server/.env 檔案中有設定 OPENAI_API_KEY");
        process.exit(1);
    }

    console.log(`📋 設定:`);
    console.log(`   模型: ${useHD ? "tts-1-hd (高品質)" : "tts-1 (標準)"}`);
    console.log(`   語言篩選: ${langFilter || "全部"}`);
    console.log(`   ID 篩選: ${idFilter || "全部"}`);
    console.log(`   輸出目錄: ${audioDir}\n`);

    // 篩選句子
    let sentences = testData.sentences;

    if (langFilter) {
        sentences = sentences.filter((s) => s.lang === langFilter);
    }

    if (idFilter) {
        sentences = sentences.filter((s) => s.id === idFilter);
    }

    if (sentences.length === 0) {
        console.log("⚠️  沒有符合條件的句子");
        process.exit(0);
    }

    console.log(`🎯 準備產生 ${sentences.length} 個語音檔案\n`);
    console.log("────────────────────────────────────────────────────────────\n");

    // 依序產生語音
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const sentence of sentences) {
        const voice = testData.voices[sentence.lang] || "alloy";

        try {
            const outputPath = path.join(audioDir, `${sentence.id}.mp3`);
            if (fs.existsSync(outputPath) && !args.includes("--force")) {
                skipCount++;
                console.log(`⏭️  跳過 ${sentence.id} (已存在)`);
                continue;
            }

            await generateSpeech(sentence, voice);
            successCount++;

            // 避免 API 限制，加入延遲
            await new Promise((resolve) => setTimeout(resolve, 500));
        } catch {
            errorCount++;
        }
    }

    // 統計
    console.log("────────────────────────────────────────────────────────────\n");
    console.log("📊 完成統計:");
    console.log(`   ✅ 成功: ${successCount}`);
    console.log(`   ⏭️  跳過: ${skipCount}`);
    console.log(`   ❌ 錯誤: ${errorCount}`);
    console.log(`   📁 總計: ${sentences.length}\n`);

    // 產生音檔清單 JSON (供播放器使用)
    const manifestPath = path.join(audioDir, "manifest.json");
    const manifest = {
        generatedAt: new Date().toISOString(),
        model: useHD ? "tts-1-hd" : "tts-1",
        files: sentences.map((s) => ({
            id: s.id,
            lang: s.lang,
            langName: s.langName,
            text: s.text,
            chinese: s.chinese || s.text,
            context: s.context,
            file: `${s.id}.mp3`,
            voice: testData.voices[s.lang] || "alloy",
        })),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`📄 清單已更新: ${manifestPath}\n`);

    console.log("🎉 TTS 產生完成！");
    console.log("   執行 'npm run serve' 開啟播放介面");
}

main().catch(console.error);
