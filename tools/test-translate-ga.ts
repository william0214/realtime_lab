/**
 * 快速測試 gpt-realtime-translate GA API
 */
import WebSocket from "ws";
import { spawn } from "child_process";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const API_KEY = process.env.OPENAI_API_KEY!;
const AUDIO_PATH = path.join(__dirname, "audio/en-01.mp3");

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

console.log("🔗 Connecting to gpt-realtime-translate GA API...");

const ws = new WebSocket(
  "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate",
  { headers: { Authorization: `Bearer ${API_KEY}`, "OpenAI-Safety-Identifier": "benchmark-test" } }
);

let audioSent = false;
const startTime = Date.now();

ws.on("open", () => {
  console.log("✅ Connected! Sending session.update...");
  ws.send(JSON.stringify({
    type: "session.update",
    session: { audio: { output: { language: "zh" } } }
  }));
});

ws.on("message", async (data: WebSocket.Data) => {
  const event = JSON.parse(data.toString());
  const elapsed = Date.now() - startTime;
  console.log(`[${elapsed}ms] 📨 ${event.type}`, event.error ? JSON.stringify(event.error) : "");

  if ((event.type === "session.created" || event.type === "session.updated") && !audioSent) {
    audioSent = true;
    console.log("🎵 Sending audio (en-01.mp3 → zh)...");
    const pcm = await mp3ToPcm16(AUDIO_PATH, 24000);
    console.log(`   PCM size: ${pcm.length} bytes`);
    const chunkSize = 4800;
    for (let i = 0; i < pcm.length; i += chunkSize) {
      ws.send(JSON.stringify({ type: "session.input_audio_buffer.append", audio: pcm.slice(i, i + chunkSize).toString("base64") }));
    }
    ws.send(JSON.stringify({ type: "session.close" }));
    console.log("✅ Audio sent + session.close sent");
  }

  if (event.type === "session.input_transcript.delta") process.stdout.write(`📝 ${event.delta}`);
  if (event.type === "session.input_transcript.done") console.log(`\n✅ Source transcript: "${event.transcript}"`);
  if (event.type === "session.output_transcript.delta") process.stdout.write(`🌐 ${event.delta}`);
  if (event.type === "session.output_transcript.done") console.log(`\n✅ Translation: "${event.transcript}"`);
  if (event.type === "session.closed") {
    console.log(`\n🎉 Done! Total: ${elapsed}ms`);
    ws.close();
    process.exit(0);
  }
});

ws.on("error", (e) => { console.error("❌ Error:", e.message); process.exit(1); });
setTimeout(() => { console.log("⏰ Timeout 35s"); ws.close(); process.exit(1); }, 35000);
