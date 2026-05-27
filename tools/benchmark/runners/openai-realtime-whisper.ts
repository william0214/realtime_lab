/**
 * Runner: openai-realtime-whisper
 * 使用 gpt-realtime-whisper 串流 ASR（GA API）
 * 透過 WebSocket 連接 /v1/realtime，使用 session.update + type: "transcription"
 */
import * as fs from "fs";
import WebSocket from "ws";
import * as OpenCC from "opencc-js";
import { TestSentence, SingleRunResult } from "../types";

// 建立簡體→繁體轉換器（一次性初始化）
const toTraditional = OpenCC.Converter({ from: "cn", to: "tw" });

const MODEL = "gpt-realtime-whisper";
// GA API: transcription session 使用 intent=transcription 查詢參數
const WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription";

/**
 * 將 MP3 轉換為 PCM16 Buffer（使用 ffmpeg，24kHz mono）
 */
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

  return new Promise((resolve) => {
    // GA API：使用 intent=transcription 查詢參數
    const ws = new WebSocket(WS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": "benchmark-test",
      },
    });

    let firstPartialMs: number | null = null;
    let finalTranscriptMs: number | null = null;
    let transcribedText = "";
    let resolved = false;
    let audioSentTime: number | null = null;
    let sessionReady = false;

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
          error: transcribedText.length === 0 ? `Timeout after ${timeoutMs}ms` : undefined,
        });
      }
    }, timeoutMs);

    ws.on("open", () => {
      // GA API：使用 session.update 設定 type: "transcription"
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: {
                type: "audio/pcm",
                rate: 24000,
              },
              transcription: {
                model: MODEL,
                language: sentence.lang === "zh" ? "zh" :
                          sentence.lang === "vi" ? "vi" :
                          sentence.lang === "id" ? "id" :
                          sentence.lang === "th" ? "th" :
                          sentence.lang === "ja" ? "ja" :
                          sentence.lang === "en" ? "en" : undefined,
                // 注意：gpt-realtime-whisper GA API 不支援 prompt 欄位
                // 改用後處理 OpenCC 簡繁轉換
                delay: "low", // 低延遲模式
              },
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
            if (!sessionReady) {
              sessionReady = true;
              try {
                const pcmBuffer = await mp3ToPcm16(audioPath, 24000);
                audioSentTime = Date.now();

                // 分塊傳送（每塊 100ms = 4800 bytes @ 24kHz 16bit mono）
                const chunkSize = 4800;
                for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
                  const chunk = pcmBuffer.slice(i, i + chunkSize);
                  ws.send(JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: chunk.toString("base64"),
                  }));
                  await new Promise((r) => setTimeout(r, 10));
                }

                // 提交音訊（手動 commit，不用 VAD）
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
            }
            break;

          case "conversation.item.input_audio_transcription.delta":
            if (firstPartialMs === null) {
              firstPartialMs = elapsed;
            }
            transcribedText += event.delta || "";
            break;

          case "conversation.item.input_audio_transcription.completed":
            finalTranscriptMs = elapsed;
            transcribedText = event.transcript || transcribedText;
            // 後處理：若為中文，使用 OpenCC 將簡體轉為繁體
            if (sentence.lang === "zh" && transcribedText) {
              transcribedText = toTraditional(transcribedText);
            }
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
          error: transcribedText.length === 0 ? "Connection closed without transcript" : undefined,
        });
      }
    });
  });
}
