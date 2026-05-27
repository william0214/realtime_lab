/**
 * 快速測試 gpt-realtime-whisper GA API
 * GA API: /v1/realtime + session.update type: "transcription"
 */
import WebSocket from "ws";
import { spawn } from "child_process";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const API_KEY = process.env.OPENAI_API_KEY!;
const AUDIO_PATH = path.join(__dirname, "audio/zh-01.mp3");

async function mp3ToPcm16(audioPath: string, sampleRate = 24000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-i", audioPath, "-ar", String(sampleRate), "-ac", "1", "-f", "s16le", "-"]);
    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (d: Buffer) => chunks.push(d));
    ffmpeg.stderr.on("data", () => {});
    ffmpeg.on("close", (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg code ${code}`)));
    ffmpeg.on("error", reject);
  });
}

console.log("🔗 Connecting to gpt-realtime-whisper GA API...");
// 關鍵：transcription session 使用 intent=transcription 查詢參數
console.log("   URL: wss://api.openai.com/v1/realtime?intent=transcription");

const ws = new WebSocket(
  "wss://api.openai.com/v1/realtime?intent=transcription",
  { headers: { Authorization: `Bearer ${API_KEY}`, "OpenAI-Safety-Identifier": "benchmark-test" } }
);

let audioSent = false;
const startTime = Date.now();

ws.on("open", () => {
  console.log("✅ Connected! Sending session.update (type: transcription)...");
  // GA API: session.update with type: "transcription"
  ws.send(JSON.stringify({
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input: {
          format: {
            type: "audio/pcm",
            rate: 24000,
          },
          transcription: {
            model: "gpt-realtime-whisper",
            language: "zh",
            delay: "low",
          },
        },
      },
    },
  }));
});

ws.on("message", async (data: WebSocket.Data) => {
  const event = JSON.parse(data.toString());
  const elapsed = Date.now() - startTime;
  if (event.type === "error") {
    console.error(`[${elapsed}ms] ❌ ERROR:`, JSON.stringify(event.error));
    return;
  }
  console.log(`[${elapsed}ms] 📨 ${event.type}`);

  if ((event.type === "session.created" || event.type === "session.updated") && !audioSent) {
    audioSent = true;
    console.log("🎵 Sending audio (zh-01.mp3)...");
    const pcm = await mp3ToPcm16(AUDIO_PATH, 24000);
    console.log(`   PCM size: ${pcm.length} bytes`);
    const chunkSize = 4800;
    for (let i = 0; i < pcm.length; i += chunkSize) {
      ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm.slice(i, i + chunkSize).toString("base64") }));
    }
    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    console.log("✅ Audio sent + commit");
  }

  if (event.type === "conversation.item.input_audio_transcription.delta") {
    process.stdout.write(`📝 [${elapsed}ms] ${event.delta}`);
  }
  if (event.type === "conversation.item.input_audio_transcription.completed") {
    console.log(`\n✅ Final: "${event.transcript}" [${elapsed}ms]`);
    ws.close();
    process.exit(0);
  }
});

ws.on("error", (e) => { console.error("❌ Error:", e.message); process.exit(1); });
setTimeout(() => { console.log("\n⏰ Timeout 35s"); ws.close(); process.exit(1); }, 35000);
