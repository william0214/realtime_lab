/**
 * Runner: openai-realtime2
 * 使用 gpt-realtime-2（GPT-5 等級推理）進行語音轉錄 + 翻譯
 * 透過 WebSocket 連接 /v1/realtime
 * 支援 System Prompt → 可強制繁體中文輸出
 */
import * as fs from "fs";
import WebSocket from "ws";
import OpenAI from "openai";
import { TestSentence, SingleRunResult } from "../types";

const MODEL = "gpt-realtime-2";

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

export async function runOpenAIRealtime2(
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

  // 建立 Realtime Session（取得 ephemeral token）
  const openai = new OpenAI({ apiKey, baseURL: "https://api.openai.com/v1" });

  const langMap: Record<string, string> = {
    zh: "繁體中文（Traditional Chinese）",
    en: "English",
    vi: "Vietnamese（越南語）",
    id: "Indonesian（印尼語）",
    th: "Thai（泰語）",
    ja: "Japanese（日語）",
  };
  const targetLangName = langMap[targetLang] || targetLang;
  const sourceLangName = langMap[sentence.lang] || sentence.lang;

  const systemPrompt = `You are a professional medical interpreter in a hospital setting.
Your task:
1. Listen to the audio input in ${sourceLangName}.
2. Provide an accurate transcription of what was said.
3. Then translate it into ${targetLangName}.

CRITICAL RULES:
- If target language is Traditional Chinese (繁體中文), you MUST use Traditional Chinese characters ONLY. Never use Simplified Chinese.
- Keep medical terminology accurate.
- Output format: First the transcription, then on a new line starting with "TRANSLATION:" followed by the translation.
- Be concise and accurate.`;

  let ephemeralKey: string;
  try {
    const session = await (openai.beta as any).realtime.sessions.create({
      model: MODEL,
      modalities: ["text", "audio"],
      instructions: systemPrompt,
      input_audio_format: "pcm16",
      output_audio_format: "pcm16",
      input_audio_transcription: { model: "whisper-1" },
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        silence_duration_ms: 800,
        create_response: true,
      },
    });
    ephemeralKey = session.client_secret?.value || apiKey;
  } catch (err: any) {
    return {
      firstPartialMs: null,
      finalTranscriptMs: null,
      translationMs: null,
      transcribedText: "",
      translatedText: "",
      success: false,
      error: `Session 建立失敗: ${err.message}`,
    };
  }

  // 轉換音訊為 PCM16
  let pcmBuffer: Buffer;
  try {
    pcmBuffer = await mp3ToPcm16(audioPath);
  } catch (err: any) {
    return {
      firstPartialMs: null,
      finalTranscriptMs: null,
      translationMs: null,
      transcribedText: "",
      translatedText: "",
      success: false,
      error: `音訊轉換失敗: ${err.message}`,
    };
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${MODEL}`,
      {
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      }
    );

    let firstPartialMs: number | null = null;
    let finalTranscriptMs: number | null = null;
    let translationMs: number | null = null;
    let transcribedText = "";
    let translatedText = "";
    let responseText = "";
    let resolved = false;
    let audioSent = false;

    const elapsed = () => Date.now() - startTime;

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

    ws.on("open", () => {
      // 送入音訊 chunks（每 4096 bytes 一塊）
      const chunkSize = 4096;
      for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
        const chunk = pcmBuffer.slice(i, i + chunkSize);
        ws.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: chunk.toString("base64"),
        }));
      }
      // 提交音訊
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      audioSent = true;
    });

    ws.on("message", (raw) => {
      try {
        const event = JSON.parse(raw.toString());

        switch (event.type) {
          case "conversation.item.input_audio_transcription.completed":
            // 輸入音訊的轉錄結果
            transcribedText = event.transcript || "";
            finalTranscriptMs = elapsed();
            break;

          case "response.text.delta":
            // AI 回應的文字串流（包含翻譯）
            if (firstPartialMs === null) firstPartialMs = elapsed();
            responseText += event.delta || "";
            break;

          case "response.text.done":
            // AI 回應完成
            responseText = event.text || responseText;
            translationMs = elapsed();

            // 解析翻譯結果（格式：轉錄\nTRANSLATION: 翻譯）
            const translationMatch = responseText.match(/TRANSLATION:\s*([\s\S]+)/i);
            if (translationMatch) {
              translatedText = translationMatch[1].trim();
              // 若轉錄文字還沒有，從回應中提取
              if (!transcribedText) {
                const beforeTranslation = responseText.split(/TRANSLATION:/i)[0].trim();
                transcribedText = beforeTranslation;
              }
            } else {
              // 沒有明確分隔符，整個回應視為翻譯
              translatedText = responseText.trim();
            }
            break;

          case "response.done":
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
                success: translatedText.length > 0 || transcribedText.length > 0,
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
          success: translatedText.length > 0 || transcribedText.length > 0,
          error: (translatedText.length === 0 && transcribedText.length === 0) ? "Connection closed" : undefined,
        });
      }
    });
  });
}
