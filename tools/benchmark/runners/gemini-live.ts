/**
 * Gemini 3.1 Flash Live Runner
 * 使用 Google Gemini Live API 進行即時語音轉錄與翻譯
 *
 * API 文件：https://ai.google.dev/gemini-api/docs/live-api
 * 端點：wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
 * 模型：gemini-3.1-flash-live-001（Preview）
 *
 * 計費：音訊輸入 $0.00 / 1K tokens（Free tier）
 *       或 $0.35 / 1M tokens（Pay-as-you-go）
 *       ≈ 25 tokens/秒 → ~$0.0005/分鐘
 */

import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";
import type { TestSentence, SingleRunResult } from "../types.js";

const GEMINI_MODEL = "gemini-3.1-flash-live-001";
const GEMINI_WS_ENDPOINT = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`;

/**
 * 讀取音訊檔案並轉為 base64 PCM16 格式
 * Gemini Live API 接受 audio/pcm;rate=16000 或 audio/mp3
 */
async function loadAudioAsBase64(audioPath: string): Promise<{ data: string; mimeType: string }> {
  const ext = path.extname(audioPath).toLowerCase();
  const buffer = fs.readFileSync(audioPath);
  const data = buffer.toString("base64");

  // Gemini Live 支援 audio/mp3 直接傳入
  const mimeType = ext === ".mp3" ? "audio/mp3" : "audio/wav";
  return { data, mimeType };
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
  let transcribedText = "";
  let translatedText = "";

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (verbose) console.log(`[gemini-live] ⏰ 逾時 ${timeoutMs}ms`);
      resolve({
        firstPartialMs,
        finalTranscriptMs,
        translationMs,
        transcribedText,
        translatedText,
        success: transcribedText.length > 0,
        error: transcribedText.length === 0 ? "Timeout" : undefined,
      });
    }, timeoutMs);

    const wsUrl = `${GEMINI_WS_ENDPOINT}?key=${apiKey}`;
    const ws = new WebSocket(wsUrl);

    ws.on("open", async () => {
      if (verbose) console.log(`[gemini-live] 🔌 WebSocket 已連接`);

      // Step 1: 發送 setup 訊息
      const langNames: Record<string, string> = {
        zh: "Traditional Chinese (繁體中文)",
        en: "English",
        vi: "Vietnamese",
        id: "Indonesian",
        th: "Thai",
        ja: "Japanese",
      };
      const targetLangName = langNames[targetLang] || targetLang;

      const setupMsg = {
        setup: {
          model: `models/${GEMINI_MODEL}`,
          generation_config: {
            response_modalities: ["TEXT"],
            speech_config: {
              voice_config: {
                prebuilt_voice_config: { voice_name: "Aoede" },
              },
            },
          },
          system_instruction: {
            parts: [
              {
                text: [
                  `You are a real-time transcription and translation assistant for a nursing/medical environment.`,
                  `Task:`,
                  `1. Transcribe the audio input accurately.`,
                  `2. Translate the transcription into ${targetLangName}.`,
                  `CRITICAL: When translating to Chinese, you MUST use Traditional Chinese (繁體中文) characters only. NEVER use Simplified Chinese (簡體中文).`,
                  `Output format (JSON only, no markdown):`,
                  `{"transcript": "<original text>", "translation": "<translated text>"}`,
                ].join("\n"),
              },
            ],
          },
        },
      };

      ws.send(JSON.stringify(setupMsg));

      // Step 2: 等待 setup 完成後送入音訊
      // Gemini Live 會回傳 setupComplete 事件
    });

    ws.on("message", async (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (verbose) console.log(`[gemini-live] 📨 收到:`, JSON.stringify(msg).slice(0, 200));

      // 收到 setupComplete → 送入音訊
      if (msg.setupComplete !== undefined) {
        if (verbose) console.log(`[gemini-live] ✅ Setup 完成，送入音訊...`);

        try {
          const { data, mimeType } = await loadAudioAsBase64(audioPath);

          const audioMsg = {
            realtime_input: {
              media_chunks: [
                {
                  data,
                  mime_type: mimeType,
                },
              ],
            },
          };
          ws.send(JSON.stringify(audioMsg));

          // 送完音訊後發送 end-of-turn 信號
          setTimeout(() => {
            const eotMsg = {
              client_content: {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: "" }],
                  },
                ],
                turn_complete: true,
              },
            };
            ws.send(JSON.stringify(eotMsg));
            if (verbose) console.log(`[gemini-live] 📤 已送入音訊並發送 end-of-turn`);
          }, 100);
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
            error: `音訊載入失敗: ${err}`,
          });
        }
        return;
      }

      // 處理 serverContent（串流文字輸出）
      const serverContent = msg.serverContent as Record<string, unknown> | undefined;
      if (serverContent) {
        const modelTurn = serverContent.modelTurn as Record<string, unknown> | undefined;
        if (modelTurn) {
          const parts = modelTurn.parts as Array<Record<string, unknown>> | undefined;
          if (parts) {
            for (const part of parts) {
              const text = part.text as string | undefined;
              if (text) {
                const elapsed = Date.now() - startTime;

                // 首個 partial
                if (firstPartialMs === null) {
                  firstPartialMs = elapsed;
                  if (verbose) console.log(`[gemini-live] ⚡ 首字 @${elapsed}ms: ${text.slice(0, 50)}`);
                }

                // 嘗試解析 JSON 輸出
                const fullText = text.trim();
                try {
                  // 嘗試提取 JSON（可能夾在其他文字中）
                  const jsonMatch = fullText.match(/\{[^}]+\}/s);
                  if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.transcript) transcribedText = parsed.transcript;
                    if (parsed.translation) {
                      translatedText = parsed.translation;
                      translationMs = elapsed;
                    }
                  }
                } catch {
                  // 非 JSON，當作純文字轉錄
                  transcribedText += text;
                }
              }
            }
          }
        }

        // turnComplete = true 表示這輪回應結束
        if (serverContent.turnComplete === true) {
          finalTranscriptMs = Date.now() - startTime;
          if (verbose) {
            console.log(`[gemini-live] ✅ 轉錄完成 @${finalTranscriptMs}ms`);
            console.log(`[gemini-live]   轉錄: ${transcribedText.slice(0, 80)}`);
            console.log(`[gemini-live]   翻譯: ${translatedText.slice(0, 80)}`);
          }

          clearTimeout(timer);
          ws.close();
          resolve({
            firstPartialMs,
            finalTranscriptMs,
            translationMs,
            transcribedText,
            translatedText,
            success: transcribedText.length > 0,
          });
        }
      }

      // 處理錯誤
      if (msg.error) {
        const errObj = msg.error as Record<string, unknown>;
        clearTimeout(timer);
        ws.close();
        resolve({
          firstPartialMs,
          finalTranscriptMs,
          translationMs,
          transcribedText,
          translatedText,
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
        transcribedText,
        translatedText,
        success: false,
        error: `WebSocket 錯誤: ${err.message}`,
      });
    });

    ws.on("close", () => {
      if (verbose) console.log(`[gemini-live] 🔌 WebSocket 已關閉`);
    });
  });
}
