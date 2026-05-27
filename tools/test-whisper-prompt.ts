/**
 * 測試 gpt-realtime-whisper 加入繁體中文 prompt 的效果
 * 觀察 API 原始回應，確認 prompt 欄位是否被接受
 */
import "dotenv/config";
import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY!;
const WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
const AUDIO_PATH = path.join(__dirname, "audio/zh-01.mp3");

async function mp3ToPcm16(audioPath: string, sampleRate = 24000): Promise<Buffer> {
  const { spawn } = await import("child_process");
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-i", audioPath, "-ar", String(sampleRate), "-ac", "1", "-f", "s16le", "-"]);
    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (d: Buffer) => chunks.push(d));
    ffmpeg.stderr.on("data", () => {});
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    ffmpeg.on("error", reject);
  });
}

// 測試不同的 session.update 格式
async function testWithPromptInTranscription() {
  console.log("\n=== 測試 1: prompt 放在 transcription 物件內 ===");
  return runTest({
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          transcription: {
            model: "gpt-realtime-whisper",
            language: "zh",
            prompt: "請使用繁體中文輸出。Traditional Chinese (zh-TW) only.",
            delay: "low",
          },
        },
      },
    },
  });
}

async function testWithPromptInInput() {
  console.log("\n=== 測試 2: prompt 放在 input 層級 ===");
  return runTest({
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          transcription: {
            model: "gpt-realtime-whisper",
            language: "zh",
            delay: "low",
          },
          prompt: "請使用繁體中文輸出。Traditional Chinese (zh-TW) only.",
        },
      },
    },
  });
}

async function testWithInstructions() {
  console.log("\n=== 測試 3: instructions 放在 session 層級 ===");
  return runTest({
    type: "session.update",
    session: {
      type: "transcription",
      instructions: "請使用繁體中文輸出。Traditional Chinese (zh-TW) only.",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          transcription: {
            model: "gpt-realtime-whisper",
            language: "zh",
            delay: "low",
          },
        },
      },
    },
  });
}

async function testNoPrompt() {
  console.log("\n=== 測試 4: 無 prompt（基準線）===");
  return runTest({
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          transcription: {
            model: "gpt-realtime-whisper",
            language: "zh",
            delay: "low",
          },
        },
      },
    },
  });
}

function runTest(sessionUpdate: object): Promise<{ transcript: string; error?: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "OpenAI-Safety-Identifier": "benchmark-test",
      },
    });

    let transcript = "";
    let resolved = false;
    let sessionReady = false;
    const startTime = Date.now();

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve({ transcript, error: "Timeout 15s" });
      }
    }, 15000);

    ws.on("open", () => {
      console.log("  ✅ WebSocket 連接成功");
      ws.send(JSON.stringify(sessionUpdate));
    });

    ws.on("message", async (data: WebSocket.Data) => {
      const event = JSON.parse(data.toString());
      const elapsed = Date.now() - startTime;

      // 顯示所有事件類型
      if (event.type !== "conversation.item.input_audio_transcription.delta") {
        console.log(`  [${elapsed}ms] 事件: ${event.type}`);
        if (event.type === "error") {
          console.log(`  ❌ 錯誤: ${JSON.stringify(event.error)}`);
        }
        if (event.type === "session.updated") {
          // 顯示 session 設定確認
          const sess = event.session as Record<string, unknown>;
          const audio = sess.audio as Record<string, unknown> | undefined;
          const input = audio?.input as Record<string, unknown> | undefined;
          const transcription = input?.transcription as Record<string, unknown> | undefined;
          console.log(`  Session model: ${transcription?.model}, language: ${transcription?.language}, prompt: ${transcription?.prompt ? "✅ 有" : "❌ 無"}`);
        }
      }

      if (event.type === "session.created" || event.type === "session.updated") {
        if (!sessionReady) {
          sessionReady = true;
          try {
            const pcmBuffer = await mp3ToPcm16(AUDIO_PATH, 24000);
            const chunkSize = 4800;
            for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
              const chunk = pcmBuffer.slice(i, i + chunkSize);
              ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk.toString("base64") }));
              await new Promise((r) => setTimeout(r, 10));
            }
            ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
            console.log(`  [${Date.now() - startTime}ms] 音訊已送出`);
          } catch (err) {
            console.log(`  ❌ 音訊處理失敗: ${err}`);
            resolved = true;
            clearTimeout(timer);
            ws.close();
            resolve({ transcript: "", error: String(err) });
          }
        }
      }

      if (event.type === "conversation.item.input_audio_transcription.delta") {
        transcript += event.delta || "";
      }

      if (event.type === "conversation.item.input_audio_transcription.completed") {
        transcript = event.transcript || transcript;
        console.log(`  [${elapsed}ms] 轉錄完成: "${transcript}"`);
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          ws.close();
          resolve({ transcript });
        }
      }

      if (event.type === "error") {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          ws.close();
          resolve({ transcript, error: event.error?.message || JSON.stringify(event.error) });
        }
      }
    });

    ws.on("error", (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ transcript, error: err.message });
      }
    });
  });
}

async function main() {
  console.log("🔬 gpt-realtime-whisper 繁體中文 Prompt 測試");
  console.log(`音訊: ${AUDIO_PATH}`);
  console.log(`預期: "請問您今天哪裡不舒服？"`);

  const r1 = await testWithPromptInTranscription();
  console.log(`  結果: "${r1.transcript}" ${r1.error ? `(錯誤: ${r1.error})` : ""}`);

  await new Promise(r => setTimeout(r, 1000));

  const r4 = await testNoPrompt();
  console.log(`  結果: "${r4.transcript}" ${r4.error ? `(錯誤: ${r4.error})` : ""}`);

  await new Promise(r => setTimeout(r, 1000));

  const r3 = await testWithInstructions();
  console.log(`  結果: "${r3.transcript}" ${r3.error ? `(錯誤: ${r3.error})` : ""}`);

  console.log("\n📊 比較結果：");
  console.log(`  prompt in transcription: "${r1.transcript}"`);
  console.log(`  無 prompt (基準):        "${r4.transcript}"`);
  console.log(`  instructions:            "${r3.transcript}"`);
}

main().catch(console.error);
