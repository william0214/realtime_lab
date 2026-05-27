/**
 * test-rtw-socketio.ts
 * 測試後端 RTW Socket.IO 命名空間 (/rtw)
 * 驗證：連線 → rtw:init → rtw:ready → rtw:audio → rtw:delta → rtw:speech_stopped
 */
import { io as ioClient } from "socket.io-client";
import { spawn } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_PATH = path.join(__dirname, "audio/zh-01.mp3");
const SERVER_URL = "http://localhost:3001";

async function mp3ToPcm16(audioPath: string, sampleRate = 24000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", audioPath,
      "-ar", String(sampleRate),
      "-ac", "1",
      "-f", "s16le",
      "-"
    ]);
    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (d: Buffer) => chunks.push(d));
    ffmpeg.stderr.on("data", () => {});
    ffmpeg.on("close", (code) => code === 0
      ? resolve(Buffer.concat(chunks))
      : reject(new Error(`ffmpeg exit ${code}`))
    );
    ffmpeg.on("error", reject);
  });
}

async function main() {
  console.log("🔗 Connecting to RTW Socket.IO namespace /rtw ...");
  const startTime = Date.now();

  const socket = ioClient(`${SERVER_URL}/rtw`, {
    transports: ["websocket"],
    timeout: 15000,
  });

  let deltas: string[] = [];
  let finalTranscript = "";

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error("⏰ Test timeout (30s)");
      socket.disconnect();
      reject(new Error("Timeout"));
    }, 30000);

    socket.on("connect", () => {
      console.log(`[${Date.now() - startTime}ms] ✅ Socket.IO connected: ${socket.id}`);
      console.log(`[${Date.now() - startTime}ms] 📤 Sending rtw:init (language: zh)...`);
      socket.emit("rtw:init", { language: "zh" });
    });

    socket.on("rtw:ready", async () => {
      console.log(`[${Date.now() - startTime}ms] ✅ RTW Session ready!`);

      // 載入並傳送音訊
      try {
        console.log(`[${Date.now() - startTime}ms] 🎵 Loading audio: zh-01.mp3...`);
        const pcm = await mp3ToPcm16(AUDIO_PATH);
        console.log(`[${Date.now() - startTime}ms] 📤 Sending PCM16 audio (${pcm.length} bytes)...`);

        const chunkSize = 4800; // 100ms @ 24kHz
        for (let i = 0; i < pcm.length; i += chunkSize) {
          socket.emit("rtw:audio", pcm.slice(i, i + chunkSize));
        }
        console.log(`[${Date.now() - startTime}ms] ✅ Audio sent (${Math.ceil(pcm.length / chunkSize)} chunks)`);
        // 手動 commit 以觸發 Server VAD
        setTimeout(() => {
          console.log(`[${Date.now() - startTime}ms] 📤 Manual commit (Server VAD trigger)...`);
          socket.emit("rtw:commit");
        }, 500);
      } catch (err) {
        console.error("❌ Audio error:", err);
        reject(err);
      }
    });

    socket.on("rtw:speech_started", () => {
      console.log(`[${Date.now() - startTime}ms] 🎙️ Speech started`);
    });

    socket.on("rtw:delta", (data: { delta: string; accumulated: string }) => {
      process.stdout.write(`📝 [${Date.now() - startTime}ms] "${data.delta}"`);
      deltas.push(data.delta);
    });

    socket.on("rtw:final", (data: { transcript: string }) => {
      finalTranscript = data.transcript;
      console.log(`\n✅ [${Date.now() - startTime}ms] RTW Final: "${finalTranscript}"`);
      clearTimeout(timeout);
      socket.disconnect();
      console.log("\n=== Test Summary ===");
      console.log(`Total deltas received: ${deltas.length}`);
      console.log(`Accumulated text: "${deltas.join('')}"`);
      console.log(`Final transcript: "${finalTranscript}"`);
      console.log(`Total time: ${Date.now() - startTime}ms`);
      console.log("✅ RTW Socket.IO test PASSED");
      resolve();
    });

    socket.on("rtw:speech_stopped", (data: { accumulated: string }) => {
      console.log(`\n[${Date.now() - startTime}ms] 🛑 Speech stopped. Accumulated: "${data.accumulated}"`);
      clearTimeout(timeout);
      socket.disconnect();

      console.log("\n=== Test Summary ===");
      console.log(`Total deltas received: ${deltas.length}`);
      console.log(`Accumulated text: "${deltas.join('')}"`);
      console.log(`Final transcript: "${finalTranscript}"`);
      console.log(`Total time: ${Date.now() - startTime}ms`);
      console.log("✅ RTW Socket.IO test PASSED");
      resolve();
    });

    socket.on("rtw:error", (data: { message: string }) => {
      console.error(`❌ RTW Error: ${data.message}`);
      clearTimeout(timeout);
      socket.disconnect();
      reject(new Error(data.message));
    });

    socket.on("rtw:disconnected", () => {
      console.log(`[${Date.now() - startTime}ms] ⚠️ RTW Session disconnected`);
    });

    socket.on("connect_error", (err: Error) => {
      console.error(`❌ Socket.IO connect error: ${err.message}`);
      clearTimeout(timeout);
      reject(err);
    });

    socket.on("disconnect", (reason: string) => {
      console.log(`[${Date.now() - startTime}ms] 🔌 Socket.IO disconnected: ${reason}`);
    });
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Test FAILED:", err.message);
    process.exit(1);
  });
