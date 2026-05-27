/**
 * Gemini 3.1 Flash Live Preview Runner
 * 使用 Google Gemini Live API 進行即時語音翻譯
 *
 * API 文件：https://ai.google.dev/gemini-api/docs/live-api
 * 端點：wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
 * 模型：gemini-3.1-flash-live-preview
 *
 * 關鍵 API 格式（實測確認）：
 *   - response_modalities: ['AUDIO']（不支援 TEXT-only）
 *   - 音訊格式：realtime_input.audio.{data, mime_type}（media_chunks 已棄用）
 *   - 輸入音訊：PCM16 16kHz（ffmpeg 轉換）
 *   - 轉錄欄位：serverContent.outputTranscription.text（輸出語音的轉錄）
 *              serverContent.inputTranscription.text（輸入語音的轉錄，需在 generation_config 啟用）
 *   - 翻譯結果：從 outputTranscription 取得（即翻譯後的語音文字稿）
 *
 * 計費：音訊輸入 $0.35 / 1M tokens（Pay-as-you-go）
 *       ≈ 25 tokens/秒 → ~$0.0005/分鐘
 *
 * 更新紀錄：
 *   2026-05-27 v1 — 從 gemini-3.1-flash-live-001（不存在）修正為 gemini-2.5-flash-native-audio-latest
 *   2026-05-27 v2 — 修正 API 格式：AUDIO 模式、PCM16 轉換、正確欄位名稱
 */

import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import type { TestSentence, SingleRunResult } from "../types.js";

const GEMINI_MODEL = "gemini-3.1-flash-live-preview";
const GEMINI_WS_ENDPOINT = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`;

/**
 * 將音訊檔案轉換為 PCM16 16kHz（Gemini Live 要求格式）
 */
function convertToPcm16(audioPath: string): Buffer {
  const tmpPath = `/tmp/gemini-pcm-${Date.now()}.raw`;
  execSync(`ffmpeg -y -i "${audioPath}" -ar 16000 -ac 1 -f s16le "${tmpPath}" 2>/dev/null`);
  const buf = fs.readFileSync(tmpPath);
  try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  return buf;
}

/**
 * 執行單次 Gemini Live 測試
 */
export async function runGeminiLive(
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
      if (verbose) console.log(`[gemini-live] ⏰ 逾時 ${timeoutMs}ms`);
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
      if (verbose) console.log(`[gemini-live] 🔌 WebSocket 已連接 @${Date.now() - startTime}ms`);

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
            // gemini-3.1-flash-live-preview 只支援 AUDIO 輸出
            response_modalities: ["AUDIO"],
            speech_config: {
              voice_config: {
                prebuilt_voice_config: { voice_name: "Aoede" },
              },
            },
          },
          // 啟用輸入和輸出音訊轉錄（官方文件確認格式）
          output_audio_transcription: {},
          input_audio_transcription: {},
          // 啟用 custom VAD 模式，手動控制 activityStart/activityEnd
          // 這樣我們可以在送完音訊後明確發送 activityEnd
          realtime_input_config: {
            automatic_activity_detection: {
              disabled: true,
            },
          },
          system_instruction: {
            parts: [
              {
                text: [
                  `You are a professional real-time simultaneous interpreter for a nursing/medical environment.`,
                  `The user will speak in ${sourceLangName}.`,
                  `Your task: Translate what you hear into ${targetLangName} and speak it clearly.`,
                  `CRITICAL: When translating to Chinese, ALWAYS use Traditional Chinese (繁體中文). NEVER use Simplified Chinese (簡體中文).`,
                  `Keep the translation accurate, concise, and at a natural speaking pace.`,
                  `Do not add any explanations, greetings, or filler words.`,
                ].join(" "),
              },
            ],
          },
        },
      };

      ws.send(JSON.stringify(setupMsg));
      if (verbose) console.log(`[gemini-live] 📤 setup 已送出`);
    });

    ws.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // setupComplete → 轉換並送入 PCM16 音訊
      if (msg.setupComplete !== undefined) {
        const elapsed = Date.now() - startTime;
        if (verbose) console.log(`[gemini-live] ✅ setupComplete @${elapsed}ms — 送入 PCM16 音訊...`);

        try {
          const pcmBuf = convertToPcm16(audioPath);
          if (verbose) console.log(`[gemini-live] 🎵 PCM16: ${pcmBuf.length} bytes (${(pcmBuf.length / (16000 * 2)).toFixed(2)}s)`);

          // 使用 custom VAD 模式：先發送 activityStart，送完音訊後發送 activityEnd
          // 這是 gemini-3.1-flash-live-preview 的正確做法
          ws.send(JSON.stringify({ realtime_input: { activity_start: {} } }));
          if (verbose) console.log(`[gemini-live] 📤 activityStart @${Date.now() - startTime}ms`);

          // 分塊送入（每塊 3200 bytes = 100ms @ 16kHz 16-bit mono）
          const chunkSize = 3200;
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

          // 送入音訊後發送 activityEnd
          setTimeout(() => {
            ws.send(JSON.stringify({ realtime_input: { activity_end: {} } }));
            if (verbose) console.log(`[gemini-live] 📤 activityEnd @${Date.now() - startTime}ms`);
          }, 200);
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

        // outputTranscription：翻譯後語音的文字稿（即翻譯結果）
        const ot = sc.outputTranscription as Record<string, unknown> | undefined;
        if (ot?.text) {
          const text = ot.text as string;
          if (firstPartialMs === null) {
            firstPartialMs = elapsed;
            translationMs = elapsed;
            if (verbose) console.log(`[gemini-live] ⚡ 首字 @${elapsed}ms: "${text}"`);
          }
          outputTranscript += text;
          if (verbose) console.log(`[gemini-live] 📝 output @${elapsed}ms: "${text}"`);

          // 收到第一個 outputTranscription 就立即視為完成
          // 這樣延遲更接近實際使用體驗（使用者看到翻譯文字就夠，不需等 TTS 說完）
          if (finalTranscriptMs === null) {
            finalTranscriptMs = elapsed;
            if (verbose) {
              console.log(`[gemini-live] ✅ 首個轉錄完成 @${finalTranscriptMs}ms（不等 TTS）`);
            }
            // 繼續收集完整轉錄，但在 turnComplete 或 500ms 後結束
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
            }, 500);
          }
        }

        // inputTranscription：輸入語音的文字稿（即原文轉錄）
        const it = sc.inputTranscription as Record<string, unknown> | undefined;
        if (it?.text) {
          const text = it.text as string;
          inputTranscript += text;
          if (verbose) console.log(`[gemini-live] 📝 input @${elapsed}ms: "${text}"`);
        }

        // modelTurn：音訊塊（不處理，只計數）
        const mt = sc.modelTurn as Record<string, unknown> | undefined;
        if (mt) {
          const parts = mt.parts as Array<Record<string, unknown>> | undefined;
          if (parts) {
            for (const p of parts) {
              if (p.text) {
                // 若有文字輸出（不預期，但保留）
                if (firstPartialMs === null) firstPartialMs = elapsed;
                outputTranscript += p.text as string;
              }
            }
          }
        }

        // turnComplete
        if (sc.turnComplete === true) {
          finalTranscriptMs = elapsed;
          if (verbose) {
            console.log(`[gemini-live] ✅ turnComplete @${finalTranscriptMs}ms`);
            console.log(`[gemini-live]   輸入轉錄: ${inputTranscript.slice(0, 80)}`);
            console.log(`[gemini-live]   輸出翻譯: ${outputTranscript.slice(0, 80)}`);
          }
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
      if (verbose) console.log(`[gemini-live] 🔌 WebSocket 已關閉 @${Date.now() - startTime}ms`);
    });
  });
}
