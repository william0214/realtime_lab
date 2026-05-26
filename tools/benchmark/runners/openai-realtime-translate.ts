/**
 * Runner: openai-realtime-translate
 * 使用 gpt-realtime-translate 一體化即時翻譯
 * 端點: wss://api.openai.com/v1/realtime/translations
 */
import * as fs from "fs";
import WebSocket from "ws";
import OpenAI from "openai";
import { TestSentence, SingleRunResult } from "../types";

const SUPPORTED_TARGET_LANGS: Record<string, string> = {
  en: "english",
  zh: "chinese",
  "zh-TW": "chinese",
  ja: "japanese",
  ko: "korean",
  fr: "french",
  de: "german",
  es: "spanish",
  pt: "portuguese",
  it: "italian",
  ru: "russian",
  ar: "arabic",
  hi: "hindi",
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

  const targetLangName =
    SUPPORTED_TARGET_LANGS[targetLang] ||
    SUPPORTED_TARGET_LANGS[targetLang.split("-")[0]];
  if (!targetLangName) {
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
    const ws = new WebSocket(
      "wss://api.openai.com/v1/realtime/translations",
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "OpenAI-Beta": "realtime=v1",
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
          success: translatedText.length > 0,
          error: translatedText.length === 0 ? "Timeout" : undefined,
        });
      }
    }, timeoutMs);

    ws.on("open", async () => {
      // 設定 session
      ws.send(
        JSON.stringify({
          type: "translation_session.update",
          session: {
            input_audio_format: "pcm16",
            modalities: ["text"],
            translation: {
              model: "gpt-realtime-translate",
              target_language: targetLangName,
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              silence_duration_ms: 800,
            },
          },
        })
      );

      try {
        const pcmBuffer = await mp3ToPcm16(audioPath, 24000);
        audioSentTime = Date.now();

        const chunkSize = 4800; // 100ms @ 24kHz
        for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
          const chunk = pcmBuffer.slice(i, i + chunkSize);
          ws.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: chunk.toString("base64"),
            })
          );
          await new Promise((r) => setTimeout(r, 10));
        }
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
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

        switch (event.type) {
          // 轉錄 delta（原始語言）
          case "conversation.item.input_audio_transcription.delta":
            if (firstPartialMs === null) firstPartialMs = elapsed;
            transcribedText += event.delta || "";
            break;

          case "conversation.item.input_audio_transcription.completed":
            finalTranscriptMs = elapsed;
            transcribedText = event.transcript || transcribedText;
            break;

          // 翻譯 delta
          case "translation.text.delta":
            if (firstPartialMs === null) firstPartialMs = elapsed;
            translatedText += event.delta || "";
            break;

          // 翻譯完成
          case "translation.text.done":
            translationMs = elapsed;
            translatedText = event.text || translatedText;
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
                success: true,
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
                error: event.error?.message || "WebSocket error",
              });
            }
            break;
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
          success: translatedText.length > 0,
          error: translatedText.length === 0 ? "Connection closed" : undefined,
        });
      }
    });
  });
}
