/**
 * Runner: openai-whisper-batch
 * 使用 gpt-4o-transcribe（批次模式）作為現有系統 baseline
 * 模擬現有護理翻譯系統的 ASR 流程
 */
import * as fs from "fs";
import OpenAI from "openai";
import { TestSentence, SingleRunResult } from "../types";

export async function runOpenAIWhisperBatch(
  sentence: TestSentence,
  audioPath: string,
  apiKey: string,
  targetLang: string
): Promise<SingleRunResult> {
  const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1' });
  const startTime = Date.now();

  try {
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

    const audioStream = fs.createReadStream(audioPath);

    // 呼叫 Whisper API（模擬現有系統的批次 ASR）
    const transcribeStart = Date.now();
    const transcription = await client.audio.transcriptions.create({
      model: "gpt-4o-transcribe",
      file: audioStream,
      language: sentence.lang === "zh" ? "zh" : undefined,
      prompt:
        sentence.lang === "zh"
          ? "請使用繁體中文輸出。以下是醫療對話內容："
          : undefined,
    });
    const finalTranscriptMs = Date.now() - startTime;

    const transcribedText = transcription.text || "";

    // 翻譯（模擬現有系統的 gpt-4.1-mini 翻譯）
    const translateStart = Date.now();
    const targetLangName =
      targetLang === "zh" || targetLang === "zh-TW" ? "繁體中文" : targetLang;
    const translationResp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `你是醫療翻譯助理。將以下文字翻譯成${targetLangName}。只輸出翻譯結果，不要解釋。若目標語言是繁體中文，必須使用繁體中文字。`,
        },
        { role: "user", content: transcribedText },
      ],
      max_tokens: 200,
    });
    const translationMs = Date.now() - startTime;
    const translatedText =
      translationResp.choices[0]?.message?.content?.trim() || "";

    return {
      firstPartialMs: null, // 批次模式無 Partial
      finalTranscriptMs,
      translationMs,
      transcribedText,
      translatedText,
      success: true,
    };
  } catch (err: unknown) {
    return {
      firstPartialMs: null,
      finalTranscriptMs: null,
      translationMs: null,
      transcribedText: "",
      translatedText: "",
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
