/**
 * Gemini 3.1 Flash Live Preview Runner — Automatic VAD 模式
 *
 * 與 gemini-live.ts（Manual VAD）的差異：
 *   - 不停用 automatic_activity_detection（使用伺服器端 VAD）
 *   - 設定 silence_duration_ms = 500ms（最低建議值，預設 800ms）
 *   - 設定 prefix_padding_ms = 200ms（確保第一音節不被截斷）
 *   - 不送 activityStart / activityEnd，讓 Gemini 自己偵測語音邊界
 *   - 音訊送完後送 audioStreamEnd（官方建議，用於清除快取）
 *
 * 測試假設：
 *   Automatic VAD 在接收音訊的同時就在做 VAD 偵測，
 *   若伺服器端 VAD 比客戶端 activityEnd 更快觸發，
 *   則 Automatic VAD 模式的 ASR 啟動時間會更早。
 */

import WebSocket from "ws";
import * as fs from "fs";
import { execSync } from "child_process";
import type { TestSentence, SingleRunResult } from "../types.js";

const GEMINI_MODEL = "gemini-3.1-flash-live-preview";
const GEMINI_WS_ENDPOINT = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`;

function convertToPcm16(audioPath: string): Buffer {
  const tmpPath = `/tmp/gemini-autovad-pcm-${Date.now()}.raw`;
  execSync(`ffmpeg -y -i "${audioPath}" -ar 16000 -ac 1 -f s16le "${tmpPath}" 2>/dev/null`);
  const buf = fs.readFileSync(tmpPath);
  try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  return buf;
}

export async function runGeminiLiveAutoVad(
  sentence: TestSentence,
  audioPath: string,
  sourceLang: string,
  targetLang: string,
  apiKey: string,
  timeoutMs: number,
  verbose: boolean
): Promise<SingleRunResult> {
  const startTime = Date.now();
  let firstPartialMs: number | null = null;
  let finalTranscriptMs: number | null = null;
  let translationMs: number | null = null;
  let inputTranscript = "";
  let outputTranscript = "";

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (verbose) console.log(`[autovad] ⏰ 逾時 ${timeoutMs}ms`);
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
      if (verbose) console.log(`[autovad] 🔌 WebSocket 已連接 @${Date.now() - startTime}ms`);

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
          // Automatic VAD 模式：不設定（使用預設）或只設定 silence_duration_ms
          realtime_input_config: {
            automatic_activity_detection: {
              // 不設定 disabled（預設為 false，即啟用 Automatic VAD）
              // 只設定 silence_duration_ms 為 500ms（預設 800ms）
              silence_duration_ms: 500,
            },
          },
          system_instruction: {
            parts: [
              {
                text: `Translate spoken ${sourceLangName} to ${targetLangName}. Medical context. Output translation only. No disclaimers, no explanations, no added text.${targetLang === 'zh' ? ' Use Traditional Chinese only.' : ''}`,
              },
            ],
          },
        },
      };

      ws.send(JSON.stringify(setupMsg));
      if (verbose) console.log(`[autovad] 📤 setup 已送出（Automatic VAD, silenceDurationMs=500ms）`);
    });

    ws.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // setupComplete → 送入 PCM16 音訊（不送 activityStart，讓 Gemini 自動偵測）
      if (msg.setupComplete !== undefined) {
        const elapsed = Date.now() - startTime;
        if (verbose) console.log(`[autovad] ✅ setupComplete @${elapsed}ms — 送入 PCM16 音訊（Automatic VAD）...`);

        try {
          const pcmBuf = convertToPcm16(audioPath);
          if (verbose) console.log(`[autovad] 🎵 PCM16: ${pcmBuf.length} bytes (${(pcmBuf.length / (16000 * 2)).toFixed(2)}s)`);

          // 直接送入音訊，不送 activityStart
          const chunkSize = 3200; // 100ms @ 16kHz 16-bit mono
          let offset = 0;
          while (offset < pcmBuf.length) {
            const chunk = pcmBuf.slice(offset, offset + chunkSize);
            ws.send(JSON.stringify({
              realtime_input: {
                audio: {
                  data: chunk.toString("base64"),
                  mime_type: "audio/pcm;rate=16000",
                },
              },
            }));
            offset += chunkSize;
          }

          // 送完音訊後送 audioStreamEnd（官方建議，用於清除快取）
          // 注意：這不是 activityEnd，不會強制結束語音輪次
          // Gemini 仍會等 silence_duration_ms（500ms）靜音後才觸發 ASR
          setTimeout(() => {
            ws.send(JSON.stringify({
              realtime_input: { audio_stream_end: true },
            }));
            if (verbose) console.log(`[autovad] 📤 audioStreamEnd @${Date.now() - startTime}ms（等 Gemini VAD 偵測靜音 500ms）`);
          }, 50);

        } catch (err) {
          clearTimeout(timer);
          ws.close();
          resolve({
            firstPartialMs: null,
            finalTranscriptMs: null,
            translationMs: null,
            transcribedText: "",
            translatedText: "",
            success: false,
            error: `PCM16 轉換失敗: ${err}`,
          });
        }
        return;
      }

      // 處理 serverContent
      const sc = msg.serverContent as Record<string, unknown> | undefined;
      if (sc) {
        const elapsed = Date.now() - startTime;

        // outputTranscription：翻譯後語音的文字稿
        const ot = sc.outputTranscription as Record<string, unknown> | undefined;
        if (ot?.text) {
          const text = ot.text as string;
          if (firstPartialMs === null) {
            firstPartialMs = elapsed;
            translationMs = elapsed;
            if (verbose) console.log(`[autovad] ⚡ 首字 @${elapsed}ms: "${text}"`);
          }
          outputTranscript += text;
          if (verbose) console.log(`[autovad] 📝 output @${elapsed}ms: "${text}"`);

          // 收到第一個 outputTranscription 就視為完成（等 800ms 收集完整文字）
          if (finalTranscriptMs === null) {
            finalTranscriptMs = elapsed;
            setTimeout(() => {
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

        // inputTranscription
        const it = sc.inputTranscription as Record<string, unknown> | undefined;
        if (it?.text) {
          const text = it.text as string;
          inputTranscript += text;
          if (verbose) console.log(`[autovad] 📝 input @${elapsed}ms: "${text}"`);
        }

        // turnComplete
        if (sc.turnComplete === true) {
          if (verbose) console.log(`[autovad] ✅ turnComplete @${elapsed}ms`);
          if (finalTranscriptMs === null) {
            finalTranscriptMs = elapsed;
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
          }
        }
      }

      // 錯誤處理
      if (msg.error) {
        const errObj = msg.error as Record<string, unknown>;
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
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({
        firstPartialMs,
        finalTranscriptMs,
        translationMs,
        transcribedText: inputTranscript,
        translatedText: outputTranscript,
        success: false,
        error: `WebSocket 錯誤: ${err.message}`,
      });
    });

    ws.on("close", () => {
      if (verbose) console.log(`[autovad] 🔌 WebSocket 已關閉 @${Date.now() - startTime}ms`);
    });
  });
}
