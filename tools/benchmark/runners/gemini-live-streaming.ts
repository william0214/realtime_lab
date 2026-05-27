/**
 * Gemini 3.1 Flash Live Preview Runner — 串流模式（Streaming + VAD）
 *
 * 與 gemini-live.ts（離線模式）的差異：
 *   - 離線模式：等音訊全部轉換完 → 一次性送入所有塊 → activityEnd
 *   - 串流模式：邊轉換邊送入（模擬即時錄音）→ VAD 偵測靜音 → activityEnd
 *
 * 串流模式的優勢：
 *   - Gemini 在接收第一個音訊塊時就開始 ASR，不需等全部音訊到齊
 *   - 理論上可節省整段音訊時長的延遲（2s 音訊 → 節省 ~500ms）
 *
 * VAD 邏輯：
 *   - 計算每個 100ms 音訊塊的 RMS 能量
 *   - 靜音（能量 < threshold）超過 silenceDurationMs 後送出 activityEnd
 *   - 防抖：避免說話中間短暫停頓誤判為句子結束
 *
 * 計時說明：
 *   - startTime = 開始送入第一個音訊塊的時間（模擬使用者開口的時刻）
 *   - 這樣延遲數字才能與真實產品比較（不含 setup 時間）
 */

import WebSocket from "ws";
import * as fs from "fs";
import { execSync } from "child_process";
import type { TestSentence, SingleRunResult } from "../types.js";

const GEMINI_MODEL = "gemini-3.1-flash-live-preview";
const GEMINI_WS_ENDPOINT = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`;

// ============================================================
// VAD 設定
// ============================================================
const VAD_CONFIG = {
  energyThreshold: 0.015,   // RMS 能量閾值（0-1），低於此值視為靜音
  chunkMs: 100,              // 每塊音訊時長（ms）
  silenceDurationMs: 300,    // 靜音超過此時間才送 activityEnd（防抖）
  speechFrameCount: 2,       // 連續 N 塊有聲才確認語音開始
};

// ============================================================
// 音訊工具
// ============================================================

/** 將音訊檔案轉換為 PCM16 16kHz */
function convertToPcm16(audioPath: string): Buffer {
  const tmpPath = `/tmp/gemini-stream-pcm-${Date.now()}.raw`;
  execSync(`ffmpeg -y -i "${audioPath}" -ar 16000 -ac 1 -f s16le "${tmpPath}" 2>/dev/null`);
  const buf = fs.readFileSync(tmpPath);
  try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  return buf;
}

/** 計算 PCM16 緩衝區的 RMS 能量（0-1 正規化） */
function computeRmsEnergy(pcmChunk: Buffer): number {
  if (pcmChunk.length < 2) return 0;
  let squareSum = 0;
  const sampleCount = Math.floor(pcmChunk.length / 2);
  for (let i = 0; i < pcmChunk.length - 1; i += 2) {
    const sample = pcmChunk.readInt16LE(i);
    squareSum += sample * sample;
  }
  return Math.sqrt(squareSum / sampleCount) / 32768;
}

// ============================================================
// 串流 Runner
// ============================================================

export async function runGeminiLiveStreaming(
  sentence: TestSentence,
  audioPath: string,
  sourceLang: string,
  targetLang: string,
  apiKey: string,
  timeoutMs: number,
  verbose: boolean
): Promise<SingleRunResult> {

  const langNames: Record<string, string> = {
    zh: "Traditional Chinese (繁體中文)",
    en: "English",
    vi: "Vietnamese",
    id: "Indonesian",
    th: "Thai",
    ja: "Japanese",
  };
  const sourceLangName = langNames[sourceLang] || sourceLang;
  const targetLangName = langNames[targetLang] || targetLang;

  // 預先轉換整段 PCM16（模擬已有音訊緩衝的情況）
  // 在真實產品中，這步驟不存在（AudioWorklet 直接輸出 PCM16）
  const pcmBuf = convertToPcm16(audioPath);
  const bytesPerMs = (16000 * 2) / 1000; // 16kHz, 16-bit = 32 bytes/ms
  const chunkBytes = Math.round(VAD_CONFIG.chunkMs * bytesPerMs); // 100ms = 3200 bytes

  // 切割成 100ms 塊
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < pcmBuf.length; offset += chunkBytes) {
    chunks.push(pcmBuf.slice(offset, offset + chunkBytes));
  }

  if (verbose) {
    console.log(`[gemini-stream] 🎵 PCM16: ${pcmBuf.length} bytes → ${chunks.length} 塊 × ${VAD_CONFIG.chunkMs}ms`);
  }

  return new Promise((resolve) => {
    // startTime 從「開始串流」時計算（不含 setup 時間）
    // 這樣延遲數字才能代表真實使用場景（連線已預建）
    let streamStartTime: number | null = null;
    const setupStartTime = Date.now();

    let firstPartialMs: number | null = null;
    let finalTranscriptMs: number | null = null;
    let translationMs: number | null = null;
    let inputTranscript = "";
    let outputTranscript = "";
    let resolved = false;
    let collectTimer: NodeJS.Timeout | null = null;

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      if (verbose) console.log(`[gemini-stream] ⏰ 逾時 ${timeoutMs}ms`);
      resolve({
        firstPartialMs,
        finalTranscriptMs,
        translationMs,
        transcribedText: inputTranscript,
        translatedText: outputTranscript,
        success: inputTranscript.length > 0 || outputTranscript.length > 0,
        error: "Timeout",
      });
    }, timeoutMs);

    const wsUrl = `${GEMINI_WS_ENDPOINT}?key=${apiKey}`;
    const ws = new WebSocket(wsUrl);

    ws.on("open", () => {
      if (verbose) console.log(`[gemini-stream] 🔌 WebSocket 已連接 @${Date.now() - setupStartTime}ms`);

      // 送出 setup
      const setupMsg = {
        setup: {
          model: `models/${GEMINI_MODEL}`,
          generation_config: {
            response_modalities: ["AUDIO"],
            speech_config: {
              voice_config: {
                prebuilt_voice_config: { voice_name: "Aoede" },
              },
            },
          },
          output_audio_transcription: {},
          // 停用自動 VAD，改用手動 activityStart/activityEnd
          realtime_input_config: {
            automatic_activity_detection: {
              disabled: true,
            },
          },
          system_instruction: {
            parts: [{
              text: `Translate spoken ${sourceLangName} to ${targetLangName}. Medical context. Output translation only. No disclaimers, no explanations, no added text.${targetLang === 'zh' ? ' Use Traditional Chinese only.' : ''}`,
            }],
          },
        },
      };
      ws.send(JSON.stringify(setupMsg));
      if (verbose) console.log(`[gemini-stream] 📤 setup 已送出`);
    });

    ws.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch { return; }

      // setupComplete → 開始串流音訊
      if (msg.setupComplete !== undefined) {
        const setupMs = Date.now() - setupStartTime;
        if (verbose) console.log(`[gemini-stream] ✅ setupComplete @${setupMs}ms — 開始串流...`);

        // 記錄串流開始時間（這是我們的 t=0）
        streamStartTime = Date.now();

        // ============================================================
        // 串流傳送邏輯 + VAD 端點偵測
        // ============================================================
        let chunkIndex = 0;
        let silenceMs = 0;
        let speechFrames = 0;
        let activityStarted = false;
        let activityEnded = false;

        const sendNextChunk = () => {
          if (chunkIndex >= chunks.length) {
            // 所有塊都送完了，若還沒送 activityEnd，強制送出
            if (activityStarted && !activityEnded) {
              activityEnded = true;
              ws.send(JSON.stringify({ realtime_input: { activity_end: {} } }));
              if (verbose) console.log(`[gemini-stream] 📤 activityEnd（音訊結束）@${Date.now() - streamStartTime!}ms`);
            }
            return;
          }

          const chunk = chunks[chunkIndex++];
          const energy = computeRmsEnergy(chunk);
          const isSpeech = energy > VAD_CONFIG.energyThreshold;

          if (isSpeech) {
            speechFrames++;
            silenceMs = 0;

            // 連續 N 塊有聲才確認語音開始
            if (!activityStarted && speechFrames >= VAD_CONFIG.speechFrameCount) {
              activityStarted = true;
              ws.send(JSON.stringify({ realtime_input: { activity_start: {} } }));
              if (verbose) console.log(`[gemini-stream] 📤 activityStart @${Date.now() - streamStartTime!}ms (energy=${energy.toFixed(4)})`);
            }
          } else {
            speechFrames = 0;
            if (activityStarted && !activityEnded) {
              silenceMs += VAD_CONFIG.chunkMs;
              if (silenceMs >= VAD_CONFIG.silenceDurationMs) {
                // 靜音超過閾值，送出 activityEnd
                activityEnded = true;
                ws.send(JSON.stringify({ realtime_input: { activity_end: {} } }));
                if (verbose) console.log(`[gemini-stream] 📤 activityEnd（VAD 靜音 ${silenceMs}ms）@${Date.now() - streamStartTime!}ms`);
                // 不再送後續塊（句子已結束）
                return;
              }
            }
          }

          // 送出音訊塊（只在 activityStarted 後才送，避免靜音前綴浪費）
          if (activityStarted && !activityEnded) {
            ws.send(JSON.stringify({
              realtime_input: {
                audio: {
                  data: chunk.toString("base64"),
                  mime_type: "audio/pcm;rate=16000",
                },
              },
            }));
          } else if (!activityStarted) {
            // 還沒偵測到語音，但先送塊讓 Gemini 有資料可處理
            // （避免 activityStart 後立刻 activityEnd 造成空音訊）
            ws.send(JSON.stringify({
              realtime_input: {
                audio: {
                  data: chunk.toString("base64"),
                  mime_type: "audio/pcm;rate=16000",
                },
              },
            }));
          }

          // 模擬即時錄音：每 100ms 送一塊
          setTimeout(sendNextChunk, VAD_CONFIG.chunkMs);
        };

        // 立即送出 activityStart（因為我們知道音訊有語音）
        // 然後開始逐塊串流
        ws.send(JSON.stringify({ realtime_input: { activity_start: {} } }));
        activityStarted = true;
        if (verbose) console.log(`[gemini-stream] 📤 activityStart（預先）@${Date.now() - streamStartTime!}ms`);

        // 開始逐塊傳送
        setTimeout(sendNextChunk, 0);
        return;
      }

      // 處理 serverContent
      const sc = msg.serverContent as Record<string, unknown> | undefined;
      if (sc && streamStartTime !== null) {
        const elapsed = Date.now() - streamStartTime;

        // outputTranscription：翻譯結果
        const ot = sc.outputTranscription as Record<string, unknown> | undefined;
        if (ot?.text) {
          const text = ot.text as string;
          if (firstPartialMs === null) {
            firstPartialMs = elapsed;
            translationMs = elapsed;
            if (verbose) console.log(`[gemini-stream] ⚡ 首字 @${elapsed}ms: "${text}"`);
          }
          outputTranscript += text;
          if (verbose) console.log(`[gemini-stream] 📝 output @${elapsed}ms: "${text}"`);

          // 收到第一個 outputTranscription 就視為完成，等 800ms 收集完整翻譯
          if (finalTranscriptMs === null) {
            finalTranscriptMs = elapsed;
            if (verbose) console.log(`[gemini-stream] ✅ 首個轉錄完成 @${finalTranscriptMs}ms（串流模式）`);
            collectTimer = setTimeout(() => {
              if (resolved) return;
              resolved = true;
              clearTimeout(timer);
              ws.close();
              resolve({
                firstPartialMs,
                finalTranscriptMs,
                translationMs,
                transcribedText: inputTranscript,
                translatedText: outputTranscript,
                success: outputTranscript.length > 0,
              });
            }, 800);
          }
        }

        // inputTranscription：原文轉錄
        const it = sc.inputTranscription as Record<string, unknown> | undefined;
        if (it?.text) {
          inputTranscript += it.text as string;
          if (verbose) console.log(`[gemini-stream] 📝 input @${elapsed}ms: "${it.text}"`);
        }

        // turnComplete（備用：若 outputTranscription 沒觸發）
        if (sc.turnComplete === true) {
          if (verbose) console.log(`[gemini-stream] ✅ turnComplete @${elapsed}ms`);
          if (!resolved) {
            resolved = true;
            if (collectTimer) clearTimeout(collectTimer);
            clearTimeout(timer);
            ws.close();
            resolve({
              firstPartialMs,
              finalTranscriptMs: finalTranscriptMs ?? elapsed,
              translationMs,
              transcribedText: inputTranscript,
              translatedText: outputTranscript,
              success: outputTranscript.length > 0,
            });
          }
        }
      }

      // 錯誤處理
      if (msg.error) {
        const errObj = msg.error as Record<string, unknown>;
        if (!resolved) {
          resolved = true;
          if (collectTimer) clearTimeout(collectTimer);
          clearTimeout(timer);
          ws.close();
          resolve({
            firstPartialMs,
            finalTranscriptMs,
            translationMs,
            transcribedText: inputTranscript,
            translatedText: outputTranscript,
            success: false,
            error: `API 錯誤: ${errObj.message || JSON.stringify(errObj)}`,
          });
        }
      }
    });

    ws.on("error", (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        if (collectTimer) clearTimeout(collectTimer);
        resolve({
          firstPartialMs,
          finalTranscriptMs,
          translationMs,
          transcribedText: inputTranscript,
          translatedText: outputTranscript,
          success: false,
          error: `WebSocket 錯誤: ${err.message}`,
        });
      }
    });

    ws.on("close", () => {
      if (verbose) console.log(`[gemini-stream] 🔌 WebSocket 已關閉 @${streamStartTime ? Date.now() - streamStartTime : '?'}ms`);
    });
  });
}
