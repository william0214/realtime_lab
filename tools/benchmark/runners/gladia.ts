/**
 * Runner: gladia
 * 使用 Gladia Solaria-1 即時 ASR + 翻譯
 * API: https://api.gladia.io/v2/live
 */
import * as fs from "fs";
import WebSocket from "ws";
import axios from "axios";
import { TestSentence, SingleRunResult } from "../types";

const GLADIA_API_URL = "https://api.gladia.io";

async function mp3ToPcm16(audioPath: string, sampleRate = 16000): Promise<Buffer> {
  const { spawn } = await import("child_process");
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", audioPath,
      "-ar", String(sampleRate),
      "-ac", "1",
      "-f", "s16le",
      "-",
    ]);
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

export async function runGladia(
  sentence: TestSentence,
  audioPath: string,
  apiKey: string,
  targetLang: string,
  timeoutMs = 30000
): Promise<SingleRunResult> {
  const startTime = Date.now();

  if (!fs.existsSync(audioPath)) {
    return {
      firstPartialMs: null,
      finalTranscriptMs: null,
      translationMs: null,
      transcribedText: "",
      translatedText: "",
      success: false,
      error: `音訊檔案不存在: ${audioPath}`,
    };
  }

  try {
    // Step 1: 建立 live session
    const sessionResp = await axios.post(
      `${GLADIA_API_URL}/v2/live`,
      {
        encoding: "wav/pcm",
        sample_rate: 16000,
        bit_depth: 16,
        channels: 1,
        language_config: {
          languages: [sentence.lang === "zh" ? "zh" : sentence.lang],
          code_switching: false,
        },
        translation_config: {
          target_languages: [
            targetLang === "zh" || targetLang === "zh-TW" ? "zh" : targetLang,
          ],
        },
        realtime_processing: {
          words_accurate_timestamps: false,
          custom_vocabulary: sentence.lang === "zh"
            ? ["護士", "醫生", "病患", "藥物", "過敏", "手術"]
            : [],
        },
      },
      {
        headers: {
          "X-Gladia-Key": apiKey,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const { id: sessionId, url: wsUrl } = sessionResp.data;

    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);

      let firstPartialMs: number | null = null;
      let finalTranscriptMs: number | null = null;
      let translationMs: number | null = null;
      let transcribedText = "";
      let translatedText = "";
      let resolved = false;
      let audioSentTime: number | null = null;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ws.close();
          resolve({
            firstPartialMs,
            finalTranscriptMs,
            translationMs,
            transcribedText,
            translatedText,
            success: transcribedText.length > 0,
            error: transcribedText.length === 0 ? "Timeout" : undefined,
          });
        }
      }, timeoutMs);

      ws.on("open", async () => {
        try {
          const pcmBuffer = await mp3ToPcm16(audioPath, 16000);
          audioSentTime = Date.now();

          // Gladia 接受原始 PCM binary
          const chunkSize = 3200; // 100ms @ 16kHz
          for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
            const chunk = pcmBuffer.slice(i, i + chunkSize);
            ws.send(chunk);
            await new Promise((r) => setTimeout(r, 10));
          }

          // 傳送結束訊號
          ws.send(JSON.stringify({ type: "stop_recording" }));
        } catch (err) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            ws.close();
            resolve({
              firstPartialMs: null,
              finalTranscriptMs: null,
              translationMs: null,
              transcribedText: "",
              translatedText: "",
              success: false,
              error: `音訊處理失敗: ${err}`,
            });
          }
        }
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString());
          const now = Date.now();
          const elapsed = audioSentTime ? now - audioSentTime : now - startTime;

          if (event.type === "transcript") {
            const utterance = event.data?.utterance;
            if (!utterance) return;

            if (event.data.is_final === false) {
              // Partial transcript
              if (firstPartialMs === null) firstPartialMs = elapsed;
            } else {
              // Final transcript
              finalTranscriptMs = elapsed;
              transcribedText = utterance.text || transcribedText;

              // 翻譯結果
              const translations = utterance.translations || [];
              if (translations.length > 0) {
                translatedText = translations[0].text || "";
                translationMs = elapsed;
              }
            }
          } else if (event.type === "post_final_transcript") {
            // 所有句子處理完畢
            if (!resolved) {
              resolved = true;
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
          } else if (event.type === "error") {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              ws.close();
              resolve({
                firstPartialMs,
                finalTranscriptMs,
                translationMs,
                transcribedText,
                translatedText,
                success: false,
                error: event.message || "Gladia error",
              });
            }
          }
        } catch {
          // 忽略
        }
      });

      ws.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({
            firstPartialMs,
            finalTranscriptMs,
            translationMs,
            transcribedText,
            translatedText,
            success: false,
            error: `WebSocket error: ${err.message}`,
          });
        }
      });

      ws.on("close", () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({
            firstPartialMs,
            finalTranscriptMs,
            translationMs,
            transcribedText,
            translatedText,
            success: transcribedText.length > 0,
            error: transcribedText.length === 0 ? "Connection closed" : undefined,
          });
        }
      });
    });
  } catch (err: unknown) {
    return {
      firstPartialMs: null,
      finalTranscriptMs: null,
      translationMs: null,
      transcribedText: "",
      translatedText: "",
      success: false,
      error: `Gladia session 建立失敗: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
