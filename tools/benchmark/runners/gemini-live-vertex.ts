/**
 * Gemini Live API - Vertex AI Runner（HIPAA 合規版）
 * 
 * 使用 Google Cloud Vertex AI 端點，透過 OAuth Bearer Token 認證
 * 符合 HIPAA/GDPR 醫療合規要求
 *
 * 端點：wss://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent
 * 模型：projects/{project}/locations/{location}/publishers/google/models/gemini-live-2.5-flash-native-audio
 * 認證：OAuth 2.0 Bearer Token（google-auth-library）
 *
 * 更新紀錄：
 *   2026-05-28 v1 — 從 gemini-live.ts 複製並修改為 Vertex AI 版本
 */
import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { GoogleAuth } from "google-auth-library";
import type { TestSentence, SingleRunResult } from "../types.js";

const VERTEX_AI_PROJECT = process.env.VERTEX_AI_PROJECT || "gen-lang-client-0878023388";
const VERTEX_AI_LOCATION = process.env.VERTEX_AI_LOCATION || "us-central1";
const VERTEX_MODEL = `projects/${VERTEX_AI_PROJECT}/locations/${VERTEX_AI_LOCATION}/publishers/google/models/gemini-live-2.5-flash-native-audio`;
const VERTEX_WS_ENDPOINT = `wss://${VERTEX_AI_LOCATION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;

/**
 * 取得 Vertex AI OAuth Bearer Token
 */
async function getAccessToken(): Promise<string> {
  const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFilename) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS 環境變數未設定");
  }
  const auth = new GoogleAuth({
    keyFilename,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse.token;
  if (!token) throw new Error("無法取得 OAuth Bearer Token");
  return token;
}

/**
 * 將音訊檔案轉換為 PCM16 16kHz（Gemini Live 要求格式）
 */
function convertToPcm16(audioPath: string): Buffer {
  const tmpPath = `/tmp/gemini-vertex-pcm-${Date.now()}.raw`;
  execSync(`ffmpeg -y -i "${audioPath}" -ar 16000 -ac 1 -f s16le "${tmpPath}" 2>/dev/null`);
  const buf = fs.readFileSync(tmpPath);
  try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  return buf;
}

/**
 * 執行單次 Vertex AI Gemini Live 測試
 */
export async function runGeminiLiveVertex(
  sentence: TestSentence,
  audioPath: string,
  sourceLang: string,
  targetLang: string,
  _apiKey: string,  // Vertex AI 不使用 API Key，保留參數以維持介面一致
  timeoutMs: number,
  verbose: boolean
): Promise<SingleRunResult> {
  const startTime = Date.now();
  let firstPartialMs: number | null = null;
  let finalTranscriptMs: number | null = null;
  let translationMs: number | null = null;
  let inputTranscript = "";
  let outputTranscript = "";

  // 語言名稱對照
  const langNames: Record<string, string> = {
    zh: "Mandarin Chinese (Traditional)",
    en: "English",
    vi: "Vietnamese",
    id: "Indonesian",
    th: "Thai",
    ja: "Japanese",
    ko: "Korean",
    tl: "Tagalog",
    it: "Italian",
  };
  const sourceLangName = langNames[sourceLang] || sourceLang;
  const targetLangName = langNames[targetLang] || targetLang;

  // 先取得 OAuth Token（在 Promise 外）
  let accessToken: string;
  try {
    accessToken = await getAccessToken();
    if (verbose) console.log(`[gemini-vertex] 🔑 OAuth token 取得成功 @${Date.now() - startTime}ms`);
  } catch (authErr) {
    return {
      firstPartialMs: null,
      finalTranscriptMs: null,
      translationMs: null,
      transcribedText: "",
      translatedText: "",
      success: false,
      error: `OAuth 認證失敗: ${authErr}`,
    };
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (verbose) console.log(`[gemini-vertex] ⏰ 逾時 ${timeoutMs}ms`);
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

    // Vertex AI 使用 Bearer Token 認證（不是 URL query param）
    const ws = new WebSocket(VERTEX_WS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    ws.on("open", () => {
      const elapsed = Date.now() - startTime;
      if (verbose) console.log(`[gemini-vertex] 🔌 WebSocket 已連線 @${elapsed}ms`);

      const setupMsg = {
        setup: {
          model: VERTEX_MODEL,
          generation_config: {
            // gemini-live-2.5-flash-native-audio 支援 AUDIO 輸出
            response_modalities: ["AUDIO"],
            speech_config: {
              voice_config: {
                prebuilt_voice_config: { voice_name: "Aoede" },
              },
            },
          },
          // 啟用輸出音訊轉錄（取得翻譯文字）
          output_audio_transcription: {},
          // 啟用 custom VAD 模式，手動控制 activityStart/activityEnd
          realtime_input_config: {
            automatic_activity_detection: {
              disabled: true,
            },
          },
          // 精簡版 system prompt
          system_instruction: {
            parts: [
              {
                text: `Translate spoken ${sourceLangName} to ${targetLangName}. Medical context. Output translation only. No disclaimers, no explanations, no added text.${targetLang === "zh" ? " Use Traditional Chinese only." : ""}`,
              },
            ],
          },
        },
      };
      ws.send(JSON.stringify(setupMsg));
      if (verbose) console.log(`[gemini-vertex] 📤 setup 已送出 (model: ${VERTEX_MODEL})`);
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
        if (verbose) console.log(`[gemini-vertex] ✅ setupComplete @${elapsed}ms — 送入 PCM16 音訊...`);

        try {
          const pcmBuf = convertToPcm16(audioPath);
          if (verbose) console.log(`[gemini-vertex] 🎵 PCM16 轉換完成，大小: ${pcmBuf.length} bytes`);

          // 使用 custom VAD 模式：先發送 activityStart，送完音訊後發送 activityEnd
          ws.send(JSON.stringify({ realtime_input: { activity_start: {} } }));
          if (verbose) console.log(`[gemini-vertex] 📤 activityStart @${Date.now() - startTime}ms`);

          // 分塊送入音訊（每塊 4096 bytes）
          const chunkSize = 4096;
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
          // 送入音訊後發送 activityEnd（50ms 小緩衝）
          setTimeout(() => {
            ws.send(JSON.stringify({ realtime_input: { activity_end: {} } }));
            if (verbose) console.log(`[gemini-vertex] 📤 activityEnd @${Date.now() - startTime}ms`);
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

        // outputTranscription：翻譯後語音的文字稿（即翻譯結果）
        const ot = sc.outputTranscription as Record<string, unknown> | undefined;
        if (ot?.text) {
          const text = ot.text as string;
          if (firstPartialMs === null) {
            firstPartialMs = elapsed;
            translationMs = elapsed;
            if (verbose) console.log(`[gemini-vertex] ⚡ 首字 @${elapsed}ms: "${text}"`);
          }
          outputTranscript += text;
          if (verbose) console.log(`[gemini-vertex] 📝 output @${elapsed}ms: "${text}"`);

          // 收到第一個 outputTranscription 就立即視為完成
          if (finalTranscriptMs === null) {
            finalTranscriptMs = elapsed;
            if (verbose) {
              console.log(`[gemini-vertex] ✅ 首個轉錄完成 @${finalTranscriptMs}ms（不等 TTS）`);
            }
            // 繼續收集完整轉錄，800ms 後結束
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

        // inputTranscription：輸入語音的文字稿（即原文轉錄）
        const it = sc.inputTranscription as Record<string, unknown> | undefined;
        if (it?.text) {
          const text = it.text as string;
          inputTranscript += text;
          if (verbose) console.log(`[gemini-vertex] 📝 input @${elapsed}ms: "${text}"`);
        }

        // modelTurn：音訊塊
        const mt = sc.modelTurn as Record<string, unknown> | undefined;
        if (mt) {
          const parts = mt.parts as Array<Record<string, unknown>> | undefined;
          if (parts) {
            for (const p of parts) {
              if (p.text) {
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
            console.log(`[gemini-vertex] ✅ turnComplete @${finalTranscriptMs}ms`);
            console.log(`[gemini-vertex]   輸入轉錄: ${inputTranscript.slice(0, 80)}`);
            console.log(`[gemini-vertex]   輸出翻譯: ${outputTranscript.slice(0, 80)}`);
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
      if (verbose) console.log(`[gemini-vertex] 🔌 WebSocket 已關閉 @${Date.now() - startTime}ms`);
    });
  });
}
