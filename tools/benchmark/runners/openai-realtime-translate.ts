/**
 * Runner: openai-realtime-translate
 * 使用 gpt-realtime-translate 一體化即時翻譯（GA API）
 * 端點: wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate
 * 
 * GA API 格式（2026-05）：
 * - session.update: audio.output.language
 * - 音訊傳送: session.input_audio_buffer.append
 * - 輸出事件: session.output_transcript.delta, session.input_transcript.delta
 */
import * as fs from "fs";
import WebSocket from "ws";
import { TestSentence, SingleRunResult } from "../types";

// GA API 支援的輸出語言（ISO 639-1 格式）
const SUPPORTED_TARGET_LANGS: Record<string, string> = {
  en: "en",
  zh: "zh",
  "zh-TW": "zh",
  ja: "ja",
  ko: "ko",
  fr: "fr",
  de: "de",
  es: "es",
  pt: "pt",
  it: "it",
  ru: "ru",
  ar: "ar",
  hi: "hi",
};

async function mp3ToPcm16(audioPath: string, sampleRate = 24000): Promise<Buffer> {
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

export async function runOpenAIRealtimeTranslate(
  sentence: TestSentence,
  audioPath: string,
  apiKey: string,
  targetLang: string,
  timeoutMs = 40000
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

  const targetLangCode =
    SUPPORTED_TARGET_LANGS[targetLang] ||
    SUPPORTED_TARGET_LANGS[targetLang.split("-")[0]];
  if (!targetLangCode) {
    return {
      firstPartialMs: null,
      finalTranscriptMs: null,
      translationMs: null,
      transcribedText: "",
      translatedText: "",
      success: false,
      error: `gpt-realtime-translate 不支援目標語言: ${targetLang}`,
    };
  }

  return new Promise((resolve) => {
    // GA API：URL 中指定 model
    const ws = new WebSocket(
      "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate",
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "OpenAI-Safety-Identifier": "benchmark-test",
        },
      }
    );

    let firstPartialMs: number | null = null;
    let finalTranscriptMs: number | null = null;
    let translationMs: number | null = null;
    let transcribedText = "";
    let translatedText = "";
    let resolved = false;
    let audioSentTime: number | null = null;
    let sessionConfigured = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // GA API：送 session.close 再關閉
        try { ws.send(JSON.stringify({ type: "session.close" })); } catch {}
        setTimeout(() => ws.close(), 500);
        resolve({
          firstPartialMs,
          finalTranscriptMs,
          translationMs,
          transcribedText,
          translatedText,
          success: translatedText.length > 0,
          error: translatedText.length === 0 ? `Timeout after ${timeoutMs}ms` : undefined,
        });
      }
    }, timeoutMs);

    ws.on("open", () => {
      // GA API：session.update 設定目標語言
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          audio: {
            output: {
              language: targetLangCode,
            },
          },
        },
      }));
    });

    ws.on("message", async (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString());
        const now = Date.now();
        const elapsed = audioSentTime ? now - audioSentTime : now - startTime;

        switch (event.type) {
          case "session.created":
          case "session.updated":
            // session 準備好後送音訊
            if (!sessionConfigured) {
              sessionConfigured = true;
              try {
                const pcmBuffer = await mp3ToPcm16(audioPath, 24000);
                audioSentTime = Date.now();

                // GA API：使用 session.input_audio_buffer.append
                const chunkSize = 4800; // 100ms @ 24kHz
                for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
                  const chunk = pcmBuffer.slice(i, i + chunkSize);
                  ws.send(JSON.stringify({
                    type: "session.input_audio_buffer.append",
                    audio: chunk.toString("base64"),
                  }));
                  await new Promise((r) => setTimeout(r, 10));
                }

                // 送完後關閉 session（flush 剩餘音訊）
                ws.send(JSON.stringify({ type: "session.close" }));
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
            }
            break;

          // GA API 輸出事件
          case "session.input_transcript.delta":
            // 原始語言轉錄 delta
            if (firstPartialMs === null) firstPartialMs = elapsed;
            transcribedText += event.delta || "";
            break;

          case "session.input_transcript.done":
            finalTranscriptMs = elapsed;
            transcribedText = event.transcript || transcribedText;
            break;

          case "session.output_transcript.delta":
            // 翻譯後文字 delta
            if (firstPartialMs === null) firstPartialMs = elapsed;
            translatedText += event.delta || "";
            break;

          case "session.output_transcript.done":
            translationMs = elapsed;
            translatedText = event.transcript || translatedText;
            break;

          case "session.closed":
            // 翻譯完成，session 正常關閉
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
                success: translatedText.length > 0,
                error: translatedText.length === 0 ? "No translation output" : undefined,
              });
            }
            break;

          case "error":
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
                error: event.error?.message || JSON.stringify(event.error) || "WebSocket error event",
              });
            }
            break;
        }
      } catch {
        // 忽略解析錯誤
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
          success: translatedText.length > 0,
          error: translatedText.length === 0 ? "Connection closed without output" : undefined,
        });
      }
    });
  });
}
