/**
 * Runner: openai-realtime-whisper
 * 使用 gpt-realtime-whisper 串流 ASR
 * 透過 WebSocket 連接 /v1/realtime/transcription_sessions
 */
import * as fs from "fs";
import * as path from "path";
import WebSocket from "ws";
import OpenAI from "openai";
import { TestSentence, SingleRunResult } from "../types";

const MODEL = "gpt-4o-transcribe"; // gpt-realtime-whisper 使用此模型 ID

/**
 * 將 MP3 轉換為 PCM16 Buffer（使用 ffmpeg）
 */
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
    ffmpeg.stderr.on("data", () => {}); // 忽略 ffmpeg 日誌
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    ffmpeg.on("error", reject);
  });
}

export async function runOpenAIRealtimeWhisper(
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

  // 先建立 Transcription Session 取得 ephemeral token
  const openai = new OpenAI({ apiKey });
  let ephemeralKey: string;
  try {
    const session = await (openai.beta as any).realtime.transcriptionSessions.create({
      model: MODEL,
      input_audio_format: "pcm16",
      input_audio_transcription: {
        model: MODEL,
        language: sentence.lang === "zh" ? "zh" : undefined,
        prompt:
          sentence.lang === "zh"
            ? "請使用繁體中文輸出。醫療對話："
            : undefined,
      },
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        silence_duration_ms: 800,
      },
    });
    ephemeralKey = session.client_secret?.value || apiKey;
  } catch {
    // 若 SDK 不支援，直接用 API key
    ephemeralKey = apiKey;
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(
      "wss://api.openai.com/v1/realtime?intent=transcription",
      {
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      }
    );

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
      // 設定 session
      ws.send(
        JSON.stringify({
          type: "transcription_session.update",
          session: {
            input_audio_format: "pcm16",
            input_audio_transcription: {
              model: MODEL,
              language: sentence.lang === "zh" ? "zh" : undefined,
              prompt:
                sentence.lang === "zh"
                  ? "請使用繁體中文輸出。醫療對話："
                  : undefined,
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              silence_duration_ms: 800,
            },
          },
        })
      );

      // 讀取並傳送音訊
      try {
        const pcmBuffer = await mp3ToPcm16(audioPath, 16000);
        audioSentTime = Date.now();

        // 分塊傳送（每塊 100ms = 3200 bytes @ 16kHz 16bit mono）
        const chunkSize = 3200;
        for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
          const chunk = pcmBuffer.slice(i, i + chunkSize);
          ws.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: chunk.toString("base64"),
            })
          );
          // 模擬即時音訊串流
          await new Promise((r) => setTimeout(r, 10));
        }

        // 提交音訊
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
          case "conversation.item.input_audio_transcription.delta":
            if (firstPartialMs === null) {
              firstPartialMs = elapsed;
            }
            transcribedText += event.delta || "";
            break;

          case "conversation.item.input_audio_transcription.completed":
            finalTranscriptMs = elapsed;
            transcribedText = event.transcript || transcribedText;
            if (!resolved) {
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
            break;

          case "error":
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              ws.close();
              resolve({
                firstPartialMs,
                finalTranscriptMs,
                translationMs: null,
                transcribedText,
                translatedText: "",
                success: false,
                error: event.error?.message || "WebSocket error",
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
