/**
 * gpt-realtime-whisper 延遲分解分析
 * 精確測量每個環節的耗時
 *
 * 延遲拆解：
 *   T0: 開始
 *   T1: WebSocket 連接建立
 *   T2: session.created 收到
 *   T3: session.updated 收到（session 設定完成）
 *   T4: ffmpeg 轉換完成（MP3 → PCM16）
 *   T5: 音訊分塊傳送完成（最後一個 chunk 送出）
 *   T6: input_audio_buffer.committed 收到
 *   T7: 首個 delta 收到（firstPartialMs）
 *   T8: transcription.completed 收到（finalMs）
 */
import "dotenv/config";
import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY!;
const WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription";

// 測試不同長度的句子
const TEST_CASES = [
  { id: "zh-01", file: "zh-01.mp3", text: "請問您今天哪裡不舒服？" },
  { id: "zh-05", file: "zh-05.mp3", text: "這個藥一天吃三次，每次一顆，飯後服用。" },
  { id: "zh-09", file: "zh-09.mp3", text: "請您先做一個血液檢查，報告大概兩個小時後出來。" },
];

async function mp3ToPcm16(audioPath: string, sampleRate = 24000): Promise<{ buffer: Buffer; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-i", audioPath, "-ar", String(sampleRate), "-ac", "1", "-f", "s16le", "-"]);
    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (d: Buffer) => chunks.push(d));
    ffmpeg.stderr.on("data", () => {});
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        const buffer = Buffer.concat(chunks);
        // PCM16 @ 24kHz mono: 2 bytes/sample, 24000 samples/sec
        const durationMs = (buffer.length / 2 / 24000) * 1000;
        resolve({ buffer, durationMs });
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
    ffmpeg.on("error", reject);
  });
}

interface LatencyBreakdown {
  id: string;
  audioDurationMs: number;
  t_ws_connect: number;       // T0→T1: WebSocket 握手
  t_session_created: number;  // T1→T2: session.created 回應
  t_session_updated: number;  // T2→T3: session.updated 回應（含 ffmpeg 轉換）
  t_ffmpeg_convert: number;   // 單獨計時 ffmpeg
  t_audio_send: number;       // T3→T5: 音訊分塊傳送
  t_commit_ack: number;       // T5→T6: commit → committed 確認
  t_first_partial: number;    // T6→T7: committed → 首個 delta
  t_final_from_partial: number; // T7→T8: 首個 delta → completed
  t_final_from_commit: number;  // T6→T8: committed → completed（純 ASR 推理時間）
  total: number;              // T0→T8
  transcribedText: string;
}

async function analyzeLatency(testCase: typeof TEST_CASES[0]): Promise<LatencyBreakdown> {
  const audioPath = path.join(__dirname, "audio", testCase.file);

  // 預先計時 ffmpeg 轉換
  const ffmpegStart = Date.now();
  const { buffer: pcmBuffer, durationMs: audioDurationMs } = await mp3ToPcm16(audioPath, 24000);
  const t_ffmpeg_convert = Date.now() - ffmpegStart;

  return new Promise((resolve) => {
    const T0 = Date.now();
    let T1 = 0, T2 = 0, T3 = 0, T5 = 0, T6 = 0, T7 = 0, T8 = 0;
    let transcribedText = "";
    let resolved = false;
    let sessionReady = false;

    const ws = new WebSocket(WS_URL, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "OpenAI-Safety-Identifier": "latency-analysis",
      },
    });

    T1 = Date.now(); // WebSocket 物件建立（實際握手在 open 事件）

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve({
          id: testCase.id,
          audioDurationMs,
          t_ws_connect: T1 - T0,
          t_session_created: T2 - T1,
          t_session_updated: T3 - T2,
          t_ffmpeg_convert,
          t_audio_send: T5 - T3,
          t_commit_ack: T6 - T5,
          t_first_partial: T7 - T6,
          t_final_from_partial: T8 - T7,
          t_final_from_commit: T8 - T6,
          total: T8 - T0,
          transcribedText: "(timeout)",
        });
      }
    }, 20000);

    ws.on("open", () => {
      T1 = Date.now(); // 實際握手完成時間
      ws.send(JSON.stringify({
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
      }));
    });

    ws.on("message", async (data: WebSocket.Data) => {
      const event = JSON.parse(data.toString());
      const now = Date.now();

      switch (event.type) {
        case "session.created":
          T2 = now;
          break;

        case "session.updated":
          T3 = now;
          if (!sessionReady) {
            sessionReady = true;
            // 分塊傳送音訊
            const chunkSize = 4800; // 100ms @ 24kHz 16bit mono
            for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
              const chunk = pcmBuffer.slice(i, i + chunkSize);
              ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk.toString("base64") }));
              await new Promise((r) => setTimeout(r, 5));
            }
            T5 = Date.now();
            ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          }
          break;

        case "input_audio_buffer.committed":
          T6 = Date.now();
          break;

        case "conversation.item.input_audio_transcription.delta":
          if (T7 === 0) T7 = Date.now();
          transcribedText += event.delta || "";
          break;

        case "conversation.item.input_audio_transcription.completed":
          T8 = Date.now();
          transcribedText = event.transcript || transcribedText;
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            ws.close();
            resolve({
              id: testCase.id,
              audioDurationMs,
              t_ws_connect: T1 - T0,
              t_session_created: T2 - T1,
              t_session_updated: T3 - T2,
              t_ffmpeg_convert,
              t_audio_send: T5 - T3,
              t_commit_ack: T6 - T5,
              t_first_partial: T7 - T6,
              t_final_from_partial: T8 - T7,
              t_final_from_commit: T8 - T6,
              total: T8 - T0,
              transcribedText,
            });
          }
          break;

        case "error":
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            ws.close();
            resolve({
              id: testCase.id,
              audioDurationMs,
              t_ws_connect: T1 - T0,
              t_session_created: T2 - T1,
              t_session_updated: T3 - T2,
              t_ffmpeg_convert,
              t_audio_send: T5 - T3,
              t_commit_ack: T6 - T5,
              t_first_partial: 0,
              t_final_from_partial: 0,
              t_final_from_commit: 0,
              total: now - T0,
              transcribedText: `ERROR: ${event.error?.message}`,
            });
          }
          break;
      }
    });

    ws.on("error", (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({
          id: testCase.id,
          audioDurationMs,
          t_ws_connect: 0,
          t_session_created: 0,
          t_session_updated: 0,
          t_ffmpeg_convert,
          t_audio_send: 0,
          t_commit_ack: 0,
          t_first_partial: 0,
          t_final_from_partial: 0,
          t_final_from_commit: 0,
          total: 0,
          transcribedText: `WS ERROR: ${err.message}`,
        });
      }
    });
  });
}

function bar(ms: number, total: number, width = 30): string {
  const filled = Math.round((ms / total) * width);
  return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, width - filled));
}

async function main() {
  console.log("═".repeat(65));
  console.log("  gpt-realtime-whisper 延遲分解分析");
  console.log("═".repeat(65));

  const results: LatencyBreakdown[] = [];

  for (const tc of TEST_CASES) {
    console.log(`\n▶ 測試 ${tc.id}: "${tc.text}"`);
    const r = await analyzeLatency(tc);
    results.push(r);
    console.log(`  音訊長度: ${r.audioDurationMs.toFixed(0)}ms`);
    console.log(`  轉錄結果: "${r.transcribedText}"`);
    console.log(`  總延遲:   ${r.total}ms`);
    await new Promise(res => setTimeout(res, 800));
  }

  console.log("\n" + "═".repeat(65));
  console.log("  詳細延遲分解（各環節耗時）");
  console.log("═".repeat(65));

  for (const r of results) {
    const total = r.total;
    console.log(`\n【${r.id}】音訊長度 ${r.audioDurationMs.toFixed(0)}ms | 總延遲 ${total}ms`);
    console.log(`  ┌─ 階段                    耗時      佔比  視覺化`);
    console.log(`  ├─ WebSocket 握手         ${String(r.t_ws_connect).padStart(5)}ms  ${String(Math.round(r.t_ws_connect/total*100)).padStart(3)}%  ${bar(r.t_ws_connect, total)}`);
    console.log(`  ├─ session.created 回應   ${String(r.t_session_created).padStart(5)}ms  ${String(Math.round(r.t_session_created/total*100)).padStart(3)}%  ${bar(r.t_session_created, total)}`);
    console.log(`  ├─ session.updated 回應   ${String(r.t_session_updated).padStart(5)}ms  ${String(Math.round(r.t_session_updated/total*100)).padStart(3)}%  ${bar(r.t_session_updated, total)}`);
    console.log(`  │    └ (ffmpeg 轉換)      ${String(r.t_ffmpeg_convert).padStart(5)}ms  ${String(Math.round(r.t_ffmpeg_convert/total*100)).padStart(3)}%  ${bar(r.t_ffmpeg_convert, total)}`);
    console.log(`  ├─ 音訊分塊傳送           ${String(r.t_audio_send).padStart(5)}ms  ${String(Math.round(r.t_audio_send/total*100)).padStart(3)}%  ${bar(r.t_audio_send, total)}`);
    console.log(`  ├─ commit → committed     ${String(r.t_commit_ack).padStart(5)}ms  ${String(Math.round(r.t_commit_ack/total*100)).padStart(3)}%  ${bar(r.t_commit_ack, total)}`);
    console.log(`  ├─ committed → 首個delta  ${String(r.t_first_partial).padStart(5)}ms  ${String(Math.round(r.t_first_partial/total*100)).padStart(3)}%  ${bar(r.t_first_partial, total)}`);
    console.log(`  └─ 首個delta → completed  ${String(r.t_final_from_partial).padStart(5)}ms  ${String(Math.round(r.t_final_from_partial/total*100)).padStart(3)}%  ${bar(r.t_final_from_partial, total)}`);
    console.log(`  ─────────────────────────────────────────────────────`);
    console.log(`     純 ASR 推理時間         ${String(r.t_final_from_commit).padStart(5)}ms  ${String(Math.round(r.t_final_from_commit/total*100)).padStart(3)}%  (committed → completed)`);
    console.log(`     連線建立開銷            ${String(r.t_ws_connect + r.t_session_created + r.t_session_updated).padStart(5)}ms  ${String(Math.round((r.t_ws_connect + r.t_session_created + r.t_session_updated)/total*100)).padStart(3)}%  (WS + session)`);
    console.log(`     音訊傳輸開銷            ${String(r.t_audio_send + r.t_commit_ack).padStart(5)}ms  ${String(Math.round((r.t_audio_send + r.t_commit_ack)/total*100)).padStart(3)}%  (send + commit)`);
  }

  // 平均值摘要
  const avg = (key: keyof LatencyBreakdown) =>
    Math.round(results.reduce((s, r) => s + (r[key] as number), 0) / results.length);

  console.log("\n" + "═".repeat(65));
  console.log("  平均值摘要");
  console.log("═".repeat(65));
  const avgTotal = avg("total");
  console.log(`  總延遲:           ${avgTotal}ms`);
  console.log(`  ├─ 連線建立:      ${avg("t_ws_connect") + avg("t_session_created") + avg("t_session_updated")}ms  (WS握手 + session.created + session.updated)`);
  console.log(`  │    ffmpeg轉換:  ${avg("t_ffmpeg_convert")}ms  (含在連線建立期間並行執行)`);
  console.log(`  ├─ 音訊傳輸:      ${avg("t_audio_send") + avg("t_commit_ack")}ms  (分塊send + commit確認)`);
  console.log(`  └─ ASR 推理:      ${avg("t_final_from_commit")}ms  (committed → completed)`);
  console.log(`\n  ⚡ 優化潛力：`);
  const connOverhead = avg("t_ws_connect") + avg("t_session_created") + avg("t_session_updated");
  const audioOverhead = avg("t_audio_send") + avg("t_commit_ack");
  const asrTime = avg("t_final_from_commit");
  console.log(`     連線建立 ${connOverhead}ms → 可透過「連線池/預建連線」消除`);
  console.log(`     音訊傳輸 ${audioOverhead}ms → 可透過「邊錄邊傳（VAD串流）」消除`);
  console.log(`     ASR推理  ${asrTime}ms → 模型固有延遲，無法優化`);
  console.log(`     理論最低延遲: ~${asrTime}ms（若預建連線 + 即時串流）`);
}

main().catch(console.error);
