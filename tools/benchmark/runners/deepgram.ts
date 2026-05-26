/**
 * Runner: deepgram
 * 使用 Deepgram Nova-3 串流 ASR
 * WebSocket: wss://api.deepgram.com/v1/listen
 */
import * as fs from "fs";
import WebSocket from "ws";
import OpenAI from "openai";
import { TestSentence, SingleRunResult } from "../types";

const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";

// Deepgram 支援的語言代碼對應
const LANG_MAP: Record<string, string> = {
  zh: "zh-TW",
  "zh-TW": "zh-TW",
  en: "en",
  ja: "ja",
  ko: "ko",
  vi: "vi",
  id: "id",
  th: "th",
  fr: "fr",
  de: "de",
  es: "es",
};

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

export async function runDeeepgram(
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

  const deepgramLang = LANG_MAP[sentence.lang] || sentence.lang;

  // 建立 WebSocket URL（含查詢參數）
  const params = new URLSearchParams({
    model: "nova-3",
    language: deepgramLang,
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    punctuate: "true",
    interim_results: "true",
    endpointing: "800",
    smart_format: "true",
  });

  const wsUrl = `${DEEPGRAM_WS_URL}?${params.toString()}`;

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    });

    let firstPartialMs: number | null = null;
    let finalTranscriptMs: number | null = null;
    let transcribedText = "";
    let resolved = false;
    let audioSentTime: number | null = null;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve({
          firstPartialMs,
          finalTranscriptMs,
          translationMs: null,
          transcribedText,
          translatedText: "",
          success: transcribedText.length > 0,
          error: transcribedText.length === 0 ? "Timeout" : undefined,
        });
      }
    }, timeoutMs);

    ws.on("open", async () => {
      try {
        const pcmBuffer = await mp3ToPcm16(audioPath, 16000);
        audioSentTime = Date.now();

        const chunkSize = 3200; // 100ms @ 16kHz
        for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
          const chunk = pcmBuffer.slice(i, i + chunkSize);
          ws.send(chunk);
          await new Promise((r) => setTimeout(r, 10));
        }

        // 傳送 CloseStream 訊號
        ws.send(JSON.stringify({ type: "CloseStream" }));
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

        if (event.type === "Results") {
          const channel = event.channel?.alternatives?.[0];
          if (!channel) return;

          const transcript = channel.transcript || "";
          if (!transcript) return;

          if (!event.is_final) {
            // Interim result
            if (firstPartialMs === null) firstPartialMs = elapsed;
          } else {
            // Final result
            finalTranscriptMs = elapsed;
            transcribedText = transcript;
          }
        } else if (event.type === "Metadata") {
          // 連線成功確認
        } else if (event.type === "SpeechStarted") {
          if (firstPartialMs === null) firstPartialMs = elapsed;
        } else if (event.type === "UtteranceEnd") {
          // 語音段落結束
          if (!resolved && transcribedText.length > 0) {
            resolved = true;
            clearTimeout(timer);
            ws.close();
            resolve({
              firstPartialMs,
              finalTranscriptMs,
              translationMs: null,
              transcribedText,
              translatedText: "",
              success: true,
            });
          }
        } else if (event.type === "Close") {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve({
              firstPartialMs,
              finalTranscriptMs,
              translationMs: null,
              transcribedText,
              translatedText: "",
              success: transcribedText.length > 0,
              error: transcribedText.length === 0 ? "Stream closed" : undefined,
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
          translationMs: null,
          transcribedText,
          translatedText: "",
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
          translationMs: null,
          transcribedText,
          translatedText: "",
          success: transcribedText.length > 0,
          error: transcribedText.length === 0 ? "Connection closed" : undefined,
        });
      }
    });
  });
}
