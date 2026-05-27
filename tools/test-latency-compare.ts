/**
 * ASR 延遲分解比較：gpt-realtime-whisper vs gpt-4o-transcribe (Batch)
 *
 * 測量各環節耗時，找出瓶頸差異
 *
 * gpt-realtime-whisper 延遲拆解：
 *   A. WebSocket 握手（TLS + TCP）
 *   B. session.created 回應
 *   C. session.updated 回應（session 設定完成）
 *   D. ffmpeg MP3→PCM 轉換
 *   E. 音訊分塊傳送（最後一個 chunk 送出）
 *   F. commit → committed 確認
 *   G. committed → 首個 delta（ASR 開始輸出）
 *   H. 首個 delta → completed（ASR 完成輸出）
 *
 * gpt-4o-transcribe (Batch) 延遲拆解：
 *   A. HTTP 連線建立
 *   B. 上傳音訊（multipart POST）
 *   C. 伺服器處理（模型推理）
 *   D. 回應傳輸
 */
import "dotenv/config";
import WebSocket from "ws";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.OPENAI_API_KEY!;
const WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription";

// 三句不同長度的護理場景句子
const TEST_CASES = [
  { id: "zh-01", file: "zh-01.mp3", text: "請問您今天哪裡不舒服？",           audioDurationMs: 2016 },
  { id: "zh-05", file: "zh-05.mp3", text: "這個藥一天吃三次，每次一顆，飯後服用。", audioDurationMs: 3816 },
  { id: "zh-09", file: "zh-09.mp3", text: "請您先做一個血液檢查，報告大概兩個小時後出來。", audioDurationMs: 4656 },
];

// ─── ffmpeg 轉換 ───────────────────────────────────────────────────────────────
async function mp3ToPcm16(audioPath: string, sampleRate = 24000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-i", audioPath, "-ar", String(sampleRate), "-ac", "1", "-f", "s16le", "-"]);
    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (d: Buffer) => chunks.push(d));
    ffmpeg.stderr.on("data", () => {});
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited ${code}`));
    });
    ffmpeg.on("error", reject);
  });
}

// ─── gpt-realtime-whisper ──────────────────────────────────────────────────────
interface RealtimeBreakdown {
  t_ws_connect: number;
  t_session_created: number;
  t_session_updated: number;
  t_ffmpeg: number;
  t_audio_send: number;
  t_commit_ack: number;
  t_first_delta: number;
  t_final_from_delta: number;
  t_final_from_commit: number;  // 純 ASR 推理
  total: number;
  transcript: string;
}

async function measureRealtime(tc: typeof TEST_CASES[0]): Promise<RealtimeBreakdown> {
  const audioPath = path.join(__dirname, "audio", tc.file);

  // 預先 ffmpeg 轉換（計時）
  const ffmpegStart = Date.now();
  const pcmBuffer = await mp3ToPcm16(audioPath, 24000);
  const t_ffmpeg = Date.now() - ffmpegStart;

  return new Promise((resolve) => {
    const T0 = Date.now();
    let T1 = 0, T2 = 0, T3 = 0, T5 = 0, T6 = 0, T7 = 0, T8 = 0;
    let transcript = "";
    let resolved = false;
    let sessionReady = false;

    const ws = new WebSocket(WS_URL, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; ws.close(); resolve({ t_ws_connect: T1-T0, t_session_created: T2-T1, t_session_updated: T3-T2, t_ffmpeg, t_audio_send: T5-T3, t_commit_ack: T6-T5, t_first_delta: T7-T6, t_final_from_delta: T8-T7, t_final_from_commit: T8-T6, total: Date.now()-T0, transcript: "(timeout)" }); }
    }, 20000);

    ws.on("open", () => {
      T1 = Date.now();
      ws.send(JSON.stringify({ type: "session.update", session: { type: "transcription", audio: { input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { model: "gpt-realtime-whisper", language: "zh", delay: "low" } } } } }));
    });

    ws.on("message", async (data: WebSocket.Data) => {
      const event = JSON.parse(data.toString());
      const now = Date.now();
      switch (event.type) {
        case "session.created": T2 = now; break;
        case "session.updated":
          T3 = now;
          if (!sessionReady) {
            sessionReady = true;
            const chunkSize = 4800;
            for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
              ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcmBuffer.slice(i, i + chunkSize).toString("base64") }));
              await new Promise(r => setTimeout(r, 5));
            }
            T5 = Date.now();
            ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          }
          break;
        case "input_audio_buffer.committed": T6 = Date.now(); break;
        case "conversation.item.input_audio_transcription.delta":
          if (T7 === 0) T7 = Date.now();
          transcript += event.delta || "";
          break;
        case "conversation.item.input_audio_transcription.completed":
          T8 = Date.now();
          transcript = event.transcript || transcript;
          if (!resolved) {
            resolved = true; clearTimeout(timer); ws.close();
            resolve({ t_ws_connect: T1-T0, t_session_created: T2-T1, t_session_updated: T3-T2, t_ffmpeg, t_audio_send: T5-T3, t_commit_ack: T6-T5, t_first_delta: T7-T6, t_final_from_delta: T8-T7, t_final_from_commit: T8-T6, total: T8-T0, transcript });
          }
          break;
        case "error":
          if (!resolved) { resolved = true; clearTimeout(timer); ws.close(); resolve({ t_ws_connect: T1-T0, t_session_created: T2-T1, t_session_updated: T3-T2, t_ffmpeg, t_audio_send: 0, t_commit_ack: 0, t_first_delta: 0, t_final_from_delta: 0, t_final_from_commit: 0, total: now-T0, transcript: `ERR: ${event.error?.message}` }); }
          break;
      }
    });
    ws.on("error", (err: Error) => {
      if (!resolved) { resolved = true; clearTimeout(timer); resolve({ t_ws_connect: 0, t_session_created: 0, t_session_updated: 0, t_ffmpeg, t_audio_send: 0, t_commit_ack: 0, t_first_delta: 0, t_final_from_delta: 0, t_final_from_commit: 0, total: 0, transcript: `WS ERR: ${err.message}` }); }
    });
  });
}

// ─── gpt-4o-transcribe (Batch) ─────────────────────────────────────────────────
interface BatchBreakdown {
  t_http_connect: number;   // 無法直接測量，估算
  t_upload: number;         // 從請求開始到伺服器收到（估算：總時間 - 推理時間）
  t_inference: number;      // 伺服器推理（無法直接分離，以總時間近似）
  total: number;
  transcript: string;
}

async function measureBatch(tc: typeof TEST_CASES[0]): Promise<BatchBreakdown> {
  const audioPath = path.join(__dirname, "audio", tc.file);
  const client = new OpenAI({ apiKey: API_KEY });

  const T0 = Date.now();
  try {
    const transcription = await client.audio.transcriptions.create({
      model: "gpt-4o-transcribe",
      file: fs.createReadStream(audioPath),
      language: "zh",
      prompt: "請使用繁體中文輸出。以下是醫療對話內容：",
    });
    const total = Date.now() - T0;
    const transcript = transcription.text || "";
    // Batch 無法細分各環節，以音訊大小估算上傳時間
    const fileSize = fs.statSync(audioPath).size;
    const estimatedUploadMs = Math.round(fileSize / 1024 / 10); // 假設 10KB/ms 上傳速度
    return {
      t_http_connect: 80,  // 典型 HTTPS 連線建立
      t_upload: estimatedUploadMs,
      t_inference: total - estimatedUploadMs - 80,
      total,
      transcript,
    };
  } catch (err) {
    return { t_http_connect: 0, t_upload: 0, t_inference: 0, total: Date.now()-T0, transcript: `ERR: ${err}` };
  }
}

// ─── 輸出格式化 ────────────────────────────────────────────────────────────────
function bar(ms: number, maxMs: number, width = 25): string {
  const filled = Math.max(0, Math.round((ms / maxMs) * width));
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

function pct(ms: number, total: number): string {
  return `${Math.round(ms / total * 100)}%`.padStart(4);
}

// ─── 主程式 ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═".repeat(70));
  console.log("  ASR 延遲分解比較：gpt-realtime-whisper vs gpt-4o-transcribe");
  console.log("═".repeat(70));

  const realtimeResults: Array<{ tc: typeof TEST_CASES[0]; r: RealtimeBreakdown }> = [];
  const batchResults: Array<{ tc: typeof TEST_CASES[0]; r: BatchBreakdown }> = [];

  // 交替測試，避免網路波動影響
  for (const tc of TEST_CASES) {
    process.stdout.write(`\n▶ ${tc.id} (音訊 ${tc.audioDurationMs}ms): `);
    process.stdout.write("realtime...");
    const rt = await measureRealtime(tc);
    realtimeResults.push({ tc, r: rt });
    process.stdout.write(` ${rt.total}ms | `);
    await new Promise(r => setTimeout(r, 500));

    process.stdout.write("batch...");
    const bt = await measureBatch(tc);
    batchResults.push({ tc, r: bt });
    process.stdout.write(` ${bt.total}ms\n`);
    await new Promise(r => setTimeout(r, 500));
  }

  // ── 詳細分解表 ────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(70));
  console.log("  【gpt-realtime-whisper】各環節耗時");
  console.log("═".repeat(70));

  for (const { tc, r } of realtimeResults) {
    const maxMs = r.total;
    console.log(`\n  ${tc.id}  音訊 ${tc.audioDurationMs}ms | 總計 ${r.total}ms | "${r.transcript}"`);
    console.log(`  ${"環節".padEnd(22)} ${"耗時".padStart(6)}  ${"佔比".padStart(4)}  視覺化`);
    console.log(`  ${"─".repeat(60)}`);
    const rows = [
      ["A. WebSocket 握手",       r.t_ws_connect],
      ["B. session.created",      r.t_session_created],
      ["C. session.updated",      r.t_session_updated],
      ["   └ (ffmpeg 轉換)",      r.t_ffmpeg],
      ["D. 音訊分塊傳送",         r.t_audio_send],
      ["E. commit→committed",     r.t_commit_ack],
      ["F. committed→首個delta",  r.t_first_delta],
      ["G. delta→completed",      r.t_final_from_delta],
    ];
    for (const [label, ms] of rows) {
      const msNum = ms as number;
      const isSubItem = (label as string).startsWith("   ");
      const prefix = isSubItem ? "  " : "  ";
      console.log(`${prefix}${(label as string).padEnd(22)} ${String(msNum).padStart(6)}ms  ${pct(msNum, maxMs)}  ${bar(msNum, maxMs)}`);
    }
    console.log(`  ${"─".repeat(60)}`);
    console.log(`  ${"★ 純 ASR 推理 (F+G)".padEnd(22)} ${String(r.t_final_from_commit).padStart(6)}ms  ${pct(r.t_final_from_commit, maxMs)}`);
    console.log(`  ${"★ 連線建立 (A+B+C)".padEnd(22)} ${String(r.t_ws_connect+r.t_session_created+r.t_session_updated).padStart(6)}ms  ${pct(r.t_ws_connect+r.t_session_created+r.t_session_updated, maxMs)}`);
    console.log(`  ${"★ 音訊傳輸 (D+E)".padEnd(22)} ${String(r.t_audio_send+r.t_commit_ack).padStart(6)}ms  ${pct(r.t_audio_send+r.t_commit_ack, maxMs)}`);
  }

  console.log("\n" + "═".repeat(70));
  console.log("  【gpt-4o-transcribe Batch】各環節耗時（部分為估算值）");
  console.log("═".repeat(70));

  for (const { tc, r } of batchResults) {
    const maxMs = r.total;
    console.log(`\n  ${tc.id}  音訊 ${tc.audioDurationMs}ms | 總計 ${r.total}ms | "${r.transcript}"`);
    console.log(`  ${"環節".padEnd(22)} ${"耗時".padStart(6)}  ${"佔比".padStart(4)}  視覺化`);
    console.log(`  ${"─".repeat(60)}`);
    const rows = [
      ["A. HTTPS 連線建立 (估)",  r.t_http_connect],
      ["B. 音訊上傳 (估)",        r.t_upload],
      ["C. 伺服器推理+回應",      r.t_inference],
    ];
    for (const [label, ms] of rows) {
      console.log(`  ${(label as string).padEnd(22)} ${String(ms as number).padStart(6)}ms  ${pct(ms as number, maxMs)}  ${bar(ms as number, maxMs)}`);
    }
  }

  // ── 並排比較摘要 ──────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(70));
  console.log("  並排比較摘要（平均值）");
  console.log("═".repeat(70));

  const avgRT = (key: keyof RealtimeBreakdown) =>
    Math.round(realtimeResults.reduce((s, { r }) => s + (r[key] as number), 0) / realtimeResults.length);
  const avgBT = (key: keyof BatchBreakdown) =>
    Math.round(batchResults.reduce((s, { r }) => s + (r[key] as number), 0) / batchResults.length);

  const rtTotal = avgRT("total");
  const btTotal = avgBT("total");
  const rtConn  = avgRT("t_ws_connect") + avgRT("t_session_created") + avgRT("t_session_updated");
  const rtAudio = avgRT("t_audio_send") + avgRT("t_commit_ack");
  const rtASR   = avgRT("t_final_from_commit");

  console.log(`\n  ${"指標".padEnd(28)} ${"Realtime".padStart(10)} ${"Batch".padStart(10)} ${"差異".padStart(10)}`);
  console.log(`  ${"─".repeat(60)}`);
  console.log(`  ${"總延遲".padEnd(28)} ${String(rtTotal+"ms").padStart(10)} ${String(btTotal+"ms").padStart(10)} ${String((btTotal-rtTotal > 0 ? "Batch+" : "RT+") + Math.abs(btTotal-rtTotal)+"ms").padStart(10)}`);
  console.log(`  ${"連線建立開銷".padEnd(28)} ${String(rtConn+"ms").padStart(10)} ${"~80ms".padStart(10)} ${String("RT多+"+(rtConn-80)+"ms").padStart(10)}`);
  console.log(`  ${"音訊傳輸開銷".padEnd(28)} ${String(rtAudio+"ms").padStart(10)} ${"含在總計".padStart(10)} ${"─".padStart(10)}`);
  console.log(`  ${"純 ASR 推理時間".padEnd(28)} ${String(rtASR+"ms").padStart(10)} ${"無法分離".padStart(10)} ${"─".padStart(10)}`);
  console.log(`  ${"首字延遲 (串流優勢)".padEnd(28)} ${String(avgRT("t_ws_connect")+avgRT("t_session_created")+avgRT("t_session_updated")+avgRT("t_audio_send")+avgRT("t_commit_ack")+avgRT("t_first_delta")+"ms").padStart(10)} ${"N/A".padStart(10)} ${"Realtime 獨有".padStart(10)}`);
  console.log(`  ${"─".repeat(60)}`);

  console.log(`
  📌 關鍵發現：

  1. Batch 總延遲 ${btTotal}ms vs Realtime ${rtTotal}ms
     ${btTotal > rtTotal ? `→ Batch 慢 ${btTotal-rtTotal}ms（${Math.round((btTotal-rtTotal)/rtTotal*100)}%）` : `→ Realtime 慢 ${rtTotal-btTotal}ms（${Math.round((rtTotal-btTotal)/btTotal*100)}%）`}

  2. Realtime 連線建立開銷 ${rtConn}ms（WebSocket TLS 握手）
     → 可透過「預建連線池」消除，理論總延遲降至 ~${rtTotal-rtConn}ms

  3. Realtime 純 ASR 推理 ${rtASR}ms（committed → completed）
     → 模型固有延遲，無法優化

  4. Realtime 獨有優勢：首字延遲（串流輸出）
     → 使用者可在 ~${avgRT("t_ws_connect")+avgRT("t_session_created")+avgRT("t_session_updated")+avgRT("t_audio_send")+avgRT("t_commit_ack")+avgRT("t_first_delta")}ms 後看到第一個字
     → Batch 模式必須等待全部完成才輸出

  5. Batch 優勢：無連線建立開銷，架構更簡單
     → 適合非即時場景（事後轉錄、批量處理）
  `);
}

main().catch(console.error);
